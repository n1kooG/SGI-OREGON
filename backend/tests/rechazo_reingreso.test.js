// PI-05: rechazo completo — causal visible, reingreso físico con devolución de stock y reprogramación del pedido.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciar, crearPedido, limpiar } from './_aux.js';
import { pool, query } from '../src/db.js';
import { cerrarCache } from '../src/cache.js';

const M = `pi5${Date.now().toString(36)}`;
let t, cont = 0;
const nuevo = (o) => crearPedido(`${M}${++cont}`, o);
const stock = async (sku) => (await query(`SELECT stock_fisico FROM inventario WHERE sku = $1`, [sku])).rows[0].stock_fisico;
const estado = async (id) => (await query(`SELECT estado_orden FROM orden_venta WHERE id_orden = $1`, [id])).rows[0].estado_orden;
const despachos = async (id) => (await query(`SELECT * FROM despacho WHERE id_orden = $1 ORDER BY id_despacho`, [id])).rows;
const lineas = [['TH-4500', 2], ['UT-FORNO', 1]];
let sumados = { 'TH-4500': 0, 'UT-FORNO': 0 }; // lo que las pruebas devolvieron al stock, para dejarlo como estaba

async function rechazado(motivo = 'Cliente ausente') {
  const id = await nuevo({ estado: 'EN_CAMION', lineas });
  await t.http('POST', `/api/pedidos/${id}/asignar-chofer`, t.admin, { id_chofer: t.idChofer });
  const [d] = await despachos(id);
  const r = await t.http('PATCH', `/api/despachos/${d.id_despacho}`, t.chofer, { estado: 'RECHAZADO', motivo });
  assert.equal(r.status, 200);
  return { id, idDespacho: d.id_despacho };
}

before(async () => { t = await iniciar(); });
after(async () => {
  for (const [sku, n] of Object.entries(sumados)) await query(`UPDATE inventario SET stock_fisico = stock_fisico - $2 WHERE sku = $1`, [sku, n]);
  await limpiar(M);
  t.server.close(); await cerrarCache(); await pool.end();
});

test('PI-05: el rechazo es visible para Bodega y el administrador con su causal y queda por reingresar', async () => {
  const { id } = await rechazado('Dirección no existe');
  const porReingresar = await t.http('GET', '/api/pedidos?por_reingresar=1', t.bodega);
  assert.equal(porReingresar.status, 200);
  const p = porReingresar.body.find((x) => x.id_orden === id);
  assert.equal(p.motivo_rechazo, 'Dirección no existe');
  assert.equal(p.estado_orden, 'RECHAZADO');
  assert.equal(p.reingresado, false);
  assert.ok(porReingresar.body.every((x) => x.estado_orden === 'RECHAZADO' && !x.reingresado));
  // la lista normal de Bodega sigue limitada a sus 4 estados
  assert.equal((await t.http('GET', '/api/pedidos', t.bodega)).body.some((x) => x.id_orden === id), false);
  for (const tok of [t.bodega, t.admin]) {
    const d = await t.http('GET', `/api/pedidos/${id}`, tok);
    assert.equal(d.body.motivo_rechazo, 'Dirección no existe');
    assert.equal(d.body.reingresado, false);
    assert.equal(d.body.nombre_receptor, null);
  }
  assert.equal((await t.http('GET', '/api/pedidos', t.admin)).body.find((x) => x.id_orden === id).motivo_rechazo, 'Dirección no existe');
  assert.doesNotMatch(JSON.stringify([porReingresar.body, (await t.http('GET', `/api/pedidos/${id}`, t.bodega)).body]), /costo|margen|precio|subtotal/i);
});

test('PI-05: por_reingresar valida el estado y el chofer no accede a pedidos', async () => {
  assert.equal((await t.http('GET', '/api/pedidos?por_reingresar=1&estado=ENTREGADO', t.admin)).status, 400);
  assert.equal((await t.http('GET', '/api/pedidos?por_reingresar=1', t.chofer)).status, 403);
  assert.equal((await t.http('GET', '/api/pedidos?por_reingresar=1', null)).status, 401);
});

