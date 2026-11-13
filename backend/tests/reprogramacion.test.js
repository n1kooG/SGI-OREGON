// Reprogramar entrega (POST /api/pedidos/:id/reprogramar), ruta del chofer con paradas programadas y campos nuevos de pedidos.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciar, crearPedido, limpiar } from './_aux.js';
import { pool, query } from '../src/db.js';
import { cerrarCache } from '../src/cache.js';

const M = `rep${Date.now().toString(36)}`;
let t, idOtro, cont = 0, devuelto = 0;
const nuevo = (o) => crearPedido(`${M}${++cont}`, o);
const fecha = async (dias = 0) => (await query(`SELECT (fn_hoy() + $1::int)::text AS f`, [dias])).rows[0].f;
const despachos = async (id) => (await query(`SELECT * FROM despacho WHERE id_orden = $1 ORDER BY id_despacho`, [id])).rows;
const pedido = async (id) => (await query(`SELECT * FROM orden_venta WHERE id_orden = $1`, [id])).rows[0];
const bitacora = async (id) => (await query(`SELECT * FROM audit_log WHERE accion = 'REPROGRAMACION' AND (valores_nuevos->>'id_orden')::int = $1`, [id])).rows;
const reprog = (id, body, tok = t.admin) => t.http('POST', `/api/pedidos/${id}/reprogramar`, tok, body);

// Pedido rechazado por el chofer y reingresado a bodega (EN_CAMION con último despacho RECHAZADO + reingresado).
async function reingresado() {
  const id = await nuevo({ estado: 'EN_CAMION' });
  await t.http('POST', `/api/pedidos/${id}/asignar-chofer`, t.admin, { id_chofer: t.idChofer });
  const [d] = await despachos(id);
  assert.equal((await t.http('PATCH', `/api/despachos/${d.id_despacho}`, t.chofer, { estado: 'RECHAZADO', motivo: 'Cliente ausente' })).status, 200);
  assert.equal((await t.http('POST', `/api/despachos/${d.id_despacho}/reingresar`, t.admin)).status, 200);
  devuelto += 1;
  return id;
}

before(async () => {
  t = await iniciar();
  const { rows: [u] } = await query(
    `INSERT INTO usuario (rut, nombre_completo, email, password_hash, id_rol) SELECT '66.666.666-6', 'Chofer Ajeno R', $1, password_hash, id_rol FROM usuario WHERE email = 'chofer@tiendaoregon.cl' RETURNING id_usuario`, [`${M}@ajeno.cl`]);
  idOtro = u.id_usuario;
});
after(async () => {
  await query(`UPDATE inventario SET stock_fisico = stock_fisico - $1 WHERE sku = 'TH-4500'`, [devuelto]);
  await limpiar(M);
  await query(`DELETE FROM usuario WHERE id_usuario = $1`, [idOtro]);
  t.server.close(); await cerrarCache(); await pool.end();
});

