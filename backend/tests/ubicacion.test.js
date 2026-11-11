// Ubicación en bodega: PUT /api/inventario/:sku/ubicacion, alta de producto con ubicación y descarga de camión con ubicación.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cerrarCache } from '../src/cache.js';
import { pool, query } from '../src/db.js';
import { iniciar } from './_aux.js';

const SKU = 'GM-ELEGANCE';
const SKU2 = 'GM-KERATION';
const NUEVO = `UBI-${Date.now().toString(36).toUpperCase()}`;
const FACTURA = `UBI-${Date.now().toString(36).toUpperCase()}`;
let ctx, orig;
const ubicacion = async (sku) => (await query(`SELECT ubicacion_bodega u FROM inventario WHERE sku = $1`, [sku])).rows[0]?.u;
const bitacora = async (sku, accion = 'UBICACION') =>
  (await query(`SELECT * FROM audit_log WHERE accion = $1 AND valores_nuevos->>'sku' = $2 ORDER BY id_log DESC`, [accion, sku])).rows;
const poner = (token, sku, ubicacion_bodega) => ctx.http('PUT', `/api/inventario/${sku}/ubicacion`, token, { ubicacion_bodega });

before(async () => {
  ctx = await iniciar();
  orig = Object.fromEntries((await query(`SELECT sku, ubicacion_bodega u, stock_fisico::int s FROM inventario WHERE sku = ANY($1)`, [[SKU, SKU2]])).rows.map((r) => [r.sku, r]));
});
after(async () => {
  for (const [sku, o] of Object.entries(orig)) await query(`UPDATE inventario SET ubicacion_bodega = $2, stock_fisico = $3 WHERE sku = $1`, [sku, o.u, o.s]);
  await query(`DELETE FROM recepcion_compra WHERE numero_factura = $1`, [FACTURA]);
  await query(`DELETE FROM inventario WHERE sku = $1`, [NUEVO]);
  await query(`DELETE FROM producto WHERE sku = $1`, [NUEVO]);
  ctx.server.close(); await cerrarCache(); await pool.end();
});

test('ubicar: Admin la fija recortada, responde sin costos y queda en la bitácora con antes/después', async () => {
  const r = await poner(ctx.admin, SKU, '  Pasillo A - Estante 2  ');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { sku: SKU, ubicacion_bodega: 'Pasillo A - Estante 2' });
  assert.equal(await ubicacion(SKU), 'Pasillo A - Estante 2');
  const [a] = await bitacora(SKU);
  assert.equal(a.tabla_afectada, 'inventario');
  assert.equal(a.valores_anteriores.ubicacion_bodega, orig[SKU].u);
  assert.equal(a.valores_nuevos.ubicacion_bodega, 'Pasillo A - Estante 2');
});

test('ubicar: sin cambio no escribe ni audita; vacío o solo espacios la quita (NULL)', async () => {
  const n = (await bitacora(SKU)).length;
  assert.equal((await poner(ctx.admin, SKU, 'Pasillo A - Estante 2')).status, 200);
  assert.equal((await bitacora(SKU)).length, n);
  for (const v of ['', '   ', null]) {
    await poner(ctx.admin, SKU, 'X-1');
    const r = await poner(ctx.admin, SKU, v);
    assert.equal(r.status, 200);
    assert.equal(r.body.ubicacion_bodega, null);
    assert.equal(await ubicacion(SKU), null);
  }
});

test('ubicar: valida longitud, tipo y cuerpo; SKU inexistente = 404', async () => {
  assert.equal((await poner(ctx.admin, SKU, 'x'.repeat(41))).status, 400);
  assert.equal((await poner(ctx.admin, SKU, 'x'.repeat(40))).status, 200);
  assert.equal((await poner(ctx.admin, SKU, 123)).status, 400);
  assert.equal((await ctx.http('PUT', `/api/inventario/${SKU}/ubicacion`, ctx.admin, {})).status, 400);
  assert.equal((await poner(ctx.admin, 'NO-EXISTE-XYZ', 'A-1')).status, 404);
  assert.equal(await ubicacion(SKU), 'x'.repeat(40)); // los rechazos no modifican nada
});

test('ubicar: no es inyectable (va parametrizado)', async () => {
  const raro = `A'; DROP TABLE inventario;--`;
  assert.equal((await poner(ctx.admin, SKU, raro)).status, 200);
  assert.equal(await ubicacion(SKU), raro);
});

