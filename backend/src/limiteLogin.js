// Límite de intentos de login por IP y por correo (además del bloqueo de cuenta de MAX_INTENTOS). Ventana fija: el
// contador vence solo, así que ni un atacante ni el propio administrador quedan bloqueados de forma permanente.
// Cada petición cuenta al llegar (una ráfaga concurrente no se cuela) y un login correcto devuelve su intento.
// Redis si responde; si no, mapa en memoria por proceso.
// shortcut: el mapa en memoria no se comparte entre instancias; con varias instancias sin Redis el tope real es N veces mayor.
import { config } from './config.js';
import { redisContar, redisDecr, redisDel } from './cache.js';
import { ipDe } from './audit.js';

const memoria = new Map(); // clave → { n, vence }
const pendientes = new Set(); // devoluciones en vuelo (se esperan antes de reiniciar)
const usadas = new Set(); // claves tocadas por este proceso, para poder reiniciarlas en las pruebas
const MAX_ENTRADAS = 50_000;

function contarMemoria(clave, ventana) {
  const ahora = Date.now();
  if (memoria.size > MAX_ENTRADAS) for (const [k, v] of memoria) if (v.vence <= ahora) memoria.delete(k);
  let e = memoria.get(clave);
  if (!e || e.vence <= ahora) { e = { n: 0, vence: ahora + ventana * 1000 }; memoria.set(clave, e); }
  e.n += 1;
  return { n: e.n, ttl: Math.ceil((e.vence - ahora) / 1000) };
}

async function contar(clave, ventana) {
  usadas.add(clave);
  return (await redisContar(`rl:login:${clave}`, ventana)) ?? contarMemoria(clave, ventana);
}

async function devolver(clave, borrar) {
  const m = memoria.get(clave);
  if (m && m.n > 0) m.n -= borrar ? m.n : 1;
  await (borrar ? redisDel(`rl:login:${clave}`) : redisDecr(`rl:login:${clave}`));
}

export async function reiniciarLimites() {
  await Promise.all(pendientes);
  memoria.clear();
  for (const k of usadas) await redisDel(`rl:login:${k}`);
  usadas.clear();
}

export async function limitarLogin(req, res, next) {
  const { loginVentanaSeg: ventana, loginMaxPorIp, loginMaxPorCorreo } = config;
  if (!ventana || (!loginMaxPorIp && !loginMaxPorCorreo)) return next();
  const correo = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 254) : '';
  const claves = [];
  if (loginMaxPorIp) claves.push([`ip:${ipDe(req)}`, loginMaxPorIp]);
  if (loginMaxPorCorreo && correo) claves.push([`correo:${correo}`, loginMaxPorCorreo]);
  let espera = 0;
  for (const [clave, max] of claves) {
    const { n, ttl } = await contar(clave, ventana);
    if (n > max) espera = Math.max(espera, ttl);
  }
  if (espera) {
    // Misma respuesta exista o no el correo: el límite no permite enumerar usuarios.
    res.set('Retry-After', String(espera));
    return res.status(429).json({ error: 'Demasiados intentos. Inténtalo de nuevo más tarde', codigo: 'DEMASIADOS_INTENTOS' });
  }
  res.on('finish', () => {
    if (res.statusCode !== 200) return;
    for (const [clave] of claves) {
      const p = devolver(clave, clave.startsWith('correo:')).catch(() => {}).finally(() => pendientes.delete(p));
      pendientes.add(p);
    }
  });
  next();
}
