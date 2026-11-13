// Hallazgo 3: un .xlsx pequeño que declara cientos de MB de XML (bomba de descompresión) tumbaba el proceso.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { iniciar } from './_aux.js';
import { construirXlsx, hojaXml } from './_xlsxBomba.js';
import { leerPlanilla, MAX_FILAS, plantilla } from '../src/excel.js';
import { LIMITES } from '../src/xlsxSeguro.js';
import { pool } from '../src/db.js';
import { cerrarCache } from '../src/cache.js';

const dir = mkdtempSync(join(tmpdir(), 'xlsx-'));
// ~105 MB descomprimidos (3.000 filas × 7 celdas de 5 KB) en un archivo de pocos cientos de KB: dentro de las 20.000 filas permitidas y de los 10 MB subidos.
const bomba = construirXlsx([hojaXml({ filas: 3000, largoCelda: 5000 })]);
let t;
before(async () => { t = await iniciar(); });
after(async () => { t.server.close(); await cerrarCache(); await pool.end(); });

const rechaza = (buf, status, texto) => leerPlanilla(buf).then(() => assert.fail('debía rechazarse'), (e) => {
  assert.equal(e.status, status, e.message);
  assert.equal(e.codigo, 'ARCHIVO_INVALIDO');
  if (texto) assert.match(e.message, texto);
});

test('la bomba es pequeña comprimida y enorme descomprimida; sin el tope, ExcelJS agota el heap y el proceso muere (problema original)', () => {
  assert.ok(bomba.length < 2 * 1024 * 1024, `comprimida ${bomba.length}`);
  const ruta = join(dir, 'bomba.xlsx');
  writeFileSync(ruta, bomba);
  const r = spawnSync(process.execPath, ['--max-old-space-size=64', '--input-type=module', '-e',
    `import ExcelJS from 'exceljs'; import { readFileSync } from 'node:fs'; await new ExcelJS.Workbook().xlsx.load(readFileSync(process.argv[1])); console.log('cargado')`, ruta],
  { cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 60_000 });
  assert.notEqual(r.status, 0, 'ExcelJS cargó la bomba sin problema: el escenario ya no reproduce el hallazgo');
  assert.match(r.stderr, /heap|memory/i);
});

test('con el tope, la misma bomba se rechaza (413) al instante, sin descomprimir ni cargar nada', async () => {
  const antes = process.memoryUsage().rss, t0 = Date.now();
  await rechaza(bomba, 413, /descomprimido supera/);
  assert.ok(Date.now() - t0 < 1000);
  assert.ok(process.memoryUsage().rss - antes < 50 * 1024 * 1024);
});

test('por la API: simular responde 413 y el servidor sigue atendiendo', async () => {
  const f = new FormData();
  f.set('canal', 'Mayorista');
  f.set('archivo', new Blob([bomba]), 'ventas.xlsx');
  const r = await t.http('POST', '/api/pedidos/importaciones/simular', t.admin, f);
  assert.equal(r.status, 413);
  assert.equal(r.body.codigo, 'ARCHIVO_INVALIDO');
  assert.equal((await t.http('GET', '/api/auth/me', t.admin)).status, 200);
});

test('una cabecera que miente sobre el tamaño descomprimido no esquiva el tope', async () => {
  const mentira = construirXlsx([hojaXml({ filas: 3000, largoCelda: 5000 })], { mentirTamano: true });
  await rechaza(mentira, 413, /demasiado grande/);
});

test('demasiadas hojas, filas o columnas (por <dimension> o por conteo de filas) se rechazan', async () => {
  await rechaza(construirXlsx(Array.from({ length: LIMITES.hojas + 1 }, () => hojaXml())), 400, /hojas/);
  await rechaza(construirXlsx([hojaXml({ filas: MAX_FILAS + 1 })]), 400, /filas/);
  // <dimension> lo controla el atacante: mentir hacia abajo no sirve, se mide el contenido real
  await rechaza(construirXlsx([hojaXml({ filas: MAX_FILAS + 1, dimension: 'A1:G10' })]), 400, /filas/);
  await rechaza(construirXlsx([hojaXml({ filas: 1, columnas: LIMITES.columnas + 1, dimension: 'A1:G1' })]), 400, /columnas/);
});

