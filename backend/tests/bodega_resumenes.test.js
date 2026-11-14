// Resúmenes de Bodega: conteos de pedidos, inventario y descargas de camión pendientes (sin costos ni montos).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciar, crearPedido, limpiar } from './_aux.js';
import { pool, query } from '../src/db.js';
import { cerrarCache } from '../src/cache.js';

const M = `res${Date.now().toString(36)}`;
const FAC = `S4R-${Date.now().toString(36).toUpperCase()}`;
const RUT = '78.806.090-4';
let t, cont = 0, stock0;
const nuevo = (o) => crearPedido(`${M}${++cont}`, o);
const recepcion = (n, items = [{ sku: 'GM-ELEGANCE', cantidad: 2, precio_unitario_neto: 19406 }]) => t.http('POST', '/api/compras/recepciones', t.admin,
  { rut_proveedor: RUT, razon_social: 'GAMA CHILE S.A.', numero_factura: `${FAC}-${n}`, fecha_emision: '2026-09-22', forma_pago: 'Contado', items });
const pendientes = async (tok = t.bodega) => (await t.http('GET', '/api/compras/descargas/pendientes', tok)).body;

before(async () => {
  t = await iniciar();
  stock0 = (await query(`SELECT sku, stock_fisico::int s FROM inventario WHERE sku IN ('GM-ELEGANCE', 'GM-KERATION')`)).rows;
});
after(async () => {
  await query(`DELETE FROM recepcion_compra WHERE numero_factura LIKE '${FAC}-%'`);
  for (const { sku, s } of stock0) await query(`UPDATE inventario SET stock_fisico = $2 WHERE sku = $1`, [sku, s]);
  await limpiar(M);
  t.server.close(); await cerrarCache(); await pool.end();
});

test('Resumen de pedidos: conteos por estado de bodega, rechazados por reingresar y en camión esperando chofer', async () => {
  const antes = (await t.http('GET', '/api/pedidos/resumen', t.bodega)).body;
  assert.deepEqual(Object.keys(antes).sort(), ['armado', 'en_camion_esperando_chofer', 'etiquetado', 'pendiente_preparacion', 'rechazados_por_reingresar']);
  await nuevo(); await nuevo({ estado: 'ARMADO' }); await nuevo({ estado: 'ETIQUETADO' }); await nuevo({ estado: 'EN_CAMION' }); await nuevo({ estado: 'EN_CAMION' });
  const rech = await nuevo({ estado: 'EN_CAMION' }); // se rechaza por la ruta real
  await t.http('POST', `/api/pedidos/${rech}/asignar-chofer`, t.admin, { id_chofer: t.idChofer });
  const { id_despacho } = (await query(`SELECT id_despacho FROM despacho WHERE id_orden = $1`, [rech])).rows[0];
  await t.http('PATCH', `/api/despachos/${id_despacho}`, t.chofer, { estado: 'RECHAZADO', motivo: 'Ausente' });
  const dsp = (await t.http('GET', '/api/pedidos/resumen', t.admin)).body;
  assert.deepEqual([dsp.pendiente_preparacion - antes.pendiente_preparacion, dsp.armado - antes.armado, dsp.etiquetado - antes.etiquetado,
    dsp.en_camion_esperando_chofer - antes.en_camion_esperando_chofer, dsp.rechazados_por_reingresar - antes.rechazados_por_reingresar], [1, 1, 1, 2, 1]);
  assert.equal((await t.http('POST', `/api/despachos/${id_despacho}/reingresar`, t.bodega)).status, 200);
  const fin = (await t.http('GET', '/api/pedidos/resumen', t.bodega)).body;
  assert.equal(fin.rechazados_por_reingresar, antes.rechazados_por_reingresar);
  assert.equal(fin.en_camion_esperando_chofer, antes.en_camion_esperando_chofer + 3); // el reingresado vuelve a esperar chofer
  assert.equal((await t.http('GET', '/api/pedidos/resumen', t.chofer)).status, 403);
  assert.equal((await t.http('GET', '/api/pedidos/resumen', null)).status, 401);
  await query(`UPDATE inventario SET stock_fisico = stock_fisico - 1 WHERE sku = 'TH-4500'`); // el reingreso devolvió la unidad del pedido de prueba
});

