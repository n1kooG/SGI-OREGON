// Chofer: historial paginado, detalle de parada con ítems y conteos de la jornada (sin precios ni costos).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciar, crearPedido, limpiar } from './_aux.js';
import { pool, query } from '../src/db.js';
import { cerrarCache } from '../src/cache.js';

const M = `his${Date.now().toString(36)}`;
let t, cont = 0, idOtro;
const nuevo = (o) => crearPedido(`${M}${++cont}`, o);
const asignar = async (lineas = [['TH-4500', 2], ['UT-FORNO', 1]]) => {
  const id = await nuevo({ estado: 'EN_CAMION', lineas });
  await t.http('POST', `/api/pedidos/${id}/asignar-chofer`, t.admin, { id_chofer: t.idChofer });
  return { id, idDespacho: (await query(`SELECT id_despacho FROM despacho WHERE id_orden = $1`, [id])).rows[0].id_despacho };
};

before(async () => {
  t = await iniciar();
  const { rows: [u] } = await query(
    `INSERT INTO usuario (rut, nombre_completo, email, password_hash, id_rol) SELECT '55.555.555-5', 'Chofer Ajeno H', $1, password_hash, id_rol FROM usuario WHERE email = 'chofer@tiendaoregon.cl' RETURNING id_usuario`, [`${M}@ajeno.cl`]);
  idOtro = u.id_usuario;
});
after(async () => {
  await limpiar(M);
  await query(`DELETE FROM usuario WHERE id_usuario = $1`, [idOtro]);
  t.server.close(); await cerrarCache(); await pool.end();
});

test('Chofer: GET /despachos/:id devuelve la parada con ítems (producto, SKU, cantidad) y sin precios ni costos', async () => {
  const { id, idDespacho } = await asignar();
  const r = await t.http('GET', `/api/despachos/${idDespacho}`, t.chofer);
  assert.equal(r.status, 200);
  assert.equal(r.body.id_orden, id);
  assert.equal(r.body.direccion_despacho, 'Providencia 1251');
  assert.equal(r.body.bultos, 3);
  assert.equal(r.body.estado_entrega, 'PENDIENTE');
  assert.deepEqual(r.body.items.map(({ sku, cantidad }) => ({ sku, cantidad })), [{ sku: 'TH-4500', cantidad: 2 }, { sku: 'UT-FORNO', cantidad: 1 }]);
  assert.ok(r.body.items.every((i) => i.nombre && i.modelo));
  assert.doesNotMatch(JSON.stringify(r.body), /costo|margen|precio|subtotal|valorizacion/i);
});

test('Chofer: el detalle de la parada de otro chofer o inexistente es 404; Bodega/Administrador 403; sin sesión 401', async () => {
  const { id, idDespacho } = await asignar();
  for (const tok of [t.bodega, t.admin]) assert.equal((await t.http('GET', `/api/despachos/${idDespacho}`, tok)).status, 403);
  assert.equal((await t.http('GET', `/api/despachos/${idDespacho}`, null)).status, 401);
  assert.equal((await t.http('GET', '/api/despachos/999999999', t.chofer)).status, 404);
  await query(`UPDATE despacho SET id_usuario_chofer = $2 WHERE id_despacho = $1`, [idDespacho, idOtro]);
  assert.equal((await t.http('GET', `/api/despachos/${idDespacho}`, t.chofer)).status, 404);
  assert.equal((await t.http('GET', '/api/despachos/historial', t.chofer)).body.items.some((x) => x.id_orden === id), false);
});

test('Chofer: el detalle de una entrega cerrada trae receptor, firma y motivo del rechazo', async () => {
  const a = await asignar();
  await t.http('PATCH', `/api/despachos/${a.idDespacho}`, t.chofer, { estado: 'ENTREGADO', nombre_receptor: 'Luis Pérez' });
  const b = await asignar();
  await t.http('PATCH', `/api/despachos/${b.idDespacho}`, t.chofer, { estado: 'RECHAZADO', motivo: 'Dirección incorrecta' });
  const da = (await t.http('GET', `/api/despachos/${a.idDespacho}`, t.chofer)).body;
  assert.deepEqual([da.estado_entrega, da.nombre_receptor, da.tiene_firma], ['ENTREGADO', 'Luis Pérez', false]);
  assert.ok(da.fecha_cierre);
  assert.equal((await t.http('GET', `/api/despachos/${b.idDespacho}`, t.chofer)).body.motivo_rechazo, 'Dirección incorrecta');
});

