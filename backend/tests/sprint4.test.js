// Sprint 4: Observer (T35–T38, T43), dashboard (T39–T41), bitácora y exportación (T42, T51).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { cerrarCache, redisDel } from '../src/cache.js';
import { pool, query, conTransaccion } from '../src/db.js';
import { registrar } from '../src/services/compras.js';
import { importar } from '../src/services/importaciones.js';
import { incrementarFisico } from '../src/repositories/inventario.js';
import { sujetoInventario, alertaStock } from '../src/observers/index.js';
import { InventarioObserver, SujetoInventario } from '../src/observers/inventario.js';
import { iniciar, crearPedido, limpiar } from './_aux.js';

const SUF = Date.now().toString(36);
const MARCA = `s4t${SUF}`;
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
let ctx, stock0, req;

before(async () => {
  ctx = await iniciar();
  req = { ip: '127.0.0.1', usuario: { id_usuario: ctx.idAdmin } };
  stock0 = (await query(`SELECT sku, stock_fisico, stock_reservado FROM inventario`)).rows;
});
after(async () => {
  await limpiar(MARCA);
  await query(`DELETE FROM recepcion_compra WHERE numero_factura LIKE $1`, [`S4T-${SUF}%`]);
  for (const r of stock0) await query(`UPDATE inventario SET stock_fisico = $2, stock_reservado = $3 WHERE sku = $1`, [r.sku, r.stock_fisico, r.stock_reservado]);
  ctx.server.close(); await cerrarCache(); await pool.end();
});

