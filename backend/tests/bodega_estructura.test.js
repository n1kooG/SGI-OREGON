// Estructura de la bodega (pasillos, racks, pisos): configuración del Administrador y ubicaciones válidas para los SKU.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cerrarCache } from '../src/cache.js';
import { pool, query } from '../src/db.js';
import { iniciar } from './_aux.js';

const SKU = 'GM-INNOVA';
let t, origUbi, nuevoPasillo;
const get = (tok = t.admin) => t.http('GET', '/api/bodega', tok);
const rack = async (n, letra) => (await query(`SELECT pisos FROM bodega_rack WHERE numero_pasillo = $1 AND letra = $2`, [n, letra])).rows[0]?.pisos;

before(async () => {
  t = await iniciar();
  origUbi = (await query(`SELECT ubicacion_bodega u FROM inventario WHERE sku = $1`, [SKU])).rows[0].u;
  await query(`UPDATE inventario SET ubicacion_bodega = NULL WHERE sku = $1`, [SKU]);
});
after(async () => {
  await query(`UPDATE inventario SET ubicacion_bodega = $2 WHERE sku = $1`, [SKU, origUbi]);
  await query(`DELETE FROM bodega_rack WHERE numero_pasillo >= 50`);
  await query(`DELETE FROM bodega_pasillo WHERE numero >= 50`);
  t.server.close(); await cerrarCache(); await pool.end();
});

test('GET /api/bodega: pasillos → racks → ubicaciones con su etiqueta; lo leen Admin y Bodega, no Chofer', async () => {
  const r = await get();
  assert.equal(r.status, 200);
  const p1 = r.body.pasillos.find((p) => p.numero === 1);
  assert.deepEqual(p1.racks.find((k) => k.letra === 'B').ubicaciones.map((u) => u.ubicacion), ['Pasillo 1, Rack B, Piso 1', 'Pasillo 1, Rack B, Piso 2']);
  assert.equal((await get(t.bodega)).status, 200);
  assert.equal((await get(t.chofer)).status, 403);
  assert.equal((await get(null)).status, 401);
});

test('configurar: solo el Administrador (Bodega y Chofer 403)', async () => {
  for (const tok of [t.bodega, t.chofer]) {
    assert.equal((await t.http('POST', '/api/bodega/pasillos', tok, {})).status, 403);
    assert.equal((await t.http('PUT', '/api/bodega/pasillos/1/racks/A', tok, { pisos: 3 })).status, 403);
    assert.equal((await t.http('DELETE', '/api/bodega/pasillos/1/racks/A', tok)).status, 403);
  }
});

test('pasillos y racks: se crean (letra libre automática o elegida), se validan, quedan en la bitácora y se pueden usar', async () => {
  assert.equal((await t.http('POST', '/api/bodega/pasillos', t.admin, { numero: 0 })).status, 400);
  const p = await t.http('POST', '/api/bodega/pasillos', t.admin, { numero: 50 });
  assert.equal(p.status, 201); nuevoPasillo = p.body.numero;
  assert.equal((await t.http('POST', '/api/bodega/pasillos', t.admin, { numero: 50 })).status, 409);

  const auto = await t.http('POST', `/api/bodega/pasillos/${nuevoPasillo}/racks`, t.admin, { pisos: 3 });
  assert.equal(auto.status, 201);
  assert.match(auto.body.letra, /^[D-Z]$/); // A, B y C ya existen en la bodega
  const dup = await t.http('POST', `/api/bodega/pasillos/${nuevoPasillo}/racks`, t.admin, { letra: auto.body.letra, pisos: 1 });
  assert.equal(dup.status, 409);
  assert.equal((await t.http('POST', `/api/bodega/pasillos/${nuevoPasillo}/racks`, t.admin, { letra: 'ab', pisos: 1 })).status, 400);
  assert.equal((await t.http('POST', `/api/bodega/pasillos/${nuevoPasillo}/racks`, t.admin, { letra: 'q', pisos: 11 })).status, 400);
  assert.equal((await t.http('POST', `/api/bodega/pasillos/${nuevoPasillo}/racks`, t.admin, { letra: 'q' })).status, 400);
  assert.equal((await t.http('POST', '/api/bodega/pasillos/77/racks', t.admin, { pisos: 1 })).status, 404);
  const manual = await t.http('POST', `/api/bodega/pasillos/${nuevoPasillo}/racks`, t.admin, { letra: 'q', pisos: 1 });
  assert.equal(manual.status, 201); assert.equal(manual.body.letra, 'Q');

  const etiqueta = `Pasillo ${nuevoPasillo}, Rack ${auto.body.letra}, Piso 3`;
  assert.equal((await t.http('PUT', `/api/inventario/${SKU}/ubicacion`, t.bodega, { ubicacion_bodega: etiqueta })).status, 200);
  const g = (await get()).body.pasillos.find((x) => x.numero === nuevoPasillo).racks.find((k) => k.letra === auto.body.letra);
  assert.equal(g.ubicaciones[2].productos, 1);
  const acciones = (await query(`SELECT accion FROM audit_log WHERE tabla_afectada = 'bodega' AND id_usuario = $1`, [t.idAdmin])).rows.map((r) => r.accion);
  assert.ok(acciones.includes('CREAR_PASILLO') && acciones.includes('CREAR_RACK'));
  t.rackEnUso = auto.body.letra;
});