test('reprogramar: crea el despacho nuevo, actualiza los datos de entrega, pasa a EN_RUTA y audita con antes/después', async () => {
  const id = await reingresado();
  const f = await fecha(3);
  const r = await reprog(id, { id_chofer: t.idChofer, fecha_entrega: f, nota: '  Llamar al portero  ', direccion_despacho: 'Av. Nueva 123', comuna: 'Ñuñoa', telefono_contacto: '+56 9 8765-4321' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.estado_orden, 'EN_RUTA');
  assert.equal(r.body.fecha_programada, f);
  assert.equal(r.body.nota_admin, 'Llamar al portero');
  const p = await pedido(id);
  assert.equal(p.estado_orden, 'EN_RUTA');
  assert.deepEqual([p.direccion_despacho, p.comuna, p.telefono_contacto], ['Av. Nueva 123', 'Ñuñoa', '+56 9 8765-4321']);
  const ds = await despachos(id);
  assert.equal(ds.length, 2);
  assert.equal(ds[1].id_despacho, r.body.id_despacho);
  assert.equal(ds[1].estado_entrega, 'PENDIENTE');
  assert.equal(ds[1].nota_admin, 'Llamar al portero');
  assert.equal(ds[1].id_usuario_asigna, t.idAdmin);
  assert.equal((await query(`SELECT fecha_programada::text f FROM despacho WHERE id_despacho = $1`, [ds[1].id_despacho])).rows[0].f, f);
  assert.equal(ds[0].estado_entrega, 'RECHAZADO'); // el intento anterior se conserva
  const [a] = await bitacora(id);
  assert.equal(a.id_usuario, t.idAdmin);
  assert.equal(a.valores_anteriores.direccion_despacho, 'Providencia 1251');
  assert.equal(a.valores_nuevos.direccion_despacho, 'Av. Nueva 123');
  assert.equal(a.valores_anteriores.comuna, 'Providencia');
  assert.equal(a.valores_nuevos.nota_largo, 'Llamar al portero'.length);
  assert.doesNotMatch(JSON.stringify(a), /portero/); // la nota completa no va a la bitácora
});

test('reprogramar: sin datos de entrega solo audita lo que cambió (nada) y deja la dirección intacta', async () => {
  const id = await reingresado();
  const r = await reprog(id, { id_chofer: t.idChofer, fecha_entrega: await fecha(0), direccion_despacho: 'Providencia 1251' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.direccion_despacho, undefined); // sin cambio no se informa
  const [a] = await bitacora(id);
  assert.equal(a.valores_nuevos.direccion_despacho, undefined);
  assert.equal(a.valores_nuevos.nota_largo, 0);
  assert.equal((await despachos(id))[1].nota_admin, null);
});

test('reprogramar: pedidos e intentos (listado y detalle) y la ruta del chofer con la parada futura', async () => {
  const id = await reingresado();
  const f = await fecha(2);
  assert.equal((await reprog(id, { id_chofer: t.idChofer, fecha_entrega: f, nota: 'Entregar en conserjería' })).status, 200);
  const [d1, d2] = await despachos(id);

  for (const tok of [t.admin, t.bodega]) {
    const fila = (await t.http('GET', '/api/pedidos?estado=EN_RUTA', tok)).body.find((x) => x.id_orden === id);
    assert.equal(fila.intento, 2);
    assert.equal(fila.reprogramado, true);
    assert.equal(fila.fecha_programada, f);
    assert.equal(fila.nota_admin, 'Entregar en conserjería');
    assert.equal(fila.direccion_despacho, 'Providencia 1251');
    assert.equal(fila.fecha_rechazo, null); // el último despacho está pendiente
  }
  const adm = (await t.http('GET', `/api/pedidos/${id}`, t.admin)).body;
  assert.equal(adm.intento, 2);
  assert.equal(adm.reprogramado, true);
  assert.equal(adm.fecha_programada, f);
  assert.equal(adm.intentos.length, 2);
  assert.deepEqual(adm.intentos.map((i) => i.intento), [1, 2]);
  assert.equal(adm.intentos[0].estado_entrega, 'RECHAZADO');
  assert.equal(adm.intentos[0].motivo_rechazo, 'Cliente ausente');
  assert.ok(adm.intentos[0].reingresado_en);
  assert.equal(adm.intentos[0].id_despacho, d1.id_despacho);
  assert.equal(adm.intentos[1].id_despacho, d2.id_despacho);
  assert.equal(adm.intentos[1].chofer, 'Carlos Chofer');
  assert.equal(adm.intentos[1].asignado_por, 'Jefatura Administrativa');
  assert.equal(adm.intentos[1].nota_admin, 'Entregar en conserjería');
  assert.equal(adm.intentos[1].fecha_programada, f);
  const bod = (await t.http('GET', `/api/pedidos/${id}`, t.bodega)).body;
  assert.equal(bod.intentos.length, 2);
  assert.ok(bod.intentos.every((i) => !('chofer' in i) && !('asignado_por' in i)));
  assert.doesNotMatch(JSON.stringify(bod), /costo|margen|precio|subtotal/i);

  // Ruta del chofer: arreglo, con la parada futura marcada y sin paradas de otro chofer.
  const ruta = await t.http('GET', '/api/despachos/mi-ruta', t.chofer);
  assert.ok(Array.isArray(ruta.body));
  const p = ruta.body.find((x) => x.id_despacho === d2.id_despacho);
  assert.deepEqual([p.futura, p.reprogramada, p.intento, p.fecha_programada, p.nota_admin], [true, true, 2, f, 'Entregar en conserjería']);
  assert.equal(ruta.body.find((x) => x.id_despacho === d1.id_despacho)?.futura ?? false, false);
  // No cuenta como pendiente de hoy
  const antes = (await t.http('GET', '/api/despachos/mi-ruta/resumen', t.chofer)).body.pendientes;
  await query(`UPDATE despacho SET fecha_programada = fn_hoy() WHERE id_despacho = $1`, [d2.id_despacho]);
  assert.equal((await t.http('GET', '/api/despachos/mi-ruta/resumen', t.chofer)).body.pendientes, antes + 1);
  await query(`UPDATE despacho SET fecha_programada = fn_hoy() + 2 WHERE id_despacho = $1`, [d2.id_despacho]);

  // Detalle, y no se puede cerrar antes de la fecha
  const det = (await t.http('GET', `/api/despachos/${d2.id_despacho}`, t.chofer)).body;
  assert.deepEqual([det.futura, det.reprogramada, det.intento, det.nota_admin], [true, true, 2, 'Entregar en conserjería']);
  for (const estado of [{ estado: 'ENTREGADO' }, { estado: 'RECHAZADO', motivo: 'x' }]) {
    const c = await t.http('PATCH', `/api/despachos/${d2.id_despacho}`, t.chofer, estado);
    assert.equal(c.status, 409);
    assert.equal(c.body.codigo, 'FUERA_DE_FECHA');
    assert.match(c.body.error, /programada para el/);
  }
  assert.equal((await pedido(id)).estado_orden, 'EN_RUTA');
  // Llegado el día se cierra normalmente y entra al historial como reprogramada
  await query(`UPDATE despacho SET fecha_programada = fn_hoy() WHERE id_despacho = $1`, [d2.id_despacho]);
  assert.equal((await t.http('PATCH', `/api/despachos/${d2.id_despacho}`, t.chofer, { estado: 'ENTREGADO', nombre_receptor: 'Portero' })).status, 200);
  const h = (await t.http('GET', '/api/despachos/historial?limite=100', t.chofer)).body.items.find((x) => x.id_despacho === d2.id_despacho);
  assert.deepEqual([h.reprogramada, h.nota_admin], [true, 'Entregar en conserjería']);
  assert.equal((await t.http('GET', `/api/pedidos/${id}`, t.admin)).body.intentos[1].estado_entrega, 'ENTREGADO');
});

test('reprogramar: pedido rechazado muestra fecha_rechazo e intento 1 en el listado', async () => {
  const id = await nuevo({ estado: 'EN_CAMION' });
  await t.http('POST', `/api/pedidos/${id}/asignar-chofer`, t.admin, { id_chofer: t.idChofer });
  const [d] = await despachos(id);
  await t.http('PATCH', `/api/despachos/${d.id_despacho}`, t.chofer, { estado: 'RECHAZADO', motivo: 'Dirección errónea' });
  const fila = (await t.http('GET', '/api/pedidos?por_reingresar=1', t.bodega)).body.find((x) => x.id_orden === id);
  assert.equal(fila.intento, 1);
  assert.equal(fila.reprogramado, false);
  assert.ok(fila.fecha_rechazo);
  assert.equal(fila.fecha_programada, await fecha(0));
});

test('ruta del chofer: no incluye las paradas (de hoy ni futuras) de otro chofer', async () => {
  const id = await reingresado();
  assert.equal((await reprog(id, { id_chofer: idOtro, fecha_entrega: await fecha(2) })).status, 200);
  const ajeno = await nuevo({ estado: 'EN_CAMION' });
  await t.http('POST', `/api/pedidos/${ajeno}/asignar-chofer`, t.admin, { id_chofer: idOtro });
  const ruta = (await t.http('GET', '/api/despachos/mi-ruta', t.chofer)).body;
  assert.ok(Array.isArray(ruta));
  assert.equal(ruta.some((x) => x.estado_entrega === 'PENDIENTE' && (x.id_orden === id || x.id_orden === ajeno)), false);
  const [, d2] = await despachos(id);
  assert.equal((await t.http('GET', `/api/despachos/${d2.id_despacho}`, t.chofer)).status, 404);
  assert.equal((await t.http('PATCH', `/api/despachos/${d2.id_despacho}`, t.chofer, { estado: 'ENTREGADO' })).status, 404);
});

test('asignar-chofer: no cambia su contrato, fija fecha_programada = hoy y registra quién asignó', async () => {
  const id = await nuevo({ estado: 'EN_CAMION' });
  const r = await t.http('POST', `/api/pedidos/${id}/asignar-chofer`, t.admin, { id_chofer: t.idChofer });
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body).sort(), ['id_despacho', 'id_orden', 'id_usuario_chofer', 'estado_orden'].sort());
  const [d] = (await query(`SELECT fecha_programada::text f, id_usuario_asigna, nota_admin FROM despacho WHERE id_orden = $1`, [id])).rows;
  assert.deepEqual([d.f, d.id_usuario_asigna, d.nota_admin], [await fecha(0), t.idAdmin, null]);
  const ruta = (await t.http('GET', '/api/despachos/mi-ruta', t.chofer)).body.find((x) => x.id_orden === id);
  assert.deepEqual([ruta.futura, ruta.reprogramada, ruta.intento], [false, false, 1]);
});

