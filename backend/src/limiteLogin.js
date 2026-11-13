// Límite de intentos de login por IP y por correo (además del bloqueo de cuenta de MAX_INTENTOS). Ventana fija: el
// contador vence solo, así que ni un atacante ni el propio administrador quedan bloqueados de forma permanente.
// Cada petición cuenta al llegar (una ráfaga concurrente no se cuela). Un login correcto solo reinicia el contador de SU correo:
// el de la IP no se devuelve, para que una cuenta propia válida no sirva para compensar intentos contra otras cuentas.
// Redis si responde; si no, mapa en memoria por proceso.
// shortcut: el mapa en memoria no se comparte entre instancias; con varias instancias sin Redis el tope real es N veces mayor.
import { config } from './config.js';
import { redisContar, redisDel, redisBorrarPrefijo } from './cache.js';
import { ipDe } from './audit.js';

const memoria = new Map(); // clave → { n, vence }
const pendientes = new Set(); // devoluciones en vuelo (se esperan antes de reiniciar)
const MAX_ENTRADAS = 50_000;

function contarMemoria(clave, ventana) {
  const ahora = Date.now();
  if (memoria.size >= MAX_ENTRADAS) {
    for (const [k, v] of memoria) if (v.vence <= ahora) memoria.delete(k);
    for (const k of memoria.keys()) { if (memoria.size < MAX_ENTRADAS) break; memoria.delete(k); } // tope duro: se descartan las más antiguas
  }
  let e = memoria.get(clave);
  if (!e || e.vence <= ahora) { e = { n: 0, vence: ahora + ventana * 1000 }; memoria.set(clave, e); }
  e.n += 1;
  return { n: e.n, ttl: Math.ceil((e.vence - ahora) / 1000) };
}

async function contar(clave, ventana) {
  return (await redisContar(`rl:login:${clave}`, ventana)) ?? contarMemoria(clave, ventana);
}

async function reiniciarCorreo(clave) {
  memoria.delete(clave);
  await redisDel(`rl:login:${clave}`);
}

// IPv6: un cliente suele controlar un /64 entero, así que se cuenta por prefijo; ::ffff:a.b.c.d cuenta como la IPv4.
export function claveIp(ip) {
  const v4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (v4) return v4[1];
  if (!ip.includes(':')) return ip;
  const [cabeza, cola = ''] = ip.split('::');
  const a = cabeza ? cabeza.split(':') : [];
  const b = cola ? cola.split(':') : [];
  const grupos = ip.includes('::') ? [...a, ...Array(8 - a.length - b.length).fill('0'), ...b] : a;
  return grupos.slice(0, 4).map((g) => g.toLowerCase().padStart(4, '0')).join(':') + '::/64';
}

export async function reiniciarLimites() {
  await Promise.all(pendientes);
  memoria.clear();
  await redisBorrarPrefijo('rl:login:');
}

export async function limitarLogin(req, res, next) {
  const { loginVentanaSeg: ventana, loginMaxPorIp, loginMaxPorCorreo } = config;
  if (!ventana || (!loginMaxPorIp && !loginMaxPorCorreo)) return next();
  const correo = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 254) : '';
  const claves = [];
  if (loginMaxPorIp) claves.push([`ip:${claveIp(ipDe(req))}`, loginMaxPorIp]);
  if (loginMaxPorCorreo && correo) claves.push([`correo:${correo}`, loginMaxPorCorreo]);
  let espera = 0;
  for (const [clave, max] of claves) { // la IP va primero: superada, no se crean contadores por correo
    const { n, ttl } = await contar(clave, ventana);
    if (n > max) { espera = ttl; break; }
  }
  if (espera) {
    // Misma respuesta exista o no el correo: el límite no permite enumerar usuarios.
    res.set('Retry-After', String(espera));
    return res.status(429).json({ error: 'Demasiados intentos. Inténtalo de nuevo más tarde', codigo: 'DEMASIADOS_INTENTOS' });
  }
  res.on('finish', () => {
    if (res.statusCode !== 200) return;
    for (const [clave] of claves.filter(([c]) => c.startsWith('correo:'))) {
      const p = reiniciarCorreo(clave).catch(() => {}).finally(() => pendientes.delete(p));
      pendientes.add(p);
    }
  });
  next();
}
