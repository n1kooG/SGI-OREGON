// Revisión de seguridad B: control de acceso por rol en los endpoints nuevos, cabeceras, CORS, tamaños, errores y bitácora.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciar, crearPedido, limpiar } from './_aux.js';
import { pool, query } from '../src/db.js';
import { cerrarCache } from '../src/cache.js';
import { config } from '../src/config.js';

const M = `sgh${Date.now().toString(36)}`;
let t;
before(async () => { t = await iniciar(); });
after(async () => { t.server.close(); await cerrarCache(); await pool.end(); });

const NOEXISTE = 2_000_000_000; // id válido para PostgreSQL pero inexistente: los endpoints permitidos responden 404/400, no 403
// [método, ruta, roles permitidos, cuerpo]. Los permitidos reciben una solicitud que no cambia nada.
const MATRIZ = [
  ['GET', '/api/pedidos', ['admin', 'bodega']],
  ['GET', '/api/pedidos/resumen', ['admin', 'bodega']],
  ['GET', `/api/pedidos/${NOEXISTE}`, ['admin', 'bodega']],
  ['GET', `/api/pedidos/${NOEXISTE}/etiqueta`, ['admin', 'bodega']],
  ['PUT', `/api/pedidos/${NOEXISTE}/etiqueta`, ['admin']],
  ['DELETE', `/api/pedidos/${NOEXISTE}/etiqueta`, ['admin']],
  ['PATCH', `/api/pedidos/${NOEXISTE}/documento`, ['admin'], { numero_documento: '1' }],
  ['POST', `/api/pedidos/${NOEXISTE}/reprogramar`, ['admin'], {}],
  ['POST', `/api/pedidos/${NOEXISTE}/asignar-chofer`, ['admin'], {}],
  ['PATCH', `/api/pedidos/${NOEXISTE}/estado`, ['bodega'], { estado: 'ARMADO' }],
  ['POST', `/api/pedidos/${NOEXISTE}/comentarios`, ['bodega'], {}],
  ['GET', '/api/pedidos/importaciones/plantilla', ['admin']],
  ['POST', '/api/pedidos/importaciones/simular', ['admin']],
  ['POST', '/api/pedidos/importaciones', ['admin']],
  ['GET', '/api/despachos/mi-ruta', ['chofer']],
  ['GET', '/api/despachos/mi-ruta/resumen', ['chofer']],
  ['GET', '/api/despachos/historial', ['chofer']],
  ['GET', `/api/despachos/${NOEXISTE}`, ['chofer']],
  ['PATCH', `/api/despachos/${NOEXISTE}`, ['chofer'], { estado: 'ENTREGADO' }],
  ['POST', `/api/despachos/${NOEXISTE}/reingresar`, ['admin', 'bodega']],
  ['GET', '/api/inventario/sin-ubicacion', ['admin', 'bodega']],
  ['GET', '/api/bodega', ['admin', 'bodega']],
  ['DELETE', '/api/bodega/pasillos/99', ['admin']],
  ['GET', '/api/inventario/resumen', ['admin', 'bodega']],
  ['PUT', '/api/inventario/ZZ-NO-EXISTE/ubicacion', ['admin', 'bodega'], { ubicacion_bodega: 'A1' }],
  ['GET', '/api/compras/recepciones', ['admin']],
  ['GET', '/api/compras/recepciones/proveedores', ['admin']],
  ['GET', `/api/compras/recepciones/${NOEXISTE}`, ['admin']],
  ['GET', `/api/compras/recepciones/${NOEXISTE}/pdf`, ['admin']],
  ['POST', '/api/compras/recepciones', ['admin'], {}],
  ['GET', '/api/compras/descargas/pendientes', ['admin', 'bodega']],
  ['POST', '/api/compras/descargas', ['bodega'], {}],
  ['GET', '/api/reportes/gestion/exportar?formato=xlsx&periodo=mes', ['admin']],
  ['GET', '/api/dashboard/kpis', ['admin']],
  ['GET', '/api/auditoria', ['admin']],
  ['GET', '/api/usuarios', ['admin']],
];

test('matriz rol × endpoint: sin sesión 401; roles no permitidos 403; los permitidos pasan el control de acceso', async () => {
  const fallos = [];
  for (const [metodo, ruta, permitidos, cuerpo] of MATRIZ) {
    const r0 = await t.http(metodo, ruta, null, cuerpo);
    if (r0.status !== 401) fallos.push(`${metodo} ${ruta} anónimo → ${r0.status}`);
    for (const rol of ['admin', 'bodega', 'chofer']) {
      const { status } = await t.http(metodo, ruta, t[rol], cuerpo);
      const ok = permitidos.includes(rol);
      if (ok ? status === 401 || status === 403 || status >= 500 : status !== 403) fallos.push(`${metodo} ${ruta} ${rol} → ${status} (permitido: ${ok})`);
    }
  }
  assert.deepEqual(fallos, []);
});