const espiar = () => {
  const eventos = [];
  const o = new (class extends InventarioObserver { async actualizar(e) { eventos.push(e); } })();
  sujetoInventario.suscribir(o);
  return { eventos, fin: () => sujetoInventario.desuscribir(o) };
};
const fijar = (sku, s) => query(`UPDATE inventario SET stock_fisico = $2, stock_reservado = 0 WHERE sku = $1`, [sku, s]);
const alertas = async (sku) => (await query(`SELECT count(*)::int n FROM audit_log WHERE accion = 'ALERTA_STOCK_CRITICO' AND valores_nuevos->>'sku' = $1`, [sku])).rows[0].n;
const factura = (n, sku = 'GM-ELEGANCE', cantidad = 1) => ({
  rut_proveedor: '78.806.090-4', razon_social: 'GAMA CHILE S.A.', numero_factura: `S4T-${SUF}-${n}`, fecha_emision: '2026-09-22', forma_pago: 'Contado',
  items: [{ sku, cantidad, precio_unitario_neto: 1000 }],
});
async function planilla(filas) {
  const wb = new ExcelJS.Workbook();
  const h = wb.addWorksheet('Ventas');
  h.addRow(['RUT CLIENTE', 'NOMBRE CLIENTE', 'SKU', 'NOMBRE PRODUCTO', 'CANTIDAD', 'PRECIO', 'MARCA']);
  filas.forEach((f) => h.addRow(f));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test('T35: el sujeto notifica a todos los observadores y uno que falla no corta a los demás', async () => {
  const s = new SujetoInventario(), vistos = [];
  s.suscribir(new (class extends InventarioObserver { async actualizar() { throw new Error('boom'); } })());
  const b = new (class extends InventarioObserver { async actualizar(e) { vistos.push(e.sku); } })();
  s.suscribir(b);
  await s.notificar({ tipo: 'REBAJA', sku: 'X', cantidad: 1 });
  s.desuscribir(b);
  await s.notificar({ tipo: 'REBAJA', sku: 'Y', cantidad: 1 });
  assert.deepEqual(vistos, ['X']);
});

test('T38: recibir una compra dispara los observers (INGRESO) y no genera alerta', async () => {
  const esp = espiar();
  const antes = await alertas('GM-ELEGANCE');
  await registrar(req, factura(1));
  esp.fin();
  assert.deepEqual(esp.eventos, [{ tipo: 'INGRESO', sku: 'GM-ELEGANCE', cantidad: 1 }]);
  assert.equal(await alertas('GM-ELEGANCE'), antes);
});

test('T38: un ROLLBACK no notifica a nadie (los observers ven solo estado confirmado)', async () => {
  const esp = espiar();
  await assert.rejects(() => conTransaccion(async (c) => { await incrementarFisico('GM-ELEGANCE', 1, c); throw new Error('falla'); }), /falla/);
  esp.fin();
  assert.deepEqual(esp.eventos, []);
});

test('T36/T38 (PI-06): importar pedidos que dejan UT-FORNO bajo el mínimo dispara REBAJA y deja ALERTA_STOCK_CRITICO', async () => {
  await fijar('UT-FORNO', 7); // mínimo 5
  const esp = espiar();
  const antes = await alertas('UT-FORNO');
  const buf = await planilla([['11.111.111-1', 'Cliente S4', 'UT-FORNO', 'Horno', 3, 69990, 'Ursus Trotter']]);
  await importar(req, buf, `${MARCA}_a.xlsx`, 'Mayorista');
  esp.fin();
  assert.deepEqual(esp.eventos, [{ tipo: 'REBAJA', sku: 'UT-FORNO', cantidad: 3 }]);
  assert.equal(await alertas('UT-FORNO'), antes + 1);
  assert.deepEqual((await alertaStock.evaluar('UT-FORNO')).stock_fisico, 4);
});

test('T36: una rebaja que deja el stock sobre el mínimo no genera alerta', async () => {
  await fijar('UT-FORNO', 20);
  const antes = await alertas('UT-FORNO');
  const buf = await planilla([['11.111.111-1', 'Cliente S4', 'UT-FORNO', 'Horno', 1, 69990, 'Ursus Trotter']]);
  await importar(req, buf, `${MARCA}_b.xlsx`, 'Mayorista');
  assert.equal(await alertas('UT-FORNO'), antes);
});

test('T43: un movimiento de stock invalida la caché de KPI (sin esperar los 30 s)', async (t) => {
  const kpis = () => fetch(`http://localhost:${ctx.server.address().port}/api/dashboard/kpis`, { headers: { Authorization: `Bearer ${ctx.admin}` } });
  await kpis();
  const r1 = await kpis();
  if (r1.headers.get('x-cache') === 'OFF') return t.skip('Redis no disponible');
  assert.equal(r1.headers.get('x-cache'), 'HIT');
  await registrar(req, factura(2));
  assert.equal((await kpis()).headers.get('x-cache'), 'MISS');
});

test('HU09: kpis suma `quiebres` y /alertas lista los SKU críticos con reorden sugerido', async () => {
  await fijar('UT-FORNO', 3);
  await redisDel('kpis:dashboard', 'alertas:dashboard');
  const k = await ctx.http('GET', '/api/dashboard/kpis', ctx.admin);
  const a = await ctx.http('GET', '/api/dashboard/alertas', ctx.admin);
  assert.equal(a.status, 200);
  assert.equal(k.body.quiebres, a.body.quiebres);
  assert.equal(a.body.quiebres, a.body.items.length);
  const horno = a.body.items.find((i) => i.sku === 'UT-FORNO');
  assert.deepEqual(Object.keys(horno).sort(), ['modelo', 'nivel', 'producto', 'sku', 'stock_fisico', 'stock_minimo', 'sugerido_reorden']);
  assert.equal(horno.sugerido_reorden, 7); // 2 × 5 − 3
});

test('HU09/HU10: Bodega y Chofer reciben 403 (+ ACCESO_DENEGADO) en alertas, gráficos y exportación', async () => {
  const n = async () => (await query(`SELECT count(*)::int n FROM audit_log WHERE accion = 'ACCESO_DENEGADO'`)).rows[0].n;
  const antes = await n();
  for (const token of [ctx.bodega, ctx.chofer]) {
    for (const ruta of ['/api/dashboard/alertas', '/api/dashboard/graficos', '/api/auditoria/exportar?formato=xlsx']) {
      assert.equal((await ctx.http('GET', ruta, token)).status, 403, ruta);
    }
  }
  assert.equal(await n(), antes + 6);
});

test('T39–T41: /graficos entrega ventas, márgenes, rotación e inmovilizado con los datos reales', async () => {
  const id = await crearPedido(MARCA, { canal: `Canal ${MARCA}`, lineas: [['TH-4500', 2]] }); // 2 × 5.000 neto
  await query(`UPDATE detalle_venta SET precio_unitario = 5000 WHERE id_orden = $1`, [id]);
  await redisDel('graficos:dashboard');
  const g = await ctx.http('GET', '/api/dashboard/graficos', ctx.admin);
  assert.equal(g.status, 200);
  assert.deepEqual(Object.keys(g.body).sort(), ['canales', 'desde', 'etiqueta', 'hasta', 'inmovilizado', 'inmovilizado_resumen', 'margenes', 'periodo', 'rotacion', 'serie', 'totales', 'umbral_rotacion', 'ventas_por_canal']);
  const v = g.body.ventas_por_canal.find((x) => x.canal === `Canal ${MARCA}`);
  assert.equal(v.total, 10000);
  const costo = Number((await query(`SELECT costo_adquisicion_neto c FROM producto WHERE sku = 'TH-4500'`)).rows[0].c);
  const m = g.body.margenes.find((x) => x.canal === `Canal ${MARCA}`);
  assert.equal(m.margen_promedio, Math.round(1000 * (10000 - 2 * costo) / 10000) / 10);
  assert.ok(g.body.rotacion.some((x) => x.sku === 'TH-4500' && x.rotacion > 0));
  for (const i of g.body.inmovilizado) assert.deepEqual(Object.keys(i).sort(), ['dias_sin_movimiento', 'modelo', 'producto', 'sku', 'stock_fisico', 'valor']);
});

test('T39/T40: stock sin ventas ni ingresos en 60 días aparece como inmovilizado (con días y valor); lo que rota no', async () => {
  const [viejo, nuevo] = [`S4V-${SUF}`.toUpperCase(), `S4N-${SUF}`.toUpperCase()];
  for (const sku of [viejo, nuevo]) {
    await query(`INSERT INTO producto (sku, modelo, nombre, marca, costo_adquisicion_neto) VALUES ($1, 'M', 'Prueba S4', 'S4', 1000)`, [sku]);
    await query(`INSERT INTO inventario (sku, stock_fisico) VALUES ($1, 5)`, [sku]);
  }
  try {
    const id = await crearPedido(MARCA, { canal: `Viejo ${MARCA}`, lineas: [[viejo, 1]] });
    await query(`UPDATE orden_venta SET fecha_orden = now() - interval '90 days' WHERE id_orden = $1`, [id]);
    await redisDel('graficos:dashboard');
    const g = await ctx.http('GET', '/api/dashboard/graficos', ctx.admin);
    const v = g.body.inmovilizado.find((i) => i.sku === viejo);
    assert.ok(v.dias_sin_movimiento >= 90 && v.valor === 5000 && v.stock_fisico === 5);
    assert.equal(g.body.inmovilizado.find((i) => i.sku === nuevo).dias_sin_movimiento, null); // sin movimientos registrados
    assert.ok(g.body.inmovilizado.every((i) => i.sku !== 'TH-4500')); // TH-4500 vendió hoy: rota
  } finally {
    await limpiar(MARCA);
    for (const sku of [viejo, nuevo]) { await query(`DELETE FROM inventario WHERE sku = $1`, [sku]); await query(`DELETE FROM producto WHERE sku = $1`, [sku]); }
  }
});

test('T51: filtros de bitácora por usuario, acción, fecha y paginación; fecha inválida = 400', async () => {
  await ctx.http('GET', '/api/auditoria', ctx.chofer); // genera un ACCESO_DENEGADO del chofer
  const hoy = new Date().toLocaleDateString('en-CA'); // fecha local, igual que la base
  const porAccion = await ctx.http('GET', '/api/auditoria?accion=acceso_denegado&usuario=chofer&desde=' + hoy + '&hasta=' + hoy, ctx.admin);
  assert.equal(porAccion.status, 200);
  assert.ok(Array.isArray(porAccion.body) && porAccion.body.length > 0);
  assert.ok(porAccion.body.every((l) => l.accion === 'ACCESO_DENEGADO' && l.rol === 'CHOFER'));
  const pag = await fetch(`http://localhost:${ctx.server.address().port}/api/auditoria?limite=1&pagina=2`, { headers: { Authorization: `Bearer ${ctx.admin}` } });
  assert.equal((await pag.json()).length, 1);
  assert.ok(Number(pag.headers.get('x-total-count')) > 1);
  const vacio = await ctx.http('GET', '/api/auditoria?desde=2000-01-01&hasta=2000-01-02', ctx.admin);
  assert.deepEqual(vacio.body, []);
  assert.equal((await ctx.http('GET', '/api/auditoria?desde=ayer', ctx.admin)).status, 400);
  assert.equal((await ctx.http('GET', '/api/auditoria?desde=2026-02-01&hasta=2026-01-01', ctx.admin)).status, 400);
});

test('Figma: kpis con skus_activos y ventas_dia, /top-productos y /auditoria/filtros', async () => {
  await redisDel('kpis:dashboard', 'top:dashboard');
  const k = await ctx.http('GET', '/api/dashboard/kpis', ctx.admin);
  const activos = (await query(`SELECT count(*)::int n FROM producto WHERE estado = 'ACTIVO'`)).rows[0].n;
  assert.equal(k.body.skus_activos, activos);
  assert.equal(typeof k.body.ventas_dia, 'number');
  assert.equal(k.body.quiebres, k.body.stock_critico);
  await crearPedido(MARCA, { canal: `Top ${MARCA}`, lineas: [['UT-FORNO', 2]] });
  await fijar('UT-FORNO', 2); // 2 ≤ la mitad del mínimo (5): quiebre inminente
  await redisDel('top:dashboard');
  const t = await ctx.http('GET', '/api/dashboard/top-productos', ctx.admin);
  assert.ok(t.body.length <= 10);
  assert.deepEqual(Object.keys(t.body[0]).sort(), ['estado', 'marca', 'producto', 'sku', 'stock_actual', 'stock_minimo', 'ventas_mes']);
  assert.equal(t.body.find((x) => x.sku === 'UT-FORNO').estado, 'QUIEBRE_INMINENTE');
  assert.ok(t.body.every((x, i) => i === 0 || t.body[i - 1].ventas_mes >= x.ventas_mes));
  const f = await ctx.http('GET', '/api/auditoria/filtros', ctx.admin);
  assert.ok(f.body.usuarios.some((u) => u.id_usuario === ctx.idAdmin && u.nombre) && f.body.acciones.includes('ACCESO_DENEGADO'));
  const porId = await ctx.http('GET', `/api/auditoria?usuario=${ctx.idChofer}&accion=ACCESO_DENEGADO`, ctx.admin);
  assert.ok(porId.body.length > 0 && porId.body.every((l) => l.rol === 'CHOFER'));
  for (const ruta of ['/api/dashboard/top-productos', '/api/auditoria/filtros']) assert.equal((await ctx.http('GET', ruta, ctx.bodega)).status, 403);
});

test('T42: exporta la bitácora a xlsx y pdf como descarga, con filtros, solo Administrador, y queda auditado', async () => {
  const antes = async () => (await query(`SELECT count(*)::int n FROM audit_log WHERE accion = 'EXPORTACIÓN'`)).rows[0].n;
  const n0 = await antes();
  const base = `http://localhost:${ctx.server.address().port}/api/auditoria/exportar`;
  const h = { Authorization: `Bearer ${ctx.admin}` };

  const x = await fetch(`${base}?formato=xlsx&accion=ACCESO_DENEGADO`, { headers: h });
  assert.equal(x.status, 200);
  assert.match(x.headers.get('content-disposition'), /attachment; filename="bitacora_\d{4}-\d{2}-\d{2}\.xlsx"/);
  assert.equal(x.headers.get('content-type'), XLSX);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await x.arrayBuffer()));
  const hoja = wb.worksheets[0];
  // Filas 1–4: marca, título, filtros y generación; la tabla parte en la 5 con panel fijo, autofiltro y fechas reales.
  assert.deepEqual(hoja.getRow(5).values.slice(1), ['Fecha y hora', 'Usuario', 'Rol', 'Acción', 'Módulo', 'IP de origen']);
  assert.match(hoja.getCell('A3').value, /Acción: ACCESO_DENEGADO/);
  assert.equal(hoja.views[0].ySplit, 5);
  assert.equal(hoja.autoFilter, 'A5:F5');
  assert.ok(hoja.rowCount > 5);
  assert.ok(hoja.getCell('A6').value instanceof Date);
  hoja.eachRow((r, i) => { if (i > 5) assert.equal(r.getCell(4).value, 'ACCESO_DENEGADO'); });

  const p = await fetch(`${base}?formato=pdf`, { headers: h });
  assert.equal(p.status, 200);
  assert.match(p.headers.get('content-disposition'), /\.pdf"/);
  assert.equal(Buffer.from(await p.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');

  assert.equal((await ctx.http('GET', '/api/auditoria/exportar?formato=csv', ctx.admin)).status, 400);
  assert.equal(await antes(), n0 + 2);
});
