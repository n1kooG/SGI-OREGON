// GET /api/inventario/sin-ubicacion: productos activos sin ubicación, coherente con `sin_ubicacion` del resumen.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cerrarCache } from '../src/cache.js';
import { pool, query } from '../src/db.js';
import { iniciar } from './_aux.js';

const M = `SU${Date.now().toString(36).toUpperCase()}`;
let t;
const lista = (qs, tok = t.bodega) => t.http('GET', `/api/inventario/sin-ubicacion${qs}`, tok);

before(async () => {
  t = await iniciar();
  // Tres productos de prueba: NULL, vacío/espacios y uno inactivo (no debe listarse); y uno con ubicación.
  const filas = [['A', 'ACTIVO', null, 900], ['B', 'ACTIVO', '   ', 901], ['C', 'INACTIVO', null, 902], ['D', 'ACTIVO', 'Pasillo 1', 903]];
  for (const [k, estado, ubi, stock] of filas) {
    await query(`INSERT INTO producto (sku, modelo, nombre, marca, costo_adquisicion_neto, estado) VALUES ($1,'Mod','Prueba ${M} ${k}','MarcaX',1000,$2)`, [`${M}-${k}`, estado]);
    await query(`INSERT INTO inventario (sku, stock_fisico, ubicacion_bodega) VALUES ($1,$2,$3)`, [`${M}-${k}`, stock, ubi]);
  }
});
after(async () => {
  await query(`DELETE FROM inventario WHERE sku LIKE $1`, [`${M}-%`]);
  await query(`DELETE FROM producto WHERE sku LIKE $1`, [`${M}-%`]);
  t.server.close(); await cerrarCache(); await pool.end();
});

test('sin-ubicacion: lista activos con ubicación NULL o vacía, por stock descendente, sin costos ni precios', async () => {
  const r = await lista(`?q=${M}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.total, 2);
  assert.deepEqual([r.body.pagina, r.body.limite], [1, 20]);
  assert.deepEqual(r.body.items.map((i) => i.sku), [`${M}-B`, `${M}-A`]); // 901 antes que 900
  assert.deepEqual(Object.keys(r.body.items[0]).sort(), ['marca', 'modelo', 'nombre', 'sku', 'stock_fisico']);
  assert.doesNotMatch(JSON.stringify(r.body), /costo|precio|margen/i);
});

test('sin-ubicacion: coincide con la cifra sin_ubicacion del resumen, y asignar una ubicación la baja', async () => {
  const total = async () => (await lista('')).body.total;
  const res = async () => (await t.http('GET', '/api/inventario/resumen', t.bodega)).body.sin_ubicacion;
  const n = await total();
  assert.equal(n, await res());
  assert.equal((await t.http('PUT', `/api/inventario/${M}-A/ubicacion`, t.bodega, { ubicacion_bodega: 'Pasillo 9' })).status, 200);
  assert.equal(await total(), n - 1);
  assert.equal(await res(), n - 1);
  assert.equal((await lista(`?q=${M}-A`)).body.total, 0);
});

test('sin-ubicacion: paginación, búsqueda por SKU o nombre y comodines literales', async () => {
  const p1 = await lista('?limite=1&pagina=1');
  assert.equal(p1.body.items.length, 1);
  assert.equal(p1.body.limite, 1);
  const p2 = await lista('?limite=1&pagina=2');
  assert.notEqual(p1.body.items[0].sku, p2.body.items[0]?.sku);
  assert.equal(p1.body.total, (await lista('')).body.total);
  assert.equal((await lista('?limite=1&pagina=99999')).body.items.length, 0);
  assert.equal((await lista(`?q=${encodeURIComponent(`prueba ${M.toLowerCase()} b`)}`)).body.total, 1); // por nombre, sin distinguir mayúsculas
  assert.equal((await lista('?q=%25')).body.total, 0); // «%» se busca literal
  assert.equal((await lista('?q=')).status, 200);
});

test('sin-ubicacion: parámetros inválidos 400; Administrador y Bodega sí, Chofer 403 y sin sesión 401', async () => {
  for (const qs of ['?limite=0', '?limite=101', '?limite=abc', '?limite=1.5', '?pagina=0', '?pagina=-1', '?pagina=x']) {
    const r = await lista(qs);
    assert.equal(r.status, 400, qs);
    assert.equal(r.body.codigo, 'VALIDACION');
  }
  assert.equal((await lista('?limite=100')).status, 200);
  assert.equal((await lista('', t.admin)).status, 200);
  assert.equal((await lista('', t.chofer)).status, 403);
  assert.equal((await lista('', null)).status, 401);
});
