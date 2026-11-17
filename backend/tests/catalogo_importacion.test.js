// Importación masiva del catálogo (.xlsx): simulación sin escritura, aplicar, 422 por precio ≤ costo, límites y permisos.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { iniciar } from './_aux.js';
import { cerrarCache } from '../src/cache.js';
import { pool, query } from '../src/db.js';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const SKUS = ['ZZ-IC1', 'ZZ-IC2', 'ZZ-IC3'];
let ctx, desde;
const limpiar = async () => {
  await query(`DELETE FROM lista_precio WHERE sku = ANY($1)`, [SKUS]);
  await query(`DELETE FROM inventario WHERE sku = ANY($1)`, [SKUS]);
  await query(`DELETE FROM producto WHERE sku = ANY($1)`, [SKUS]);
};
async function xlsx(filas, cab = ['MARCA', 'CODIGO', 'PRODUCTOS', 'COSTO NETO', 'PVP']) {
  const wb = new ExcelJS.Workbook();
  const h = wb.addWorksheet('Lista');
  h.addRow(['Lista de precios']); h.addRow(cab); filas.forEach((f) => h.addRow(f));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const subir = (ruta, token, buffer, nombre = 'catalogo.xlsx') => {
  const f = new FormData();
  if (buffer) f.set('archivo', new Blob([buffer], { type: XLSX }), nombre);
  return ctx.http('POST', ruta, token, f);
};
const BUENO = () => xlsx([['Thomas', 'zz-ic1', 'Hervidor', 10000, 23800], ['Thomas', 'ZZ-IC2', 'Tostador', 20000, 59500]]);
const fila = async (sku) => (await query(`SELECT p.nombre, p.costo_adquisicion_neto::float costo, i.stock_fisico, i.ubicacion_bodega,
  (SELECT precio_venta_neto::float FROM lista_precio WHERE sku = p.sku AND canal_venta = 'WEB') web FROM producto p LEFT JOIN inventario i USING (sku) WHERE sku = $1`, [sku])).rows[0];

before(async () => {
  ctx = await iniciar();
  desde = (await query(`SELECT COALESCE(max(id_log), 0) AS m FROM audit_log`)).rows[0].m;
  await limpiar();
});
after(async () => { await limpiar(); ctx.server.close(); await cerrarCache(); await pool.end(); });

test('simular no escribe y cuenta nuevos, existentes y omitidas', async () => {
  await query(`INSERT INTO producto (sku, modelo, nombre, marca, costo_adquisicion_neto) VALUES ('ZZ-IC2','ZZ-IC2','Viejo','X',100)`);
  const buf = await xlsx([['Thomas', 'zz-ic1', 'Hervidor', 10000, 23800], ['Thomas', 'ZZ-IC2', 'Tostador', 20000, 59500],
    ['Thomas', 'ZZ-IC1', 'Repetido', 1, 1], ['', 'ZZ-IC3', 'Sin marca', 1, 2]]);
  const r = await subir('/api/productos/importacion/simular', ctx.admin, buf);
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.valido, r.body.validos, r.body.nuevos, r.body.existentes], [true, 2, 1, 1]);
  assert.deepEqual(r.body.omitidas.map((o) => o.motivo).sort(), ['datos incompletos', 'repetido']);
  assert.equal(r.body.productos.find((p) => p.sku === 'ZZ-IC2').existe, true);
  assert.equal((await query(`SELECT count(*)::int n FROM producto WHERE sku = 'ZZ-IC1'`)).rows[0].n, 0);
  assert.equal((await fila('ZZ-IC2')).nombre, 'Viejo');
  await limpiar();
});