test('archivos corruptos o que no son ZIP no rompen: 400', async () => {
  await rechaza(Buffer.from('PK\u0003\u0004 basura sin directorio central'), 400, /no es un .xlsx/);
  await rechaza(Buffer.concat([bomba.subarray(0, 200), Buffer.alloc(100)]), 400);
});

test('las planillas legítimas siguen funcionando: la plantilla y un archivo cercano al máximo de filas', async () => {
  assert.equal((await plantilla()).length > 0, true);
  const filas = await leerPlanilla(construirXlsx([hojaXml({ filas: MAX_FILAS })]));
  assert.equal(filas.length, MAX_FILAS);
  assert.equal(filas[0].sku, 'TH-4500');
  assert.ok(construirXlsx([hojaXml({ filas: MAX_FILAS })]).length < 10 * 1024 * 1024);
});

test('partes con rutas ambiguas (absolutas, con .. o duplicadas) se rechazan; las hojas fuera de xl/worksheets también se miden', async () => {
  const dup = construirXlsx([hojaXml(), hojaXml()], { renombrar: (n) => n.replace('sheet2', 'sheet1') });
  await rechaza(dup, 400, /no es un .xlsx/);
  await rechaza(construirXlsx([hojaXml()], { renombrar: (n) => n.replace('xl/worksheets/', '/xl/worksheets/') }), 400, /no es un .xlsx/);
  const lejos = construirXlsx([hojaXml({ filas: MAX_FILAS + 1 })], { renombrar: (n) => n.replace('xl/worksheets/', 'xl/extra/worksheets/') });
  await rechaza(lejos, 400, /filas/);
});

test('el tope se aplica a lo realmente descomprimido sumando todas las partes, no solo a las hojas', async () => {
  const muchas = construirXlsx([hojaXml({ filas: 1 })], { extra: { 'xl/relleno.bin': 'z'.repeat(LIMITES.descomprimido + 1024) }, mentirTamano: true, mentirTodo: true });
  await rechaza(muchas, 413);
});

test('el recorrido de la hoja es lineal: etiquetas gigantes o sin cerrar se rechazan al instante', async () => {
  const hostil = (x) => construirXlsx([[`<?xml version="1.0"?><worksheet><sheetData>`, x, `</sheetData></worksheet>`]]);
  const t0 = Date.now();
  await rechaza(hostil(`<row ${'a="b" '.repeat(100_000)}>`), 400, /no es un .xlsx/); // etiqueta de cientos de KB
  await rechaza(hostil(`<row r="1"><c ${'r='.repeat(200_000)}`), 400, /no es un .xlsx/); // sin cerrar
  await rechaza(hostil(`<c r="B2" ${' '.repeat(50_000_000)}`), 413); // 50 MB de relleno: lo frena el tope, no el recorrido
  assert.ok(Date.now() - t0 < 3000);
});

test('referencias de fila y columna con comillas simples, espacios o sin r= se miden igual', async () => {
  const hoja = (x) => construirXlsx([[`<worksheet><sheetData>`, x, `</sheetData></worksheet>`]]);
  await rechaza(hoja(`<row  r = '${MAX_FILAS + 5}'><c r='A${MAX_FILAS + 5}'><v>1</v></c></row>`), 400, /filas/);
  await rechaza(hoja(`<row>${'<c><v>1</v></c>'.repeat(LIMITES.columnas + 1)}</row>`), 400, /columnas/); // celdas sin r=: cuenta su posición
  await rechaza(hoja(`<row r="1"><c r='ZZ1'><v>1</v></c></row>`), 400, /columnas/);
});
