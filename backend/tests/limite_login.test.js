// Límite de intentos de login por IP y por correo, y trust proxy (hallazgos 2 y 17 de la auditoría).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { crearApp } from '../src/app.js';
import { config } from '../src/config.js';
import { iniciarCache, cerrarCache, redisGet } from '../src/cache.js';
import { reiniciarLimites, claveIp } from '../src/limiteLogin.js';
import { pool, query } from '../src/db.js';

const PASS = 'Demo-Oregon-2026';
let server, base;
const original = { ...config };
const login = (email, password, cabeceras = {}) => fetch(`${base}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...cabeceras }, body: JSON.stringify({ email, password }),
}).then(async (r) => ({ status: r.status, retry: r.headers.get('retry-after'), body: await r.json() }));
const reset = () => query(`UPDATE usuario SET intentos_fallidos = 0, bloqueado_hasta = NULL`);

before(async () => { await iniciarCache(); await reset(); });
beforeEach(async () => { Object.assign(config, original); await reiniciarLimites(); await reset(); server?.close(); server = crearApp().listen(0); base = `http://localhost:${server.address().port}`; });
after(async () => { Object.assign(config, original); await reiniciarLimites(); await reset(); server.close(); await cerrarCache(); await pool.end(); });

test('por IP: superado el umbral responde 429 con Retry-After, igual para correos existentes e inexistentes', async () => {
  config.loginMaxPorIp = 3; config.loginMaxPorCorreo = 0;
  for (const e of ['a@x.cl', 'b@x.cl', 'bodega@tiendaoregon.cl']) assert.equal((await login(e, 'mala')).status, 401);
  const r1 = await login('c@x.cl', 'mala');
  const r2 = await login('chofer@tiendaoregon.cl', PASS); // ni la clave correcta pasa mientras dure la ventana
  for (const r of [r1, r2]) {
    assert.equal(r.status, 429);
    assert.equal(r.body.codigo, 'DEMASIADOS_INTENTOS');
    assert.ok(Number(r.retry) > 0 && Number(r.retry) <= config.loginVentanaSeg);
  }
  assert.deepEqual(r1.body, r2.body);
});

test('por correo: otro correo desde la misma IP no se ve afectado', async () => {
  config.loginMaxPorIp = 0; config.loginMaxPorCorreo = 2;
  await login('fantasma@x.cl', 'mala'); await login('fantasma@x.cl', 'mala');
  assert.equal((await login('FANTASMA@x.cl ', 'mala')).status, 429); // se normaliza mayúsculas y espacios
  assert.equal((await login('admin@tiendaoregon.cl', PASS)).status, 200);
});

test('un login correcto reinicia el contador de su correo pero no el de la IP', async () => {
  config.loginMaxPorIp = 0; config.loginMaxPorCorreo = 2;
  for (let i = 0; i < 6; i++) assert.equal((await login('admin@tiendaoregon.cl', PASS)).status, 200);
  config.loginMaxPorIp = 3; config.loginMaxPorCorreo = 0;
  await reiniciarLimites();
  await login('x@x.cl', 'mala');
  assert.equal((await login('admin@tiendaoregon.cl', PASS)).status, 200); // propio y válido: no compensa el intento fallido anterior
  await login('x@x.cl', 'mala');
  assert.equal((await login('admin@tiendaoregon.cl', PASS)).status, 429);
});

test('IPv6: se cuenta por /64 y ::ffff:a.b.c.d equivale a la IPv4', () => {
  assert.equal(claveIp('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), claveIp('2001:0DB8:1:2::1'));
  assert.notEqual(claveIp('2001:db8:1:2::1'), claveIp('2001:db8:1:3::1'));
  assert.equal(claveIp('::ffff:203.0.113.9'), '203.0.113.9');
  assert.equal(claveIp('127.0.0.1'), '127.0.0.1');
});

test('el bloqueo vence solo: el administrador entra al terminar la ventana', async () => {
  config.loginMaxPorIp = 2; config.loginMaxPorCorreo = 0; config.loginVentanaSeg = 1;
  await login('x@x.cl', 'mala'); await login('x@x.cl', 'mala');
  assert.equal((await login('admin@tiendaoregon.cl', PASS)).status, 429);
  await new Promise((r) => setTimeout(r, 1100));
  assert.equal((await login('admin@tiendaoregon.cl', PASS)).status, 200);
});

test('sin proxy de confianza X-Forwarded-For no sirve para esquivar el límite ni falsificar la IP de la bitácora', async () => {
  config.loginMaxPorIp = 2; config.loginMaxPorCorreo = 0; config.trustProxy = false;
  server.close(); server = crearApp().listen(0); base = `http://localhost:${server.address().port}`;
  await login('x@x.cl', 'mala', { 'X-Forwarded-For': '1.1.1.1' });
  await login('x@x.cl', 'mala', { 'X-Forwarded-For': '2.2.2.2' });
  assert.equal((await login('x@x.cl', 'mala', { 'X-Forwarded-For': '3.3.3.3' })).status, 429);
  const { rows } = await query(`SELECT host(ip_origen) AS ip FROM audit_log WHERE accion = 'LOGIN_FALLIDO' ORDER BY id_log DESC LIMIT 2`);
  assert.ok(rows.every((r) => !['1.1.1.1', '2.2.2.2'].includes(r.ip)));
});

test('con TRUST_PROXY=1 la IP real (X-Forwarded-For) es la que se cuenta y se registra', async () => {
  config.loginMaxPorIp = 2; config.loginMaxPorCorreo = 0; config.trustProxy = 1;
  server.close(); server = crearApp().listen(0); base = `http://localhost:${server.address().port}`;
  await login('x@x.cl', 'mala', { 'X-Forwarded-For': '203.0.113.7' });
  await login('x@x.cl', 'mala', { 'X-Forwarded-For': '203.0.113.7' });
  assert.equal((await login('x@x.cl', 'mala', { 'X-Forwarded-For': '203.0.113.7' })).status, 429);
  assert.equal((await login('x@x.cl', 'mala', { 'X-Forwarded-For': '203.0.113.8' })).status, 401); // otro cliente: otra cuenta
  const { rows: [f] } = await query(`SELECT host(ip_origen) AS ip FROM audit_log WHERE accion = 'LOGIN_FALLIDO' AND host(ip_origen) = '203.0.113.7' LIMIT 1`);
  assert.equal(f.ip, '203.0.113.7');
});

test('correo o contraseña desmesurados → 400 sin tocar la bitácora', async () => {
  const antes = (await query(`SELECT count(*)::int AS n FROM audit_log`)).rows[0].n;
  assert.equal((await login('a'.repeat(300) + '@x.cl', 'mala')).status, 400);
  assert.equal((await login('a@x.cl', 'p'.repeat(300))).status, 400);
  assert.equal((await query(`SELECT count(*)::int AS n FROM audit_log`)).rows[0].n, antes);
});

test('con Redis disponible el contador se comparte (se omite sin REDIS_URL)', { skip: !process.env.REDIS_URL }, async () => {
  config.loginMaxPorIp = 0; config.loginMaxPorCorreo = 2; config.loginVentanaSeg = 5;
  const correo = `redis-${Date.now()}@x.cl`;
  await login(correo, 'mala'); await login(correo, 'mala');
  assert.equal(await redisGet(`rl:login:correo:${correo}`), '2'); // el conteo vive en Redis
  assert.equal((await login(correo, 'mala')).status, 429);
});
