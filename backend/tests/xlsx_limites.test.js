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
  await rechaza(construirXlsx([hojaXml({ filas: 3, dimension: `A1:G${MAX_FILAS + 2}` })]), 400, /filas/);
  await rechaza(construirXlsx([hojaXml({ filas: MAX_FILAS + 1 })]), 400, /filas/); // sin <dimension>: se cuentan las filas del XML
  await rechaza(construirXlsx([hojaXml({ filas: 1, columnas: LIMITES.columnas + 1, dimension: `A1:${'A'.repeat(1)}${'Z'.repeat(1)}1` })]), 400, /columnas/); // AZ = 52
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
