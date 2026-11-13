// Hallazgo 7: un chofer con despachos PENDIENTE no se puede dar de baja ni cambiar de rol (409 con las órdenes afectadas).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciar, crearPedido, limpiar } from './_aux.js';
import { pool, query } from '../src/db.js';
import { cerrarCache } from '../src/cache.js';

// RUT válido aleatorio (módulo 11): los usuarios con sesión dejan filas en la bitácora inmutable y no se pueden borrar.
function rutAleatorio() {
  const cuerpo = String(10_000_000 + Math.floor(Math.random() * 80_000_000));
  let suma = 0, f = 2;
  for (const d of [...cuerpo].reverse()) { suma += Number(d) * f; f = f === 7 ? 2 : f + 1; }
  const r = 11 - (suma % 11);
  return `${cuerpo.slice(0, 2)}.${cuerpo.slice(2, 5)}.${cuerpo.slice(5)}-${r === 11 ? '0' : r === 10 ? 'K' : r}`;
}
const M = `bch${Date.now().toString(36)}`;
let t, idCh, tokenCh, cont = 0;
const nuevo = (o) => crearPedido(`${M}${++cont}`, o);

before(async () => {
  t = await iniciar();
  const { rows: [u] } = await query(
    `INSERT INTO usuario (rut, nombre_completo, email, password_hash, id_rol) SELECT $2, 'Chofer Baja S4', $1, password_hash, id_rol FROM usuario WHERE email = 'chofer@tiendaoregon.cl' RETURNING id_usuario`, [`${M}@baja.cl`, rutAleatorio()]);
  idCh = u.id_usuario;
  tokenCh = (await t.http('POST', '/api/auth/login', null, { email: `${M}@baja.cl`, password: 'Demo-Oregon-2026' })).body.token;
});
after(async () => {
  await limpiar(M);
  await query(`UPDATE usuario SET activo = false WHERE id_usuario = $1`, [idCh]);
  t.server.close(); await cerrarCache(); await pool.end();
});

test('baja y cambio de rol con despachos pendientes: 409 con la lista de órdenes y sin cambios; con el despacho cerrado procede', async () => {
  const ids = [await nuevo({ estado: 'EN_CAMION' }), await nuevo({ estado: 'EN_CAMION' })];
  for (const id of ids) assert.equal((await t.http('POST', `/api/pedidos/${id}/asignar-chofer`, t.admin, { id_chofer: idCh })).status, 200);

  const baja = await t.http('POST', `/api/usuarios/${idCh}/baja`, t.admin);
  assert.equal(baja.status, 409);
  assert.equal(baja.body.codigo, 'CHOFER_CON_DESPACHOS');
  assert.equal(baja.body.detalle.total, 2);
  assert.deepEqual(baja.body.detalle.ordenes.map((o) => o.id_orden).sort(), [...ids].sort());
  assert.ok(baja.body.detalle.ordenes.every((o) => o.codigo_externo.startsWith(M)));

  const rol = await t.http('PATCH', `/api/usuarios/${idCh}/rol`, t.admin, { rol: 'BODEGA' });
  assert.equal(rol.status, 409);
  assert.equal(rol.body.codigo, 'CHOFER_CON_DESPACHOS');
  assert.deepEqual((await query(`SELECT activo, r.nombre_rol FROM usuario u JOIN rol r USING (id_rol) WHERE id_usuario = $1`, [idCh])).rows[0], { activo: true, nombre_rol: 'CHOFER' });

  // el chofer cierra solo uno: sigue bloqueado y el conteo baja
  const [d1, d2] = (await query(`SELECT id_despacho FROM despacho WHERE id_usuario_chofer = $1 ORDER BY id_despacho`, [idCh])).rows.map((r) => r.id_despacho);
  assert.equal((await t.http('PATCH', `/api/despachos/${d1}`, tokenCh, { estado: 'ENTREGADO' })).status, 200);
  assert.equal((await t.http('POST', `/api/usuarios/${idCh}/baja`, t.admin)).body.detalle.total, 1);
  assert.equal((await t.http('PATCH', `/api/despachos/${d2}`, tokenCh, { estado: 'RECHAZADO', motivo: 'cliente ausente' })).status, 200);

  const ok = await t.http('POST', `/api/usuarios/${idCh}/baja`, t.admin); // sin pendientes (cerrados o rechazados) procede
  assert.equal(ok.status, 200);
  assert.equal(ok.body.activo, false);
});

test('un chofer dado de baja no puede recibir despachos nuevos', async () => {
  const id = await nuevo({ estado: 'EN_CAMION' });
  assert.equal((await t.http('POST', `/api/pedidos/${id}/asignar-chofer`, t.admin, { id_chofer: idCh })).status, 409);
});

test('un usuario que no es chofer se da de baja como siempre', async () => {
  const { rows: [u] } = await query(
    `INSERT INTO usuario (rut, nombre_completo, email, password_hash, id_rol) SELECT $2, 'Bodega Baja S4', $1, password_hash, id_rol FROM usuario WHERE email = 'bodega@tiendaoregon.cl' RETURNING id_usuario`, [`${M}@bodega.cl`, rutAleatorio()]);
  try { assert.equal((await t.http('POST', `/api/usuarios/${u.id_usuario}/baja`, t.admin)).status, 200); }
  finally { await query(`DELETE FROM usuario WHERE id_usuario = $1`, [u.id_usuario]); } // sin sesión: no hay filas de bitácora que lo impidan
});