test('reprogramar: permisos (Bodega y Chofer 403, sin sesión 401) y pedido inexistente 404', async () => {
  const id = await reingresado();
  const body = { id_chofer: t.idChofer, fecha_entrega: await fecha(1) };
  assert.equal((await reprog(id, body, t.bodega)).status, 403);
  assert.equal((await reprog(id, body, t.chofer)).status, 403);
  assert.equal((await reprog(id, body, null)).status, 401);
  assert.equal((await reprog(999999999, body)).status, 404);
  assert.equal((await pedido(id)).estado_orden, 'EN_CAMION'); // nada cambió
});

test('reprogramar: solo un pedido EN_CAMION con el último despacho rechazado y reingresado (409 NO_REPROGRAMABLE)', async () => {
  const body = { id_chofer: t.idChofer, fecha_entrega: await fecha(1) };
  const sinDespacho = await nuevo({ estado: 'EN_CAMION' });
  const enRuta = await nuevo({ estado: 'EN_CAMION' });
  await t.http('POST', `/api/pedidos/${enRuta}/asignar-chofer`, t.admin, { id_chofer: t.idChofer });
  const rechazoSinReingreso = await nuevo({ estado: 'EN_CAMION' });
  await t.http('POST', `/api/pedidos/${rechazoSinReingreso}/asignar-chofer`, t.admin, { id_chofer: t.idChofer });
  await t.http('PATCH', `/api/despachos/${(await despachos(rechazoSinReingreso))[0].id_despacho}`, t.chofer, { estado: 'RECHAZADO', motivo: 'x' });
  const armado = await nuevo({ estado: 'ARMADO' });
  for (const id of [sinDespacho, enRuta, rechazoSinReingreso, armado]) {
    const r = await reprog(id, body);
    assert.equal(r.status, 409, `${id}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.codigo, 'NO_REPROGRAMABLE');
  }
  // un reingresado ya reprogramado (EN_RUTA) no se reprograma dos veces
  const id = await reingresado();
  assert.equal((await reprog(id, body)).status, 200);
  assert.equal((await reprog(id, body)).status, 409);
  assert.equal((await despachos(id)).length, 2);
});

test('reprogramar: valida fecha (inválida o pasada), nota, dirección, comuna, teléfono e id_chofer con 400', async () => {
  const id = await reingresado();
  const ok = { id_chofer: t.idChofer, fecha_entrega: await fecha(1) };
  const malos = [
    [{ ...ok, fecha_entrega: await fecha(-1) }, 'FECHA_PASADA'],
    [{ ...ok, fecha_entrega: '2026-02-30' }], [{ ...ok, fecha_entrega: '12-05-2027' }], [{ ...ok, fecha_entrega: undefined }], [{ ...ok, fecha_entrega: 20260601 }],
    [{ ...ok, id_chofer: '1' }], [{ ...ok, id_chofer: undefined }], [{ ...ok, id_chofer: -3 }],
    [{ ...ok, nota: 'n'.repeat(301) }], [{ ...ok, nota: 5 }],
    [{ ...ok, direccion_despacho: 'd'.repeat(201) }], [{ ...ok, direccion_despacho: '   ' }],
    [{ ...ok, comuna: 'c'.repeat(61) }],
    [{ ...ok, telefono_contacto: '1'.repeat(21) }], [{ ...ok, telefono_contacto: 'llamar al 123' }], [{ ...ok, telefono_contacto: '+56(9)123' }],
  ];
  for (const [b, codigo] of malos) {
    const r = await reprog(id, b);
    assert.equal(r.status, 400, JSON.stringify(b).slice(0, 80));
    if (codigo) assert.equal(r.body.codigo, codigo);
  }
  assert.equal((await despachos(id)).length, 1);
  assert.equal((await reprog(id, { ...ok, nota: 'n'.repeat(300), direccion_despacho: 'd'.repeat(200), comuna: 'c'.repeat(60), telefono_contacto: '1'.repeat(20) })).status, 200); // los topes exactos pasan
});

test('reprogramar: es atómica; con un chofer inválido nada cambia (ni datos, ni despacho, ni estado, ni auditoría)', async () => {
  const id = await reingresado();
  const bodega = t.idBodega;
  const r = await reprog(id, { id_chofer: bodega, fecha_entrega: await fecha(1), nota: 'x', direccion_despacho: 'Otra 999', comuna: 'Maipú' });
  assert.equal(r.status, 409);
  const p = await pedido(id);
  assert.deepEqual([p.estado_orden, p.direccion_despacho, p.comuna], ['EN_CAMION', 'Providencia 1251', 'Providencia']);
  assert.equal((await despachos(id)).length, 1);
  assert.equal((await bitacora(id)).length, 0);
  // y un chofer inexistente tampoco deja nada
  assert.equal((await reprog(id, { id_chofer: 987654321, fecha_entrega: await fecha(1), direccion_despacho: 'Otra 999' })).status, 409);
  assert.equal((await pedido(id)).direccion_despacho, 'Providencia 1251');
});

test('reprogramar: si falla la auditoría se revierte toda la reprogramación', async () => {
  const id = await reingresado();
  await query(`CREATE OR REPLACE FUNCTION fn_falla_rep() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.accion = 'REPROGRAMACION' THEN RAISE EXCEPTION 'falla simulada'; END IF; RETURN NEW; END $$`);
  await query(`CREATE TRIGGER trg_falla_rep BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fn_falla_rep()`);
  try {
    const r = await reprog(id, { id_chofer: t.idChofer, fecha_entrega: await fecha(1), direccion_despacho: 'Otra 999' });
    assert.equal(r.status, 500);
  } finally {
    await query(`DROP TRIGGER trg_falla_rep ON audit_log`);
    await query(`DROP FUNCTION fn_falla_rep()`);
  }
  const p = await pedido(id);
  assert.deepEqual([p.estado_orden, p.direccion_despacho], ['EN_CAMION', 'Providencia 1251']);
  assert.equal((await despachos(id)).length, 1);
});
