// T30: el Administrador registra y corrige el N° de documento SII del pedido (auditado).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciar, crearPedido, limpiar } from './_aux.js';
import { pool, query } from '../src/db.js';
import { cerrarCache } from '../src/cache.js';

const M = `sii${Date.now().toString(36)}`;
let t, id;
const patch = (tok, body, pid = id) => t.http('PATCH', `/api/pedidos/${pid}/documento`, tok, body);
const logs = async () => (await query(`SELECT * FROM audit_log WHERE accion = 'DOCUMENTO_SII' AND (valores_nuevos->>'id_orden')::int = $1 ORDER BY id_log`, [id])).rows;

before(async () => { t = await iniciar(); id = await crearPedido(M, { estado: 'EN_CAMION' }); });
after(async () => { await limpiar(M); t.server.close(); await cerrarCache(); await pool.end(); });

test('T30: el administrador registra el documento SII, se ve en el detalle y en mi-ruta, y queda auditado', async () => {
  const r = await patch(t.admin, { numero_documento: ' 123456-7 ' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { id_orden: id, numero_documento_sii: '123456-7' });
  for (const tok of [t.admin, t.bodega]) assert.equal((await t.http('GET', `/api/pedidos/${id}`, tok)).body.numero_documento_sii, '123456-7');
  await t.http('POST', `/api/pedidos/${id}/asignar-chofer`, t.admin, { id_chofer: t.idChofer });
  assert.equal((await t.http('GET', '/api/despachos/mi-ruta', t.chofer)).body.find((x) => x.id_orden === id).numero_documento_sii, '123456-7');
  const [l] = await logs();
  assert.equal(l.id_usuario, t.idAdmin);
  assert.equal(l.valores_anteriores.numero_documento_sii, null);
  assert.equal(l.valores_nuevos.numero_documento_sii, '123456-7');
});

test('T30: corregir lo cambia y audita; repetir el mismo valor no audita; vacío o null lo quita', async () => {
  const n = (await logs()).length;
  assert.equal((await patch(t.admin, { numero_documento: '123456-7' })).status, 200);
  assert.equal((await logs()).length, n);
  assert.equal((await patch(t.admin, { numero_documento: '999' })).body.numero_documento_sii, '999');
  assert.equal((await logs()).length, n + 1);
  assert.equal((await logs()).at(-1).valores_anteriores.numero_documento_sii, '123456-7');
  assert.equal((await patch(t.admin, { numero_documento: '' })).body.numero_documento_sii, null);
  assert.equal((await patch(t.admin, { numero_documento: null })).status, 200);
  assert.equal((await t.http('GET', `/api/pedidos/${id}`, t.admin)).body.numero_documento_sii, null);
});

test('T30: formato inválido es 400 y no cambia nada; pedido inexistente 404; Bodega/Chofer 403; sin sesión 401', async () => {
  await patch(t.admin, { numero_documento: '555' });
  const n = (await logs()).length;
  for (const mal of ['ABC123', '12 34', '1'.repeat(21), '12.345', 12345, {}]) assert.equal((await patch(t.admin, { numero_documento: mal })).status, 400, JSON.stringify(mal));
  assert.equal((await t.http('PATCH', `/api/pedidos/${id}/documento`, t.admin, {})).status, 200); // sin campo = quitar
  await patch(t.admin, { numero_documento: '555' });
  assert.equal((await patch(t.admin, { numero_documento: '1'.repeat(20) })).status, 200);
  assert.equal((await patch(t.admin, { numero_documento: '555' }, 999999999)).status, 404);
  for (const tok of [t.bodega, t.chofer]) assert.equal((await patch(tok, { numero_documento: '1' })).status, 403);
  assert.equal((await patch(null, { numero_documento: '1' })).status, 401);
  assert.ok((await logs()).length > n);
});
