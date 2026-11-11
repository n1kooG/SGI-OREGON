// Hallazgo de auditoría: al vencer el bloqueo, el contador parte de cero (un fallo cada 15 min no bloquea para siempre).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { crearApp } from '../src/app.js';
import { iniciarCache, cerrarCache } from '../src/cache.js';
import { pool, query } from '../src/db.js';

const EMAIL = 'bodega@tiendaoregon.cl';
let server, base;
const login = (password) => fetch(`${base}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password }),
}).then((r) => r.status);
const estado = async () => (await query(`SELECT intentos_fallidos, bloqueado_hasta > now() AS bloqueada FROM usuario WHERE email = $1`, [EMAIL])).rows[0];
const reset = () => query(`UPDATE usuario SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE email = $1`, [EMAIL]);

before(async () => { await iniciarCache(); server = crearApp().listen(0); base = `http://localhost:${server.address().port}`; await reset(); });
after(async () => { await reset(); server.close(); await cerrarCache(); await pool.end(); });

test('con el bloqueo vencido, un fallo deja el contador en 1 y la cuenta desbloqueada', async () => {
  await query(`UPDATE usuario SET intentos_fallidos = 5, bloqueado_hasta = now() - interval '1 minute' WHERE email = $1`, [EMAIL]);
  assert.equal(await login('mala'), 401);
  assert.deepEqual(await estado(), { intentos_fallidos: 1, bloqueada: null });
  assert.equal(await login('Demo-Oregon-2026'), 200);
});

test('con el bloqueo vigente, el contador sigue subiendo y la cuenta sigue bloqueada', async () => {
  await query(`UPDATE usuario SET intentos_fallidos = 5, bloqueado_hasta = now() + interval '10 minutes' WHERE email = $1`, [EMAIL]);
  assert.equal(await login('Demo-Oregon-2026'), 401);
  assert.equal((await estado()).bloqueada, true);
});

test('5 fallos seguidos bloquean la cuenta', async () => {
  await reset();
  for (let i = 0; i < 5; i++) await login('mala');
  assert.deepEqual(await estado(), { intentos_fallidos: 5, bloqueada: true });
});
