// Dashboard HU09/HU10: períodos del gráfico (semana, mes, año), niveles de alerta y costos solo para quien tiene `costos:leer`.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cerrarCache, redisDel } from '../src/cache.js';
import { pool, query } from '../src/db.js';
import { tramos } from '../src/services/dashboard.js';
import { iniciar, crearPedido, limpiar } from './_aux.js';

const MARCA = `dpt${Date.now().toString(36)}`;
let ctx;
before(async () => { ctx = await iniciar(); });
after(async () => { await limpiar(MARCA); ctx.server.close(); await cerrarCache(); await pool.end(); });

const graficos = async (periodo, token = ctx.admin) => {
  await redisDel('graficos:dashboard', 'graficos:dashboard:semana', 'graficos:dashboard:anio');
  return ctx.http('GET', `/api/dashboard/graficos${periodo ? `?periodo=${periodo}` : ''}`, token);
};

test('tramos: semana = 7 días; mes = semanas con la última parcial; año = meses hasta el actual', () => {
  const s = tramos('semana', '2026-11-11');
  assert.equal(s.desde, '2026-11-05');
  assert.deepEqual(s.lista.map((t) => t.etiqueta), ['Jue', 'Vie', 'Sáb', 'Dom', 'Lun', 'Mar', 'Mié']);
  const m = tramos('mes', '2026-10-31'); // mes completo: 5 semanas, la última de 3 días
  assert.deepEqual(m.lista.map((t) => t.etiqueta), ['Sem 1', 'Sem 2', 'Sem 3', 'Sem 4', 'Sem 5*']);
  assert.equal(m.lista[4].detalle, '29–31 oct');
  assert.equal(m.etiqueta, 'Octubre 2026 · consolidado mensual (1–31 oct)');
  const m2 = tramos('mes', '2026-11-11'); // semana 2 sin terminar: parcial
  assert.deepEqual(m2.lista.map((t) => [t.etiqueta, t.parcial]), [['Sem 1', false], ['Sem 2*', true]]);
  const a = tramos('anio', '2026-11-11');
  assert.equal(a.lista.length, 11);
  assert.deepEqual(a.lista.map((t) => t.parcial), [...Array(10).fill(false), true]);
});

test('/graficos: periodo inválido = 400; por defecto es el mes en curso', async () => {
  assert.equal((await graficos('decada')).status, 400);
  const g = await graficos();
  assert.equal(g.body.periodo, 'mes');
  assert.equal(g.body.desde, g.body.hasta.slice(0, 8) + '01');
});

test('/graficos?periodo: la venta de hoy cae en el último tramo de cada período, por canal agrupado y con margen', async () => {
  await crearPedido(MARCA, { canal: `Venta Directa Web`, lineas: [['TH-4500', 2]] }); // 2 × 5.000
  try {
    for (const periodo of ['semana', 'mes', 'anio']) {
      const g = await graficos(periodo);
      assert.equal(g.status, 200, periodo);
      const ult = g.body.serie.at(-1);
      assert.ok(ult.web >= 10000 && ult.total >= ult.web, periodo);
      assert.ok(g.body.totales.ventas >= 10000 && g.body.totales.ordenes >= 1);
      const w = g.body.canales.find((c) => c.canal === 'Web');
      assert.deepEqual(g.body.canales.map((c) => c.canal), ['Web', 'Marketplace', 'Mayorista']);
      assert.ok(w.ventas >= 10000 && typeof w.margen_pct === 'number');
      assert.equal(g.body.serie.reduce((a, s) => a + s.total, 0), g.body.totales.ventas);
    }
    const sem = (await graficos('semana')).body;
    assert.equal(sem.serie.length, 7);
    assert.equal(typeof sem.serie.at(-1).margen_web, 'number'); // margen del día = (venta − costo) / venta
  } finally { await limpiar(MARCA); }
});

test('rotación: umbral 3× y bandera `alta`; inmovilizado con resumen (SKUs, valor y % de la valorización)', async () => {
  await crearPedido(MARCA, { canal: 'Mayorista', lineas: [['TH-4500', 3]] });
  const antes = (await query(`SELECT stock_fisico, stock_reservado FROM inventario WHERE sku = 'TH-4500'`)).rows[0];
  await query(`UPDATE inventario SET stock_fisico = 1, stock_reservado = 0 WHERE sku = 'TH-4500'`); // 3 vendidas / 1 de stock = 3×
  const g = (await graficos('mes')).body;
  await query(`UPDATE inventario SET stock_fisico = $1, stock_reservado = $2 WHERE sku = 'TH-4500'`, [antes.stock_fisico, antes.stock_reservado]);
  const r = g.rotacion.find((x) => x.sku === 'TH-4500');
  assert.equal(g.umbral_rotacion, 3);
  assert.ok(r.rotacion >= 3 && r.alta === true && r.unidades >= 3 && r.stock === 1 && typeof r.producto === 'string');
  assert.equal(g.inmovilizado_resumen.skus, g.inmovilizado.length);
  assert.equal(g.inmovilizado_resumen.valor, g.inmovilizado.reduce((a, x) => a + x.valor, 0));
  assert.ok(g.inmovilizado_resumen.pct_valorizacion >= 0);
});

test('alertas: nivel «Quiebre inminente» si el stock es ≤ la mitad del mínimo; si no, «Bajo mínimo»', async () => {
  await query(`UPDATE inventario SET stock_fisico = 2, stock_reservado = 0 WHERE sku = 'UT-FORNO'`); // mínimo 5
  await redisDel('alertas:dashboard');
  let a = (await ctx.http('GET', '/api/dashboard/alertas', ctx.admin)).body;
  assert.equal(a.items.find((i) => i.sku === 'UT-FORNO').nivel, 'QUIEBRE_INMINENTE');
  await query(`UPDATE inventario SET stock_fisico = 4 WHERE sku = 'UT-FORNO'`);
  await redisDel('alertas:dashboard');
  a = (await ctx.http('GET', '/api/dashboard/alertas', ctx.admin)).body;
  const f = a.items.find((i) => i.sku === 'UT-FORNO');
  assert.deepEqual([f.nivel, f.producto, f.sugerido_reorden], ['BAJO_MINIMO', 'Horno Eléctrico 40L', 6]);
  await query(`UPDATE inventario SET stock_fisico = 3 WHERE sku = 'UT-FORNO'`); // valor de partida de la base de ejemplo
});