test('no deja ubicaciones huérfanas: pisos, rack y pasillo con productos se rechazan (409); vacíos sí se pueden cambiar', async () => {
  const n = nuevoPasillo, l = t.rackEnUso;
  assert.equal((await t.http('PUT', `/api/bodega/pasillos/${n}/racks/${l}`, t.admin, { pisos: 2 })).status, 409); // el producto está en el piso 3
  assert.equal(await rack(n, l), 3);
  assert.equal((await t.http('DELETE', `/api/bodega/pasillos/${n}/racks/${l}`, t.admin)).status, 409);
  assert.equal((await t.http('DELETE', `/api/bodega/pasillos/${n}`, t.admin)).status, 409);
  assert.equal((await t.http('PUT', `/api/bodega/pasillos/${n}/racks/${l}`, t.admin, { pisos: 5 })).status, 200);
  assert.equal(await rack(n, l), 5);

  // Ubicación inexistente: el rack tiene 5 pisos, no 6; y tras liberar el SKU ya se puede reducir y borrar.
  assert.equal((await t.http('PUT', `/api/inventario/${SKU}/ubicacion`, t.bodega, { ubicacion_bodega: `Pasillo ${n}, Rack ${l}, Piso 6` })).status, 400);
  assert.equal((await t.http('PUT', `/api/inventario/${SKU}/ubicacion`, t.bodega, { ubicacion_bodega: null })).status, 200);
  assert.equal((await t.http('PUT', `/api/bodega/pasillos/${n}/racks/${l}`, t.admin, { pisos: 1 })).status, 200);
  assert.equal((await t.http('DELETE', `/api/bodega/pasillos/${n}/racks/${l}`, t.admin)).status, 200);
  assert.equal((await t.http('DELETE', `/api/bodega/pasillos/${n}/racks/${l}`, t.admin)).status, 404);
  assert.equal((await t.http('DELETE', `/api/bodega/pasillos/${n}`, t.admin)).status, 200); // arrastra el rack Q, vacío
  assert.equal(await rack(n, 'Q'), undefined);
});

test('crear un producto con ubicación también exige que exista en la estructura', async () => {
  const sku = `EST-${Date.now().toString(36).toUpperCase()}`;
  const cuerpo = { sku, modelo: 'M', nombre: 'Producto de estructura', marca: 'T', costo_adquisicion_neto: 1000 };
  try {
    assert.equal((await t.http('POST', '/api/productos', t.admin, { ...cuerpo, ubicacion_bodega: 'Pasillo 9, Rack Z, Piso 1' })).status, 400);
    assert.equal((await query(`SELECT 1 FROM producto WHERE sku = $1`, [sku])).rowCount, 0);
    assert.equal((await t.http('POST', '/api/productos', t.admin, { ...cuerpo, ubicacion_bodega: 'Pasillo 1, Rack A, Piso 1' })).status, 201);
  } finally { await query(`DELETE FROM inventario WHERE sku = $1`, [sku]); await query(`DELETE FROM producto WHERE sku = $1`, [sku]); }
});