test('ubicar: Bodega puede; Chofer y sin sesión no', async () => {
  const r = await poner(ctx.bodega, SKU, 'Pasillo B');
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body).sort(), ['sku', 'ubicacion_bodega']);
  assert.equal((await bitacora(SKU))[0].id_usuario, ctx.idBodega);
  assert.equal((await poner(ctx.chofer, SKU, 'Pasillo C')).status, 403);
  assert.equal((await poner(null, SKU, 'Pasillo C')).status, 401);
  assert.equal(await ubicacion(SKU), 'Pasillo B');
});

test('permisos: ADMINISTRADOR y BODEGA tienen inventario:ubicar; CHOFER no', async () => {
  const roles = Object.fromEntries((await query(`SELECT nombre_rol, permisos FROM rol`)).rows.map((r) => [r.nombre_rol, r.permisos]));
  assert.ok(roles.ADMINISTRADOR.includes('inventario:ubicar') && roles.BODEGA.includes('inventario:ubicar'));
  assert.ok(!roles.CHOFER.includes('inventario:ubicar'));
});

test('crear producto: el inventario nace con stock 0 y la ubicación opcional', async () => {
  const cuerpo = { sku: NUEVO, modelo: 'M', nombre: 'Producto ubicado', marca: 'T', costo_adquisicion_neto: 1000, ubicacion_bodega: ' Pasillo D - Estante 1 ' };
  assert.equal((await ctx.http('POST', '/api/productos', ctx.admin, { ...cuerpo, ubicacion_bodega: 'x'.repeat(41) })).status, 400);
  const r = await ctx.http('POST', '/api/productos', ctx.admin, cuerpo);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.ubicacion_bodega, 'Pasillo D - Estante 1');
  assert.equal(Number(r.body.stock_fisico), 0);
});

// Descarga de camión: la ubicación es opcional por línea y va en la transacción de la confirmación.
const factura = async () => ctx.http('POST', '/api/compras/recepciones', ctx.admin, {
  rut_proveedor: '78.806.090-4', razon_social: 'GAMA CHILE S.A.', numero_factura: FACTURA, fecha_emision: '2026-09-22', forma_pago: 'Contado',
  items: [{ sku: SKU, cantidad: 1, precio_unitario_neto: 1000 }, { sku: SKU2, cantidad: 1, precio_unitario_neto: 1000 }],
});
const descarga = (bultos) => ctx.http('POST', '/api/compras/descargas', ctx.bodega, { numero_factura: FACTURA, bultos });

test('descarga: sin ubicación no toca nada; con ubicación la guarda y audita', async () => {
  assert.equal((await factura()).status, 201);
  await query(`UPDATE inventario SET ubicacion_bodega = 'Previa' WHERE sku = ANY($1)`, [[SKU, SKU2]]);
  const n = (await bitacora(SKU)).length;
  const sin = await descarga([{ sku: SKU, cantidad: 1 }, { sku: SKU2, cantidad: 1 }]);
  assert.equal(sin.status, 200, JSON.stringify(sin.body));
  assert.equal(await ubicacion(SKU), 'Previa');
  assert.equal((await bitacora(SKU)).length, n);

  const con = await descarga([{ sku: SKU, cantidad: 1, ubicacion: ' Pasillo E - Estante 3 ' }, { sku: SKU2, cantidad: 1 }]);
  assert.equal(con.status, 200, JSON.stringify(con.body));
  assert.equal(con.body.estado_documento, 'CONFORME');
  assert.equal(await ubicacion(SKU), 'Pasillo E - Estante 3');
  assert.equal(await ubicacion(SKU2), 'Previa');
  assert.equal((await bitacora(SKU))[0].valores_nuevos.ubicacion_bodega, 'Pasillo E - Estante 3');
});

test('descarga: una ubicación inválida revierte toda la confirmación', async () => {
  const antes = (await query(`SELECT count(*)::int n FROM audit_log WHERE accion = 'DESCARGA_CONFIRMADA' AND valores_nuevos->>'factura' = $1`, [FACTURA])).rows[0].n;
  const r = await descarga([{ sku: SKU, cantidad: 1, ubicacion: 'x'.repeat(41) }]);
  assert.equal(r.status, 400);
  assert.equal((await query(`SELECT count(*)::int n FROM audit_log WHERE accion = 'DESCARGA_CONFIRMADA' AND valores_nuevos->>'factura' = $1`, [FACTURA])).rows[0].n, antes);
  assert.equal(await ubicacion(SKU), 'Pasillo E - Estante 3');
});