test('Chofer: el historial es solo del chofer autenticado, trae lo cerrado sin corte de fecha, paginado y sin costos', async () => {
  const cerradas = [];
  for (let i = 0; i < 3; i++) {
    const d = await asignar([['TH-4500', 1]]);
    await t.http('PATCH', `/api/despachos/${d.idDespacho}`, t.chofer, { estado: i === 1 ? 'RECHAZADO' : 'ENTREGADO', motivo: 'Ausente' });
    cerradas.push(d);
  }
  const abierta = await asignar([['TH-4500', 1]]);
  // una entrega de ayer: fuera de mi-ruta, pero dentro del historial
  await query(`UPDATE despacho SET fecha_cierre = now() - interval '3 days' WHERE id_despacho = $1`, [cerradas[0].idDespacho]);
  assert.equal((await t.http('GET', '/api/despachos/mi-ruta', t.chofer)).body.some((x) => x.id_despacho === cerradas[0].idDespacho), false);

  const r = await t.http('GET', '/api/despachos/historial?limite=100', t.chofer);
  assert.equal(r.status, 200);
  const ids = r.body.items.map((x) => x.id_despacho);
  assert.ok(ids.includes(cerradas[0].idDespacho));
  assert.equal(ids.includes(abierta.idDespacho), false); // las abiertas viven en mi-ruta
  assert.ok(ids.indexOf(cerradas[2].idDespacho) < ids.indexOf(cerradas[0].idDespacho)); // más reciente primero
  assert.equal(r.body.total >= 3, true);
  assert.deepEqual(Object.keys(r.body.items[0]).sort(), Object.keys((await t.http('GET', '/api/despachos/mi-ruta', t.chofer)).body[0]).sort()); // mismas columnas que mi-ruta
  assert.doesNotMatch(JSON.stringify(r.body), /costo|margen|precio|subtotal/i);

  const p1 = (await t.http('GET', '/api/despachos/historial?limite=2&pagina=1', t.chofer)).body;
  const p2 = (await t.http('GET', '/api/despachos/historial?limite=2&pagina=2', t.chofer)).body;
  assert.equal(p1.items.length, 2);
  assert.equal(p1.total, r.body.total);
  assert.equal(p2.pagina, 2);
  assert.deepEqual(p1.items.concat(p2.items).map((x) => x.id_despacho), ids.slice(0, 2 + p2.items.length));
  assert.equal((await t.http('GET', '/api/despachos/historial?pagina=99999', t.chofer)).body.items.length, 0);
});

test('Chofer: el historial valida pagina y limite (400) y exige el permiso de ruta', async () => {
  for (const q of ['pagina=0', 'pagina=abc', 'limite=0', 'limite=101', 'limite=1.5']) assert.equal((await t.http('GET', `/api/despachos/historial?${q}`, t.chofer)).status, 400, q);
  for (const tok of [t.bodega, t.admin]) assert.equal((await t.http('GET', '/api/despachos/historial', tok)).status, 403);
  assert.equal((await t.http('GET', '/api/despachos/historial', null)).status, 401);
});

test('Chofer: mi-ruta/resumen cuenta pendientes, entregadas y rechazadas de la jornada', async () => {
  const antes = (await t.http('GET', '/api/despachos/mi-ruta/resumen', t.chofer)).body;
  assert.deepEqual(Object.keys(antes).sort(), ['entregadas', 'pendientes', 'rechazadas']);
  const a = await asignar(), b = await asignar(), c = await asignar();
  await t.http('PATCH', `/api/despachos/${a.idDespacho}`, t.chofer, { estado: 'ENTREGADO' });
  await t.http('PATCH', `/api/despachos/${b.idDespacho}`, t.chofer, { estado: 'RECHAZADO', motivo: 'Ausente' });
  const d = (await t.http('GET', '/api/despachos/mi-ruta/resumen', t.chofer)).body;
  assert.deepEqual([d.pendientes - antes.pendientes, d.entregadas - antes.entregadas, d.rechazadas - antes.rechazadas], [1, 1, 1]);
  // lo cerrado antes de hoy ya no cuenta en la jornada
  await query(`UPDATE despacho SET fecha_cierre = now() - interval '2 days' WHERE id_despacho = $1`, [a.idDespacho]);
  assert.equal((await t.http('GET', '/api/despachos/mi-ruta/resumen', t.chofer)).body.entregadas, antes.entregadas);
  assert.ok(c.idDespacho);
  for (const tok of [t.bodega, t.admin]) assert.equal((await t.http('GET', '/api/despachos/mi-ruta/resumen', tok)).status, 403);
});
