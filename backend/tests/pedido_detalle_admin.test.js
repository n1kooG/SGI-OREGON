// Detalle de pedido del Administrador: chofer, fechas del despacho y geolocalización del cierre.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciar, crearPedido, limpiar } from './_aux.js';
import { pool } from '../src/db.js';
import { cerrarCache } from '../src/cache.js';

const M = `det${Date.now().toString(36)}`;
let t, id;
before(async () => { t = await iniciar(); id = await crearPedido(M, { estado: 'EN_CAMION' }); });
after(async () => { await limpiar(M); t.server.close(); await cerrarCache(); await pool.end(); });

test('sin despacho el detalle no trae chofer ni geolocalización', async () => {
  const { body } = await t.http('GET', `/api/pedidos/${id}`, t.admin);
  assert.equal(body.nombre_chofer, null);
  assert.equal(body.geolocalizacion, null);
  assert.equal(body.tiene_evidencia, false);
});

test('entregado: el detalle expone chofer, fechas y la geolocalización registrada al cerrar', async () => {
  await t.http('POST', `/api/pedidos/${id}/asignar-chofer`, t.admin, { id_chofer: t.idChofer });
  const { body: ruta } = await t.http('GET', '/api/despachos/mi-ruta', t.chofer);
  const d = ruta.find((x) => x.id_orden === id);
  const f = new FormData();
  f.append('estado', 'ENTREGADO'); f.append('nombre_receptor', 'Cliente S3'); f.append('latitud', '-33.4189'); f.append('longitud', '-70.5830');
  assert.equal((await t.http('PATCH', `/api/despachos/${d.id_despacho}`, t.chofer, f)).status, 200);
  const { body } = await t.http('GET', `/api/pedidos/${id}`, t.admin);
  assert.equal(body.nombre_chofer, 'Carlos Chofer');
  assert.ok(body.fecha_asignacion && body.fecha_cierre);
  assert.equal(body.geolocalizacion, '-33.418900,-70.583000');
  assert.equal(body.tiene_evidencia, false);
  assert.match(body.rut_cliente ?? 'sin-rut', /./);
});