test('aplicar crea con stock 0 y precios, actualiza existentes sin tocar stock ni ubicación; es idempotente', async () => {
  await query(`INSERT INTO producto (sku, modelo, nombre, marca, costo_adquisicion_neto) VALUES ('ZZ-IC2','ZZ-IC2','Viejo','X',100)`);
  await query(`INSERT INTO inventario (sku, stock_fisico, ubicacion_bodega) VALUES ('ZZ-IC2', 7, NULL)`);
  const r = await subir('/api/productos/importacion', ctx.admin, await BUENO());
  assert.equal(r.status, 201);
  assert.deepEqual([r.body.nuevos, r.body.actualizados, r.body.validos], [1, 1, 2]);
  const nuevo = await fila('ZZ-IC1');
  assert.deepEqual([nuevo.stock_fisico, nuevo.costo, nuevo.web], [0, 10000, 20000]);
  const viejo = await fila('ZZ-IC2');
  assert.deepEqual([viejo.nombre, viejo.stock_fisico, viejo.ubicacion_bodega, viejo.costo], ['Tostador', 7, null, 20000]);
  const otra = await subir('/api/productos/importacion', ctx.admin, await BUENO());
  assert.deepEqual([otra.status, otra.body.nuevos, otra.body.actualizados], [201, 0, 2]);
  assert.equal((await query(`SELECT count(*)::int n FROM lista_precio WHERE sku = ANY($1)`, [SKUS])).rows[0].n, 6);
  const bit = (await query(`SELECT valores_nuevos FROM audit_log WHERE id_log > $1 AND accion = 'IMPORTACIÓN' AND tabla_afectada = 'producto' ORDER BY id_log`, [desde])).rows;
  assert.equal(bit.length, 2);
  assert.equal(bit[0].valores_nuevos.archivo, 'catalogo.xlsx');
});

test('precio <= costo: simular lo informa y aplicar responde 422 sin escribir nada', async () => {
  await limpiar();
  // PVP 10 con costo 20000: WEB y MARKETPLACE quedan bajo el costo.
  const buf = await xlsx([['Thomas', 'ZZ-IC1', 'Bueno', 10000, 23800], ['Thomas', 'ZZ-IC3', 'Malo', 20000, 10]]);
  const s = await subir('/api/productos/importacion/simular', ctx.admin, buf);
  assert.equal(s.status, 200);
  assert.equal(s.body.valido, false);
  assert.deepEqual(s.body.bajo_costo.map((p) => p.sku), ['ZZ-IC3']);
  const a = await subir('/api/productos/importacion', ctx.admin, buf);
  assert.equal(a.status, 422);
  assert.deepEqual(a.body.detalle.map((p) => p.sku), ['ZZ-IC3']);
  assert.equal((await query(`SELECT count(*)::int n FROM producto WHERE sku = ANY($1)`, [SKUS])).rows[0].n, 0);
});

test('archivos inválidos: no .xlsx, sin archivo, corrupto, sin encabezados, mayor a 5 MB', async () => {
  const mal = (r, status) => assert.equal(r.status, status, JSON.stringify(r.body));
  mal(await subir('/api/productos/importacion/simular', ctx.admin, await BUENO(), 'catalogo.csv'), 400);
  mal(await subir('/api/productos/importacion/simular', ctx.admin, null), 400);
  mal(await subir('/api/productos/importacion/simular', ctx.admin, Buffer.from('PK no es un zip de verdad')), 400);
  mal(await subir('/api/productos/importacion/simular', ctx.admin, await xlsx([['a', 'b']], ['X', 'Y'])), 400);
  mal(await subir('/api/productos/importacion', ctx.admin, Buffer.alloc(5 * 1024 * 1024 + 1)), 413);
});

test('permisos: BODEGA y CHOFER reciben 403; sin sesión 401', async () => {
  for (const t of [ctx.bodega, ctx.chofer]) {
    assert.equal((await subir('/api/productos/importacion/simular', t, await BUENO())).status, 403);
    assert.equal((await subir('/api/productos/importacion', t, await BUENO())).status, 403);
    assert.equal((await ctx.http('GET', '/api/productos/importacion/plantilla', t)).status, 403);
  }
  assert.equal((await subir('/api/productos/importacion', null, await BUENO())).status, 401);
  assert.equal((await query(`SELECT count(*)::int n FROM producto WHERE sku = ANY($1)`, [SKUS])).rows[0].n, 0);
});

test('plantilla: .xlsx con los encabezados', async () => {
  const r = await ctx.http('GET', '/api/productos/importacion/plantilla', ctx.admin);
  assert.equal(r.status, 200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(r.body);
  assert.deepEqual(wb.worksheets[0].getRow(1).values.slice(1), ['MARCA', 'CODIGO', 'PRODUCTOS', 'COSTO NETO', 'PVP']);
});