test('Resumen de inventario: sin_ubicacion y stock_critico coinciden con la base y no traen costos', async () => {
  const r = await t.http('GET', '/api/inventario/resumen', t.bodega);
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body).sort(), ['sin_ubicacion', 'stock_critico']);
  const critico = (await query(`SELECT count(*)::int n FROM v_stock_critico`)).rows[0].n;
  const sinUbic = (await query(`SELECT count(*)::int n FROM producto p JOIN inventario i USING (sku) WHERE p.estado = 'ACTIVO' AND coalesce(btrim(i.ubicacion_bodega), '') = ''`)).rows[0].n;
  assert.deepEqual(r.body, { sin_ubicacion: sinUbic, stock_critico: critico });
  assert.equal((await t.http('GET', '/api/inventario/resumen', t.admin)).status, 200);
  assert.equal((await t.http('GET', '/api/inventario/resumen', t.chofer)).status, 403);
  assert.equal((await t.http('GET', '/api/inventario/resumen', null)).status, 401);
});

test('Resumen de inventario: quitar la ubicación de un SKU sube sin_ubicacion en 1', async () => {
  const { rows: [p] } = await query(`SELECT sku, ubicacion_bodega FROM inventario JOIN producto USING (sku) WHERE estado = 'ACTIVO' LIMIT 1`);
  await query(`UPDATE inventario SET ubicacion_bodega = 'Pasillo 1, Rack A, Piso 1' WHERE sku = $1`, [p.sku]);
  const antes = (await t.http('GET', '/api/inventario/resumen', t.bodega)).body.sin_ubicacion;
  await query(`UPDATE inventario SET ubicacion_bodega = NULL WHERE sku = $1`, [p.sku]);
  try { assert.equal((await t.http('GET', '/api/inventario/resumen', t.bodega)).body.sin_ubicacion, antes + 1); }
  finally { await query(`UPDATE inventario SET ubicacion_bodega = $2 WHERE sku = $1`, [p.sku, p.ubicacion_bodega]); }
});

test('Descargas pendientes: lista recepciones sin DESCARGA_CONFIRMADA con proveedor, factura, fecha, unidades y detalle por SKU; sin montos', async () => {
  assert.equal((await recepcion('A', [{ sku: 'GM-ELEGANCE', cantidad: 1, precio_unitario_neto: 19406 }, { sku: 'GM-KERATION', cantidad: 3, precio_unitario_neto: 26465 }])).status, 201);
  assert.equal((await recepcion('B')).status, 201);
  const lista = await pendientes();
  const a = lista.find((x) => x.numero_factura === `${FAC}-A`);
  assert.equal(a.nombre_proveedor, 'GAMA CHILE S.A.');
  assert.equal(a.unidades, 4);
  assert.deepEqual(a.detalle, [{ sku: 'GM-ELEGANCE', cantidad: 1 }, { sku: 'GM-KERATION', cantidad: 3 }]);
  assert.ok(a.fecha_emision && a.fecha_recepcion);
  assert.doesNotMatch(JSON.stringify(lista), /monto|precio|costo|iva|neto|url_pdf/i);
  // de la más antigua a la más reciente
  const fechas = lista.map((x) => Date.parse(x.fecha_recepcion));
  assert.deepEqual(fechas, [...fechas].sort((x, y) => x - y));
  assert.ok(lista.findIndex((x) => x.numero_factura === `${FAC}-A`) < lista.findIndex((x) => x.numero_factura === `${FAC}-B`));
  assert.deepEqual((await pendientes(t.admin)).map((x) => x.id_recepcion), lista.map((x) => x.id_recepcion));
});

test('Descargas pendientes: al confirmar la descarga la recepción sale de la lista; las demás siguen', async () => {
  const conf = await t.http('POST', '/api/compras/descargas', t.bodega, { numero_factura: `${FAC}-A`, rut_proveedor: RUT, bultos: [{ sku: 'GM-ELEGANCE', cantidad: 1 }, { sku: 'GM-KERATION', cantidad: 2 }] });
  assert.equal(conf.status, 200);
  assert.equal(conf.body.estado_documento, 'CON_DISCREPANCIA'); // una confirmada con discrepancia deja de estar pendiente igual
  const facturas = (await pendientes()).map((x) => x.numero_factura);
  assert.equal(facturas.includes(`${FAC}-A`), false);
  assert.equal(facturas.includes(`${FAC}-B`), true);
});

test('Descargas pendientes: permisos — Chofer 403, sin sesión 401', async () => {
  assert.equal((await t.http('GET', '/api/compras/descargas/pendientes', t.chofer)).status, 403);
  assert.equal((await t.http('GET', '/api/compras/descargas/pendientes', null)).status, 401);
});