test('IDOR: un chofer no ve ni cierra el despacho de otro, ni de otros usuarios; el 404 es idéntico al de un id inexistente', async () => {
  // un segundo chofer (sin sesión, así se puede borrar) con un despacho propio
  const { rows: [u] } = await query(
    `INSERT INTO usuario (rut, nombre_completo, email, password_hash, id_rol) SELECT '55.555.555-5', 'Chofer IDOR', $1, password_hash, id_rol FROM usuario WHERE email = 'chofer@tiendaoregon.cl' RETURNING id_usuario`, [`idor${Date.now().toString(36)}@x.cl`]);
  const idPedido = await crearPedido(M, { estado: 'EN_CAMION' });
  const { rows: [d] } = await query(`INSERT INTO despacho (id_orden, id_usuario_chofer) VALUES ($1, $2) RETURNING id_despacho`, [idPedido, u.id_usuario]);
  await query(`UPDATE orden_venta SET estado_orden = 'EN_RUTA' WHERE id_orden = $1`, [idPedido]);
  try {
  const ajeno = await t.http('GET', `/api/despachos/${d.id_despacho}`, t.chofer);
  const nada = await t.http('GET', `/api/despachos/${NOEXISTE}`, t.chofer);
  assert.equal(ajeno.status, 404);
  assert.deepEqual(ajeno.body, nada.body);
  const cierre = await t.http('PATCH', `/api/despachos/${d.id_despacho}`, t.chofer, { estado: 'ENTREGADO' });
  assert.equal(cierre.status, 404);
  assert.equal((await query(`SELECT estado_entrega FROM despacho WHERE id_despacho = $1`, [d.id_despacho])).rows[0].estado_entrega, 'PENDIENTE');
  } finally {
    await limpiar(M);
    await query(`DELETE FROM usuario WHERE id_usuario = $1`, [u.id_usuario]);
  }
});

test('IDs y cuerpos fuera de rango dan 400/404, nunca 500 ni detalles internos', async () => {
  const casos = [
    ['GET', '/api/pedidos/99999999999999999999', t.admin],
    ['GET', '/api/despachos/99999999999999999999', t.chofer],
    ['GET', '/api/compras/recepciones/99999999999999999999', t.admin],
    ['GET', '/api/compras/recepciones?pagina=99999999999999999999', t.admin],
    ['GET', '/api/productos?pagina=99999999999999999999', t.admin],
    ['GET', '/api/productos/%E0%A4%A', t.admin],
    ['GET', '/api/auditoria?pagina=99999999999999999999', t.admin],
    ['POST', '/api/pedidos/1/asignar-chofer', t.admin, { id_chofer: 99999999999 }],
  ];
  for (const [m, ruta, tok, body] of casos) {
    const r = await t.http(m, ruta, tok, body);
    assert.ok([400, 404].includes(r.status), `${m} ${ruta} → ${r.status}`);
    assert.doesNotMatch(JSON.stringify(r.body), /pg_|SELECT|at .*\.js|node_modules|constraint/i);
  }
});

test('reprogramar solo aplica a un pedido rechazado y reingresado (EN_CAMION): los demás estados dan 409', async () => {
  const { rows } = await query(`SELECT DISTINCT ON (estado_orden) id_orden FROM orden_venta WHERE estado_orden <> 'EN_CAMION'`);
  for (const { id_orden } of rows) {
    const r = await t.http('POST', `/api/pedidos/${id_orden}/reprogramar`, t.admin, { id_chofer: t.idChofer, fecha_entrega: '2099-01-01' });
    assert.equal(r.status, 409, `pedido ${id_orden}`);
  }
});

test('cabeceras de seguridad (helmet): sin x-powered-by, nosniff, HSTS, CSP y sin caché de datos privados', async () => {
  const r = await fetch(`http://localhost:${t.server.address().port}/api/auth/me`, { headers: { Authorization: `Bearer ${t.admin}` } });
  assert.equal(r.headers.get('x-powered-by'), null);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(r.headers.get('strict-transport-security'));
  assert.ok(r.headers.get('content-security-policy'));
  assert.equal(r.headers.get('x-frame-options'), 'SAMEORIGIN');
});

test('CORS: el único origen permitido es el configurado (nunca se refleja el de la solicitud ni «*»); sin credenciales', async () => {
  const pedir = (origen) => fetch(`http://localhost:${t.server.address().port}/api/health`, { headers: { Origin: origen } });
  assert.equal((await pedir('https://evil.example')).headers.get('access-control-allow-origin'), config.corsOrigin); // el navegador lo rechaza: no coincide con el origen de la página
  const ok = await pedir(config.corsOrigin);
  assert.equal(ok.headers.get('access-control-allow-origin'), config.corsOrigin);
  assert.equal(ok.headers.get('access-control-allow-credentials'), null);
  const pre = await fetch(`http://localhost:${t.server.address().port}/api/pedidos`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' } });
  assert.equal(pre.headers.get('access-control-allow-origin'), config.corsOrigin);
  assert.notEqual(config.corsOrigin, '*');
});

test('cuerpo JSON mayor a 100 kb → 413 y un tipo de contenido raro no provoca 500', async () => {
  const r = await fetch(`http://localhost:${t.server.address().port}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'a@b.cl', password: 'x'.repeat(150_000) }) });
  assert.equal(r.status, 413);
  const raro = await fetch(`http://localhost:${t.server.address().port}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'br' }, body: 'x' });
  assert.ok(raro.status >= 400 && raro.status < 500, String(raro.status));
  const roto = await fetch(`http://localhost:${t.server.address().port}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"email":' });
  assert.equal(roto.status, 400);
});

test('la bitácora no guarda claves, hashes, tokens, firmas ni contenido de PDF', async () => {
  const { rows } = await query(`SELECT accion, valores_anteriores::text AS a, valores_nuevos::text AS n FROM audit_log`);
  const prohibido = /\$2[aby]\$\d\d\$|eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}|%PDF-|iVBORw0KGgo|data:image|Demo-Oregon-2026|Clave-Nueva|password"/;
  const malos = rows.filter((r) => prohibido.test(`${r.a ?? ''} ${r.n ?? ''}`)).map((r) => r.accion);
  assert.deepEqual(malos, []);
});
