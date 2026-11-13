// Hallazgo 9: tras cambiar o restablecer la clave, un token anterior deja de servir aunque el usuario vuelva a iniciar sesión.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { crearApp } from '../src/app.js';
import { config } from '../src/config.js';
import { iniciarCache, cerrarCache } from '../src/cache.js';
import { pool, query } from '../src/db.js';

const PASS = 'Demo-Oregon-2026';
const NUEVA = 'Clave-Nueva-Segura-77';
const EMAIL = 'bodega@tiendaoregon.cl';
let server, base;
const http = (metodo, ruta, token, body) => fetch(base + ruta, {
  method: metodo, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body),
}).then(async (r) => ({ status: r.status, body: await r.json() }));
const login = (password) => http('POST', '/api/auth/login', null, { email: EMAIL, password });
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const reset = () => query(`UPDATE usuario SET password_hash = crypt($1, gen_salt('bf', 12)), intentos_fallidos = 0, bloqueado_hasta = NULL, clave_cambiada_en = NULL WHERE email = $2`, [PASS, EMAIL]);

before(async () => { await iniciarCache(); server = crearApp().listen(0); base = `http://localhost:${server.address().port}`; await reset(); });
after(async () => { await reset(); server.close(); await cerrarCache(); await pool.end(); });

test('cambio de clave: el token anterior no revive con un login posterior; el nuevo sí funciona', async () => {
  const { body: { token: viejo } } = await login(PASS);
  await espera(1100); // `iat` tiene resolución de 1 s
  assert.equal((await http('PUT', '/api/auth/clave', viejo, { actual: PASS, nueva: NUEVA })).status, 200);
  const { body: { token: nuevo } } = await login(NUEVA); // este login recrea la actividad del usuario: antes revivía al token viejo
  assert.equal((await http('GET', '/api/auth/me', nuevo)).status, 200);
  const r = await http('GET', '/api/auth/me', viejo);
  assert.equal(r.status, 401);
  assert.equal(r.body.codigo, 'SESION_EXPIRADA');
  const { rows: [u] } = await query(`SELECT clave_cambiada_en FROM usuario WHERE email = $1`, [EMAIL]);
  assert.ok(u.clave_cambiada_en);
});

test('restablecimiento externo (clave_cambiada_en = now(), como hace scripts/clave-usuario.mjs): tokens previos revocados, el nuevo vale', async () => {
  await reset();
  const { body: { token: viejo } } = await login(PASS);
  assert.equal((await http('GET', '/api/auth/me', viejo)).status, 200);
  await espera(1100);
  await query(`UPDATE usuario SET clave_cambiada_en = now() WHERE email = $1`, [EMAIL]);
  const { body: { token: nuevo } } = await login(PASS);
  assert.equal((await http('GET', '/api/auth/me', viejo)).status, 401);
  assert.equal((await http('GET', '/api/auth/me', nuevo)).status, 200);
});

test('token firmado antes del cambio con iat manipulado hacia el pasado sigue rechazado; sin cambio de clave no afecta', async () => {
  await reset();
  const { rows: [{ id_usuario: sub }] } = await query(`SELECT id_usuario FROM usuario WHERE email = $1`, [EMAIL]);
  const { body: { token: sesion } } = await login(PASS); // registra actividad
  const ahora = Math.floor(Date.now() / 1000);
  const firmar = (iat, opciones = {}) => jwt.sign({ sub, iat }, config.jwtSecret, { expiresIn: '10m', ...opciones });
  assert.equal((await http('GET', '/api/auth/me', firmar(ahora - 60))).status, 200); // nunca cambió la clave
  await query(`UPDATE usuario SET clave_cambiada_en = now() WHERE email = $1`, [EMAIL]);
  assert.equal((await http('GET', '/api/auth/me', firmar(ahora - 60))).status, 401);
  assert.equal((await http('GET', '/api/auth/me', firmar(ahora + 5))).status, 200);
  assert.equal((await http('GET', '/api/auth/me', jwt.sign({ sub }, config.jwtSecret, { algorithm: 'HS512', expiresIn: '10m' }))).status, 401); // solo HS256
  assert.ok(sesion);
});
