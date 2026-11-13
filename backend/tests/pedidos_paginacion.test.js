// Hallazgo 5/10: GET /api/pedidos paginado (X-Total-Count, orden estable), Bodega sin estados ajenos ni datos de choferes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciar, crearPedido, limpiar } from './_aux.js';
import { pool, query } from '../src/db.js';
import { cerrarCache } from '../src/cache.js';

const M = `pag${Date.now().toString(36)}`;
let t, ids = [], raw;
const lista = async (qs, token = t.admin) => {
  const r = await fetch(`http://localhost:${t.server.address().port}/api/pedidos${qs}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: r.status, total: r.headers.get('x-total-count'), body: await r.json() };
};

before(async () => {
  t = await iniciar();
  for (let i = 0; i < 7; i++) ids.push(await crearPedido(`${M}${i}`, { estado: i % 2 ? 'ARMADO' : 'PENDIENTE_PREPARACION' }));
  ids.push(await crearPedido(`${M}7`, { estado: 'EN_CAMION' }));
  await t.http('POST', `/api/pedidos/${ids[7]}/asignar-chofer`, t.admin, { id_chofer: t.idChofer }); // → EN_RUTA, con chofer
  // misma fecha_orden para todos: el desempate por id_orden debe dar páginas sin repetidos ni saltos
  await query(`UPDATE orden_venta SET fecha_orden = '2026-01-01 10:00:00+00' WHERE id_orden = ANY($1)`, [ids]);
  raw = (await query(`SELECT count(*)::int AS n FROM orden_venta`)).rows[0].n;
});
after(async () => { await limpiar(M); t.server.close(); await cerrarCache(); await pool.end(); });

test('administrador: páginas consecutivas cubren todo sin repetir ni saltar, con X-Total-Count y orden estable', async () => {
  const vistos = [];
  for (let pagina = 1; pagina <= Math.ceil(raw / 3); pagina++) {
    const r = await lista(`?limite=3&pagina=${pagina}`);
    assert.equal(r.status, 200);
    assert.equal(Number(r.total), raw);
    assert.ok(r.body.length <= 3);
    vistos.push(...r.body.map((x) => x.id_orden));
  }
  assert.equal(new Set(vistos).size, vistos.length);
  assert.equal(vistos.length, raw);
  const todos = (await lista(`?limite=500`)).body.map((x) => x.id_orden);
  assert.deepEqual(vistos, todos); // el mismo orden recorrido por páginas y de una vez
  assert.equal((await lista('?limite=3&pagina=9999')).body.length, 0);
  assert.equal(Number((await lista('?limite=3&pagina=9999')).total), raw); // el total no depende de la página
});

test('sin parámetros: límite por defecto 100 con total real; con 120 pedidos el total sigue siendo el real', async () => {
  const antes = Number((await lista('')).total);
  await query(`INSERT INTO lote_importacion (id_usuario, nombre_archivo, url_archivo_s3, total_ordenes, total_lineas) VALUES ($1, $2, 'x', 120, 0)`, [t.idAdmin, `${M}-masivo.xlsx`]);
  await query(`INSERT INTO orden_venta (id_lote, codigo_externo, canal_origen, nombre_cliente)
               SELECT (SELECT id_lote FROM lote_importacion WHERE nombre_archivo = $1), $2 || g, 'Mayorista', 'Cliente masivo' FROM generate_series(1, 120) g`, [`${M}-masivo.xlsx`, `${M}-m`]);
  const r = await lista('');
  assert.equal(r.body.length, 100);
  assert.equal(Number(r.total), antes + 120);
  assert.equal((await lista('?limite=500')).body.length, Math.min(500, antes + 120));
});

test('Bodega: más antiguos primero (FIFO), sin id ni nombre del chofer y sin estados ajenos', async () => {
  const r = await lista('?limite=500', t.bodega);
  assert.equal(r.status, 200);
  const propios = r.body.filter((x) => ids.includes(x.id_orden));
  assert.deepEqual(propios.map((x) => x.id_orden), ids.slice(0, 7)); // los 7 de bodega, por id ascendente (misma fecha); el EN_RUTA no aparece
  assert.ok(r.body.every((x) => ['PENDIENTE_PREPARACION', 'ARMADO', 'ETIQUETADO', 'EN_CAMION'].includes(x.estado_orden)));
  assert.ok(r.body.every((x) => !('nombre_chofer' in x) && !('id_usuario_chofer' in x) && typeof x.chofer_asignado === 'boolean'));
  assert.doesNotMatch(JSON.stringify(r.body), /rut_cliente|costo|margen/i);
  const admin = (await lista('?estado=EN_RUTA&limite=500')).body.find((x) => x.id_orden === ids[7]);
  assert.ok(admin.nombre_chofer && admin.id_usuario_chofer);
});

test('Bodega no puede listar pedidos en ruta, entregados ni rechazados vía ?estado=; sí los suyos y los rechazos por reingresar', async () => {
  for (const e of ['EN_RUTA', 'ENTREGADO', 'RECHAZADO']) assert.equal((await lista(`?estado=${e}`, t.bodega)).status, 403, e);
  assert.equal((await lista('?estado=ARMADO', t.bodega)).status, 200);
  assert.equal((await lista('?por_reingresar=1', t.bodega)).status, 200);
  assert.equal((await t.http('GET', `/api/pedidos/${ids[7]}`, t.bodega)).status, 404); // en ruta: ni siquiera el detalle
  assert.equal((await t.http('GET', `/api/pedidos/${ids[0]}`, t.bodega)).status, 200);
  assert.equal((await t.http('GET', `/api/pedidos/${ids[7]}`, t.admin)).status, 200);
  // rechazado: Bodega sí ve el detalle (para reingresar), pero sin quién lo asignó ni el chofer
  const { id_despacho } = (await query(`SELECT id_despacho FROM despacho WHERE id_orden = $1`, [ids[7]])).rows[0];
  assert.equal((await t.http('PATCH', `/api/despachos/${id_despacho}`, t.chofer, { estado: 'RECHAZADO', motivo: 'cliente ausente' })).status, 200);
  const det = await t.http('GET', `/api/pedidos/${ids[7]}`, t.bodega);
  assert.equal(det.status, 200);
  assert.ok(det.body.intentos.length === 1 && det.body.intentos.every((i) => !('chofer' in i) && !('asignado_por' in i)));
  assert.ok(!('nombre_chofer' in det.body) && !('rut_cliente' in det.body));
});

test('pagina y limite se validan con 400 (sin 500)', async () => {
  for (const qs of ['?limite=0', '?limite=501', '?limite=abc', '?limite=1.5', '?pagina=0', '?pagina=-1', '?pagina=99999999999999999999', '?pagina=x']) {
    const r = await lista(qs);
    assert.equal(r.status, 400, qs);
  }
  assert.equal((await lista('?limite=500&pagina=1')).status, 200);
});
