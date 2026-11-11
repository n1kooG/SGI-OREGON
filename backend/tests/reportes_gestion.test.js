// HU10 (T41/T42): exportación del reporte de gestión a Excel y PDF; permisos, períodos, costos y auditoría.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { cerrarCache, redisDel } from '../src/cache.js';
import { pool, query } from '../src/db.js';
import { exportarGestion } from '../src/services/reportes.js';
import { iniciar, crearPedido, limpiar } from './_aux.js';

const MARCA = `rgt${Date.now().toString(36)}`;
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
let ctx;
before(async () => { ctx = await iniciar(); await crearPedido(MARCA, { canal: 'Mayorista', lineas: [['TH-4500', 2]] }); });
after(async () => { await limpiar(MARCA); ctx.server.close(); await cerrarCache(); await pool.end(); });

const exportar = (q, token = ctx.admin) => redisDel('graficos:dashboard', 'graficos:dashboard:semana', 'graficos:dashboard:anio').then(() => ctx.http('GET', `/api/reportes/gestion/exportar${q}`, token));
const filasHoja = (h) => { const a = []; h.eachRow((r) => a.push(r.values.slice(1).map((v) => v?.result ?? v))); return a; };

test('exporta el reporte a xlsx y pdf como descarga, en los tres períodos, y cada exportación queda auditada', async () => {
  const n = async () => (await query(`SELECT count(*)::int n FROM audit_log WHERE accion = 'EXPORTACIÓN' AND valores_nuevos->>'reporte' = 'gestion'`)).rows[0].n;
  const antes = await n();
  for (const periodo of ['semana', 'mes', 'anio']) {
    const x = await exportar(`?formato=xlsx&periodo=${periodo}`);
    assert.equal(x.status, 200);
    assert.equal(x.tipo, XLSX);
    const p = await exportar(`?formato=pdf&periodo=${periodo}`);
    assert.equal(p.status, 200);
    assert.equal(p.tipo, 'application/pdf');
    assert.equal(p.body.subarray(0, 5).toString(), '%PDF-');
  }
  assert.equal(await n(), antes + 6);
  const e = (await query(`SELECT valores_nuevos FROM audit_log WHERE accion = 'EXPORTACIÓN' ORDER BY id_log DESC LIMIT 1`)).rows[0].valores_nuevos;
  assert.deepEqual(e, { reporte: 'gestion', formato: 'pdf', periodo: 'anio' });
});

test('xlsx: hojas Resumen, Ventas por período, Rotación e Inmovilizado, con los datos del período y metadatos de marca', async () => {
  const r = await exportar('?formato=xlsx&periodo=mes');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(r.body);
  assert.deepEqual(wb.worksheets.map((h) => h.name), ['Resumen', 'Ventas por período', 'Rotación', 'Inmovilizado']);
  assert.equal(wb.creator, 'Tienda Oregón');
  const res = filasHoja(wb.getWorksheet('Resumen'));
  assert.deepEqual(res.slice(4).map((f) => f[0]), ['Canal', 'Web', 'Marketplace', 'Mayorista', 'Total']);
  assert.deepEqual(res[4], ['Canal', 'Ventas netas', '% ventas', 'Margen bruto', 'Margen %']);
  const my = res.find((f) => f[0] === 'Mayorista');
  assert.ok(my[1] >= 10000); // 2 × 5.000 del pedido de prueba
  assert.equal(res.at(-1)[1], res.slice(5, 8).reduce((a, f) => a + f[1], 0));
  assert.equal(filasHoja(wb.getWorksheet('Rotación'))[4][0], 'SKU');
});

test('formato o período inválido = 400; Bodega y Chofer = 403', async () => {
  assert.equal((await exportar('?formato=csv')).status, 400);
  assert.equal((await exportar('')).status, 400);
  assert.equal((await exportar('?formato=pdf&periodo=decada')).status, 400);
  for (const t of [ctx.bodega, ctx.chofer]) assert.equal((await exportar('?formato=xlsx', t)).status, 403);
});

test('sin `costos:leer` el reporte no trae márgenes ni valor inmovilizado (xlsx)', async () => {
  const conf = await exportarGestion({ formato: 'xlsx', periodo: 'mes' }, 'Prueba', false);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(conf.buffer);
  const celdas = wb.worksheets.flatMap((h) => filasHoja(h).flat()).map(String).join('|');
  assert.ok(!/Margen|Valor/.test(celdas));
  const pdf = await exportarGestion({ formato: 'pdf', periodo: 'mes' }, 'Prueba', false);
  assert.equal(pdf.buffer.subarray(0, 5).toString(), '%PDF-');
  const con = await exportarGestion({ formato: 'xlsx', periodo: 'mes' }, 'Prueba', true);
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(con.buffer);
  assert.ok(/Margen bruto/.test(wb2.worksheets.flatMap((h) => filasHoja(h).flat()).map(String).join('|')));
});

test('pdf: metadatos Title/Author/Creator/Producer = «Tienda Oregón» y A4', async () => {
  const r = await exportar('?formato=pdf&periodo=mes');
  const u16 = (t) => Buffer.from(`\ufeff${t}`, 'utf16le').swap16(); // pdfkit guarda los textos de /Info en UTF-16BE con BOM
  for (const k of ['Producer', 'Creator', 'Author']) assert.ok(r.body.includes(u16('Tienda Oregón')), k);
  assert.ok(r.body.includes(u16('Reporte de gestión · Mes')));
  const txt = r.body.toString('latin1');
  assert.match(txt, /\/MediaBox \[0 0 595\.28 841\.89\]/);
  assert.ok(!/PDFKit/.test(txt));
});