test('PI-05: reingresar devuelve el stock, marca el reingreso, deja el pedido EN_CAMION y audita REINGRESO', async () => {
  const { id, idDespacho } = await rechazado();
  const antes = { a: await stock('TH-4500'), b: await stock('UT-FORNO') };
  const r = await t.http('POST', `/api/despachos/${idDespacho}/reingresar`, t.bodega);
  assert.equal(r.status, 200);
  sumados = { 'TH-4500': sumados['TH-4500'] + 2, 'UT-FORNO': sumados['UT-FORNO'] + 1 };
  assert.deepEqual({ id_despacho: r.body.id_despacho, id_orden: r.body.id_orden, estado_orden: r.body.estado_orden, unidades: r.body.unidades },
    { id_despacho: idDespacho, id_orden: id, estado_orden: 'EN_CAMION', unidades: 3 });
  assert.ok(r.body.reingresado_en);
  assert.equal(await stock('TH-4500'), antes.a + 2);
  assert.equal(await stock('UT-FORNO'), antes.b + 1);
  assert.equal(await estado(id), 'EN_CAMION');
  const [d] = await despachos(id);
  assert.equal(d.estado_entrega, 'RECHAZADO'); // el intento queda en el historial
  assert.equal(d.id_usuario_reingreso, t.idBodega);
  const [log] = (await query(`SELECT * FROM audit_log WHERE accion = 'REINGRESO' AND (valores_nuevos->>'id_despacho')::int = $1`, [idDespacho])).rows;
  assert.equal(log.id_usuario, t.idBodega);
  assert.equal(log.valores_nuevos.id_orden, id);
  assert.equal(log.valores_nuevos.unidades, 3);
  assert.deepEqual(log.valores_nuevos.items, [{ sku: 'TH-4500', cantidad: 2 }, { sku: 'UT-FORNO', cantidad: 1 }]);
  // ya no figura por reingresar y el segundo intento es 409 sin tocar el stock
  assert.equal((await t.http('GET', '/api/pedidos?por_reingresar=1', t.bodega)).body.some((x) => x.id_orden === id), false);
  const otra = await t.http('POST', `/api/despachos/${idDespacho}/reingresar`, t.admin);
  assert.equal(otra.status, 409);
  assert.equal(otra.body.codigo, 'YA_REINGRESADO');
  assert.equal(await stock('TH-4500'), antes.a + 2);
});

test('PI-05: tras el reingreso se puede asignar chofer de nuevo y se crea un despacho nuevo; el listado muestra el vigente', async () => {
  const { id, idDespacho } = await rechazado();
  assert.equal((await t.http('POST', `/api/pedidos/${id}/asignar-chofer`, t.admin, { id_chofer: t.idChofer })).status, 409); // aún sin reingresar
  assert.equal((await t.http('POST', `/api/despachos/${idDespacho}/reingresar`, t.admin)).status, 200);
  sumados = { 'TH-4500': sumados['TH-4500'] + 2, 'UT-FORNO': sumados['UT-FORNO'] + 1 };
  const nuevoDesp = await t.http('POST', `/api/pedidos/${id}/asignar-chofer`, t.admin, { id_chofer: t.idChofer });
  assert.equal(nuevoDesp.status, 200);
  assert.notEqual(nuevoDesp.body.id_despacho, idDespacho);
  assert.equal(await estado(id), 'EN_RUTA');
  assert.equal((await despachos(id)).length, 2);
  const fila = (await t.http('GET', '/api/pedidos', t.admin)).body.filter((x) => x.id_orden === id);
  assert.equal(fila.length, 1); // sin filas duplicadas por el historial de despachos
  assert.equal(fila[0].estado_entrega, 'PENDIENTE');
  assert.equal((await t.http('GET', `/api/pedidos/${id}`, t.admin)).body.id_despacho, nuevoDesp.body.id_despacho);
  // un segundo despacho abierto sigue siendo imposible
  assert.equal((await t.http('POST', `/api/pedidos/${id}/asignar-chofer`, t.admin, { id_chofer: t.idChofer })).status, 409);
});

