// Historial de recepciones: filtros, paginación, estado de descarga, detalle facturada/recibida y PDF.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciar } from './_aux.js';
import { pool, query } from '../src/db.js';
import { cerrarCache } from '../src/cache.js';

const SUF = Date.now().toString(36).toUpperCase();
const RUT = '78.806.090-4';
const num = (n) => `HIS-${SUF}-${n}`;
let t, stock0;
const guardarStock = async () => Object.fromEntries((await query(`SELECT sku, stock_fisico::int s FROM inventario WHERE sku LIKE 'GM-%'`)).rows.map((r) => [r.sku, r.s]));
const factura = (n, fecha, items) => t.http('POST', '/api/compras/recepciones', t.admin, {
  rut_proveedor: RUT, razon_social: 'GAMA CHILE S.A.', numero_factura: num(n), fecha_emision: fecha, forma_pago: 'Contado',
  items: items.map(([sku, cantidad]) => ({ sku, cantidad, precio_unitario_neto: 1000 })),
});
const lista = (qs) => t.http('GET', `/api/compras/recepciones?q=HIS-${SUF}&${qs}`, t.admin);

before(async () => {
  t = await iniciar();
  stock0 = await guardarStock();
  await factura('A', '2026-01-10', [['GM-ELEGANCE', 2], ['GM-KERATION', 1]]);
  await factura('B', '2026-01-20', [['GM-COCONUT', 1]]);
  await factura('C', '2026-02-05', [['GM-INNOVA', 3]]);
});
after(async () => {
  await query(`DELETE FROM recepcion_compra WHERE numero_factura LIKE 'HIS-${SUF}-%'`);
  for (const [sku, s] of Object.entries(stock0)) await query(`UPDATE inventario SET stock_fisico = $2 WHERE sku = $1`, [sku, s]);
  t.server.close(); await cerrarCache(); await pool.end();
});

test('solo el administrador lo consulta', async () => {
  for (const ruta of ['/api/compras/recepciones', '/api/compras/recepciones/1', '/api/compras/recepciones/1/pdf', '/api/compras/recepciones/proveedores']) {
    assert.equal((await t.http('GET', ruta, t.bodega)).status, 403, ruta);
    assert.equal((await t.http('GET', ruta, t.chofer)).status, 403, ruta);
  }
});

test('lista paginada, de la más reciente a la más antigua, con total en X-Total-Count y descarga pendiente', async () => {
  const r = await lista('limite=2&pagina=1');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.map((x) => x.numero_factura), [num('C'), num('B')]);
  assert.ok(r.body.every((x) => x.estado_descarga === 'PENDIENTE' && x.tiene_pdf === false));
  assert.equal((await lista('limite=2&pagina=2')).body.length, 1);
  const res = await fetch(`${t.server.address() && `http://localhost:${t.server.address().port}`}/api/compras/recepciones?q=HIS-${SUF}&limite=1`, { headers: { Authorization: `Bearer ${t.admin}` } });
  assert.equal(res.headers.get('x-total-count'), '3');
});

test('filtros: proveedor, rango de fechas de emisión y N° de factura', async () => {
  assert.equal((await lista(`proveedor=${encodeURIComponent(RUT)}`)).body.length, 3);
  assert.equal((await lista('proveedor=gama')).body.length, 3);
  assert.equal((await lista('proveedor=inexistente')).body.length, 0);
  assert.deepEqual((await lista('desde=2026-01-15&hasta=2026-01-31')).body.map((x) => x.numero_factura), [num('B')]);
  assert.deepEqual((await t.http('GET', `/api/compras/recepciones?q=${num('A')}`, t.admin)).body.map((x) => x.numero_factura), [num('A')]);
  assert.equal((await lista('desde=2026-13-01')).status, 400);
  assert.equal((await lista('desde=2026-02-01&hasta=2026-01-01')).status, 400);
});

test('estado de descarga y detalle: conforme, con discrepancia (facturada vs recibida) y pendiente', async () => {
  const ok = await t.http('POST', '/api/compras/descargas', t.bodega, { numero_factura: num('A'), rut_proveedor: RUT, bultos: [{ sku: 'GM-ELEGANCE', cantidad: 2 }, { sku: 'GM-KERATION', cantidad: 1 }] });
  assert.equal(ok.body.estado_documento, 'CONFORME');
  const mal = await t.http('POST', '/api/compras/descargas', t.bodega, { numero_factura: num('C'), rut_proveedor: RUT, bultos: [{ sku: 'GM-INNOVA', cantidad: 1 }] });
  assert.equal(mal.body.estado_documento, 'CON_DISCREPANCIA');
  const estados = Object.fromEntries((await lista('')).body.map((x) => [x.numero_factura, x.estado_descarga]));
  assert.deepEqual(estados, { [num('A')]: 'CONFORME', [num('B')]: 'PENDIENTE', [num('C')]: 'CON_DISCREPANCIA' });

  const idC = (await lista('')).body.find((x) => x.numero_factura === num('C')).id_recepcion;
  const d = await t.http('GET', `/api/compras/recepciones/${idC}`, t.admin);
  assert.equal(d.body.estado_descarga, 'CON_DISCREPANCIA');
  assert.deepEqual(d.body.items.map((i) => [i.sku, i.facturada, i.recibida]), [['GM-INNOVA', 3, 1]]);
  assert.equal(d.body.url_pdf_factura, undefined); // la clave del objeto no sale de la API
  const idB = (await lista('')).body.find((x) => x.numero_factura === num('B')).id_recepcion;
  assert.equal((await t.http('GET', `/api/compras/recepciones/${idB}`, t.admin)).body.items[0].recibida, null); // sin descarga no hay «recibida»
  assert.equal((await t.http('GET', '/api/compras/recepciones/999999999', t.admin)).status, 404);
});

test('PDF: con el almacenamiento desactivado responde 404 con el motivo', async () => {
  const id = (await lista('')).body[0].id_recepcion;
  const r = await t.http('GET', `/api/compras/recepciones/${id}/pdf`, t.admin);
  assert.equal(r.status, 404);
  assert.equal(r.body.codigo, 'SIN_PDF');
  assert.match(r.body.error, /desactivado/);
  assert.equal((await t.http('GET', '/api/compras/recepciones/999999999/pdf', t.admin)).status, 404);
});

test('proveedores distintos para el filtro', async () => {
  const r = await t.http('GET', '/api/compras/recepciones/proveedores', t.admin);
  assert.equal(r.status, 200);
  assert.ok(r.body.some((p) => p.rut_proveedor === RUT && p.nombre_proveedor));
});
