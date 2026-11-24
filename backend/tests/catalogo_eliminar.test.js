// DELETE /api/productos/:sku: borra solo sin historial; con compras, ventas o stock responde 409 y se da de baja.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { crearApp } from '../src/app.js';
import { iniciarCache, cerrarCache } from '../src/cache.js';
import { pool, query } from '../src/db.js';
import { crearPedido, limpiar as limpiarPedidos } from './_aux.js';

const PASS = 'Demo-Oregon-2026';
const SUF = Date.now().toString(36).toUpperCase();
const MARCA = `ZDEL${SUF}`;
const sku = (n) => `ZD-${SUF}-${n}`;
const SKUS = ['LIBRE', 'COMPRA', 'VENTA', 'STOCK', 'BAJA'].map(sku);
let server, base, admin, bodega, chofer, desde;
const http = (metodo, ruta, token, body) => fetch(base + ruta, {
  method: metodo, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body),
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
const login = async (email) => (await http('POST', '/api/auth/login', null, { email, password: PASS })).body.token;
const crear = (s) => http('POST', '/api/productos', admin, { sku: s, modelo: 'M', nombre: 'Producto borrable', marca: 'X', costo_adquisicion_neto: 1000, stock_minimo: 0 });
const existe = async (s) => (await query(`SELECT 1 FROM producto WHERE sku = $1`, [s])).rowCount === 1;
const limpiarTodo = async () => {
  await limpiarPedidos(MARCA);
  await query(`DELETE FROM recepcion_compra WHERE numero_factura LIKE $1`, [`${MARCA}%`]);
  await query(`DELETE FROM lista_precio WHERE sku = ANY($1)`, [SKUS]);
  await query(`DELETE FROM inventario WHERE sku = ANY($1)`, [SKUS]);
  await query(`DELETE FROM producto WHERE sku = ANY($1)`, [SKUS]);
};

before(async () => {
  await iniciarCache(); server = crearApp().listen(0); base = `http://localhost:${server.address().port}`;
  await query(`UPDATE usuario SET intentos_fallidos = 0, bloqueado_hasta = NULL`);
  desde = (await query(`SELECT COALESCE(max(id_log), 0) AS m FROM audit_log`)).rows[0].m;
  await limpiarTodo();
  [admin, bodega, chofer] = await Promise.all(['admin', 'bodega', 'chofer'].map((n) => login(`${n}@tiendaoregon.cl`)));
  for (const s of SKUS) assert.equal((await crear(s)).status, 201);
});
after(async () => { await limpiarTodo(); server.close(); await cerrarCache(); await pool.end(); });

test('sin historial: se borra con sus precios e inventario, se audita ELIMINAR y después da 404', async () => {
  assert.equal((await http('PUT', `/api/productos/${sku('LIBRE')}/precios/WEB`, admin, { precio: 2000 })).status, 200);
  const r = await http('DELETE', `/api/productos/${sku('LIBRE').toLowerCase()}`, admin);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.sku, sku('LIBRE'));
  assert.equal(await existe(sku('LIBRE')), false);
  assert.equal((await query(`SELECT count(*)::int n FROM inventario WHERE sku = $1`, [sku('LIBRE')])).rows[0].n, 0);
  assert.equal((await query(`SELECT count(*)::int n FROM lista_precio WHERE sku = $1`, [sku('LIBRE')])).rows[0].n, 0);
  const a = (await query(`SELECT valores_anteriores, valores_nuevos FROM audit_log WHERE id_log > $1 AND tabla_afectada = 'producto' AND accion = 'ELIMINAR' AND valores_anteriores->>'sku' = $2`, [desde, sku('LIBRE')])).rows;
  assert.equal(a.length, 1);
  assert.equal(a[0].valores_nuevos, null);
  assert.equal(Number(a[0].valores_anteriores.costo_adquisicion_neto), 1000);
  assert.equal((await http('GET', `/api/productos/${sku('LIBRE')}`, admin)).status, 404);
  assert.equal((await http('DELETE', `/api/productos/${sku('LIBRE')}`, admin)).status, 404);
});