test('PI-05: solo se reingresa un despacho RECHAZADO (409), existente (404) y con permiso (403/401)', async () => {
  const id = await nuevo({ estado: 'EN_CAMION', lineas });
  await t.http('POST', `/api/pedidos/${id}/asignar-chofer`, t.admin, { id_chofer: t.idChofer });
  const [d] = await despachos(id);
  const url = `/api/despachos/${d.id_despacho}/reingresar`;
  const pend = await t.http('POST', url, t.bodega);
  assert.equal(pend.status, 409);
  assert.equal(pend.body.codigo, 'NO_RECHAZADO');
  await t.http('PATCH', `/api/despachos/${d.id_despacho}`, t.chofer, { estado: 'ENTREGADO' });
  assert.equal((await t.http('POST', url, t.bodega)).status, 409);
  assert.equal((await t.http('POST', '/api/despachos/999999999/reingresar', t.bodega)).status, 404);
  assert.equal((await t.http('POST', url, t.chofer)).status, 403);
  assert.equal((await t.http('POST', url, null)).status, 401);
  assert.equal(await estado(id), 'ENTREGADO');
});

test('PI-05: atomicidad — si la transición del pedido falla se revierte la devolución de stock y el reingreso', async () => {
  const id = await nuevo({ estado: 'EN_CAMION', lineas });
  await t.http('POST', `/api/pedidos/${id}/asignar-chofer`, t.admin, { id_chofer: t.idChofer });
  const [d] = await despachos(id);
  // estado incoherente forzado: despacho rechazado pero pedido ENTREGADO (ENTREGADO -> EN_CAMION no existe)
  await query(`UPDATE despacho SET estado_entrega = 'RECHAZADO', motivo_rechazo = 'x', fecha_cierre = now() WHERE id_despacho = $1`, [d.id_despacho]);
  await query(`UPDATE orden_venta SET estado_orden = 'ENTREGADO' WHERE id_orden = $1`, [id]);
  const antes = await stock('TH-4500');
  const r = await t.http('POST', `/api/despachos/${d.id_despacho}/reingresar`, t.bodega);
  assert.equal(r.status, 409);
  assert.equal(r.body.codigo, 'TRANSICION_INVALIDA');
  assert.equal(await stock('TH-4500'), antes);
  assert.equal((await despachos(id))[0].reingresado_en, null);
  assert.equal((await query(`SELECT 1 FROM audit_log WHERE accion = 'REINGRESO' AND (valores_nuevos->>'id_despacho')::int = $1`, [d.id_despacho])).rowCount, 0);
});

test('PI-05: Bodega no puede sacar un RECHAZADO de ese estado sin reingresar (409, el stock no se devuelve)', async () => {
  const { id, idDespacho } = await rechazado();
  const antes = await stock('TH-4500');
  const r = await t.http('PATCH', `/api/pedidos/${id}/estado`, t.bodega, { estado: 'EN_CAMION' });
  assert.equal(r.status, 409);
  assert.equal(await estado(id), 'RECHAZADO');
  assert.equal(await stock('TH-4500'), antes);
  // asignar chofer tampoco sirve antes del reingreso, y el reingreso sí lo habilita
  assert.equal((await t.http('POST', `/api/despachos/${idDespacho}/reingresar`, t.bodega)).status, 200);
  sumados = { 'TH-4500': sumados['TH-4500'] + 2, 'UT-FORNO': sumados['UT-FORNO'] + 1 };
  assert.equal(await estado(id), 'EN_CAMION');
});

test('Permisos: entregas:reingresar para ADMINISTRADOR y BODEGA; pedidos:documentar solo para ADMINISTRADOR; CHOFER ninguno', async () => {
  const roles = Object.fromEntries((await query(`SELECT nombre_rol, permisos FROM rol`)).rows.map((r) => [r.nombre_rol, r.permisos]));
  assert.deepEqual(['ADMINISTRADOR', 'BODEGA', 'CHOFER'].map((n) => roles[n].includes('entregas:reingresar')), [true, true, false]);
  assert.deepEqual(['ADMINISTRADOR', 'BODEGA', 'CHOFER'].map((n) => roles[n].includes('pedidos:documentar')), [true, false, false]);
});
