// PUT /api/auth/clave: el usuario autenticado cambia su propia contraseña.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { crearApp } from '../src/app.js';
import { iniciarCache, cerrarCache } from '../src/cache.js';
import { pool, query } from '../src/db.js';
import { errorPoliticaClave } from '../src/politicaClave.js';

const PASS = 'Demo-Oregon-2026';
const NUEVA = 'Clave-Nueva-Segura-77';
const EMAIL = 'bodega@tiendaoregon.cl';
let server, base;

const http = (metodo, ruta, token, body) => fetch(base + ruta, {
  method: metodo,
  headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
  body: body && JSON.stringify(body),
}).then(async (r) => ({ status: r.status, body: await r.json() }));
const login = (password) => http('POST', '/api/auth/login', null, { email: EMAIL, password });
const cambiar = (token, body) => http('PUT', '/api/auth/clave', token, body);
const reset = async () => query(`UPDATE usuario SET password_hash = crypt($1, gen_salt('bf', 12)), intentos_fallidos = 0, bloqueado_hasta = NULL WHERE email = $2`, [PASS, EMAIL]);

before(async () => { await iniciarCache(); server = crearApp().listen(0); base = `http://localhost:${server.address().port}`; await reset(); });
after(async () => { await reset(); server.close(); await cerrarCache(); await pool.end(); });

test('política: largo, bytes, clave de ejemplo y distinta de la actual', () => {
  assert.match(errorPoliticaClave('corta'), /al menos 12/);
  assert.match(errorPoliticaClave('a'.repeat(73)), /72 bytes/);
  assert.match(errorPoliticaClave('é'.repeat(37)), /72 bytes/); // 74 bytes en UTF-8 aunque sean 37 caracteres
  assert.match(errorPoliticaClave('demo-oregon-2026'), /ejemplo/);
  assert.match(errorPoliticaClave('Clave-Larga-1234', 'Clave-Larga-1234'), /distinta/);
  assert.equal(errorPoliticaClave('Clave-Larga-1234', 'otra'), null);
});

test('sin sesión: 401', async () => {
  assert.equal((await cambiar(null, { actual: PASS, nueva: NUEVA })).status, 401);
});

test('clave actual incorrecta: 403, cuenta un intento fallido y no cambia nada', async () => {
  const { body: { token } } = await login(PASS);
  const r = await cambiar(token, { actual: 'no-es-la-clave', nueva: NUEVA });
  assert.equal(r.status, 403);
  assert.equal(r.body.codigo, 'CLAVE_ACTUAL_INCORRECTA');
  const { rows: [u] } = await query(`SELECT intentos_fallidos FROM usuario WHERE email = $1`, [EMAIL]);
  assert.equal(u.intentos_fallidos, 1);
  assert.equal((await login(PASS)).status, 200);
});

test('clave nueva débil: 400 y la clave no cambia', async () => {
  const { body: { token } } = await login(PASS);
  for (const nueva of ['corta', PASS, 'a'.repeat(80), undefined, 12345678901234]) {
    const r = await cambiar(token, { actual: PASS, nueva });
    assert.equal(r.status, 400, String(nueva));
    assert.equal(r.body.codigo, 'CLAVE_NO_VALIDA');
  }
  assert.equal((await cambiar(token, { actual: PASS, nueva: PASS })).status, 400); // igual a la actual
  assert.equal((await login(PASS)).status, 200);
});

test('éxito: login con la nueva, falla con la vieja, reinicia intentos, audita sin claves y no devuelve datos sensibles', async () => {
  await query(`UPDATE usuario SET intentos_fallidos = 3 WHERE email = $1`, [EMAIL]);
  const { body: { token } } = await login(PASS);
  const r = await cambiar(token, { actual: PASS, nueva: NUEVA });
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body), ['mensaje']);
  assert.equal((await login(PASS)).status, 401);
  assert.equal((await login(NUEVA)).status, 200);

  const { rows: [u] } = await query(`SELECT intentos_fallidos, bloqueado_hasta, left(password_hash, 7) AS pref FROM usuario WHERE email = $1`, [EMAIL]);
  assert.equal(u.intentos_fallidos, 0);
  assert.equal(u.bloqueado_hasta, null);
  assert.equal(u.pref, '$2a$12$'); // mismo costo que el resto

  const { rows } = await query(`SELECT * FROM audit_log WHERE accion = 'CLAVE_CAMBIADA' AND id_usuario = (SELECT id_usuario FROM usuario WHERE email = $1) ORDER BY id_log DESC LIMIT 1`, [EMAIL]);
  assert.equal(rows.length, 1);
  const texto = JSON.stringify(rows[0]);
  assert.ok(!texto.includes(PASS) && !texto.includes(NUEVA) && !texto.includes('$2a$'));
});