test('con compras: 409 PRODUCTO_CON_HISTORIAL con conteos y no cambia nada', async () => {
  await query(
    `WITH r AS (INSERT INTO recepcion_compra (id_usuario, numero_factura, rut_proveedor, nombre_proveedor, fecha_emision, forma_pago, monto_neto, monto_iva, monto_total)
                SELECT id_usuario, $2, '78.806.090-4', 'P', CURRENT_DATE, 'Contado', 100, 19, 119 FROM usuario LIMIT 1 RETURNING id_recepcion)
     INSERT INTO detalle_recepcion (id_recepcion, sku, cantidad_recibida, precio_unitario_neto) SELECT id_recepcion, $1, 1, 100 FROM r`, [sku('COMPRA'), `${MARCA}-C`]);
  const r = await http('DELETE', `/api/productos/${sku('COMPRA')}`, admin);
  assert.equal(r.status, 409);
  assert.equal(r.body.codigo, 'PRODUCTO_CON_HISTORIAL');
  assert.deepEqual(r.body.detalle, { compras: 1, ventas: 0, stock: 0 });
  assert.equal(await existe(sku('COMPRA')), true);
  assert.equal((await query(`SELECT count(*)::int n FROM audit_log WHERE id_log > $1 AND accion = 'ELIMINAR' AND valores_anteriores->>'sku' = $2`, [desde, sku('COMPRA')])).rows[0].n, 0);
});

test('con ventas: 409 con el conteo de líneas de venta', async () => {
  await crearPedido(MARCA, { lineas: [[sku('VENTA'), 2]] });
  const r = await http('DELETE', `/api/productos/${sku('VENTA')}`, admin);
  assert.equal(r.status, 409);
  assert.deepEqual(r.body.detalle, { compras: 0, ventas: 1, stock: 0 });
  assert.equal(await existe(sku('VENTA')), true);
});

test('con stock físico > 0: 409 con el stock en el detalle', async () => {
  await query(`UPDATE inventario SET stock_fisico = 7 WHERE sku = $1`, [sku('STOCK')]);
  const r = await http('DELETE', `/api/productos/${sku('STOCK')}`, admin);
  assert.equal(r.status, 409);
  assert.deepEqual(r.body.detalle, { compras: 0, ventas: 0, stock: 7 });
  assert.equal(await existe(sku('STOCK')), true);
});

test('permisos: BODEGA y CHOFER → 403 y sin sesión → 401; el producto sigue existiendo', async () => {
  assert.equal((await http('DELETE', `/api/productos/${sku('BAJA')}`, bodega)).status, 403);
  assert.equal((await http('DELETE', `/api/productos/${sku('BAJA')}`, chofer)).status, 403);
  assert.equal((await http('DELETE', `/api/productos/${sku('BAJA')}`)).status, 401);
  assert.equal(await existe(sku('BAJA')), true);
});

test('dar de baja (INACTIVO) conserva el producto y lo saca del buscador de bodega y de las compras', async () => {
  const busca = async () => (await http('GET', `/api/inventario/buscar?q=${sku('BAJA')}`, bodega)).body.map((p) => p.sku);
  assert.deepEqual(await busca(), [sku('BAJA')]);
  const compra = (n) => http('POST', '/api/compras/recepciones', admin, { rut_proveedor: '78.806.090-4', razon_social: 'GAMA CHILE S.A.', numero_factura: `${MARCA}-B${n}`, fecha_emision: '2026-09-22', forma_pago: 'Contado', items: [{ sku: sku('BAJA'), cantidad: 1, precio_unitario_neto: 100 }] });
  assert.equal((await compra(1)).status, 201);
  assert.equal((await http('PUT', `/api/productos/${sku('BAJA')}`, admin, { estado: 'INACTIVO' })).body.estado, 'INACTIVO');
  assert.deepEqual(await busca(), []);
  const c = await compra(2);
  assert.ok(c.status >= 400 && c.status < 500, `compra de inactivo: ${c.status}`);
  const lista = await http('GET', `/api/productos?q=${sku('BAJA')}`, admin); // el Catálogo sí lo lista
  assert.equal(lista.body[0].estado, 'INACTIVO');
});
