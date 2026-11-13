// Revisión de seguridad de la importación de etiquetas: PDF hostiles o enormes no agotan CPU/memoria ni bloquean el servidor,
// y la descarga no puede ejecutar nada en el navegador.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import PDFDocument from 'pdfkit';

const dir = await mkdtemp(join(tmpdir(), 'etq-seg-'));
process.env.ETIQUETAS_DIR = dir;
process.env.STORAGE_ENABLED = 'false';
const { iniciar, crearPedido, limpiar } = await import('./_aux.js');
const { pool, query } = await import('../src/db.js');
const { cerrarCache } = await import('../src/cache.js');
const { ejecutarAislado } = await import('../src/pdf/sandbox.js');
const { leerNumeroOrden, extraerNumeroOrden } = await import('../src/pdf/leerOrden.js');
const { sanearNombre } = await import('../src/services/etiquetas.js');

const M = `eqs${Date.now().toString(36)}`;
const BASE = Number(String(Date.now()).slice(-8)) * 100 + 77;
const tmp = mkdtempSync(join(tmpdir(), 'etq-w-'));
const worker = (nombre, codigo) => { const r = join(tmp, nombre); writeFileSync(r, codigo); return pathToFileURL(r); };
let t, cont = 0;

const pdf = (paginas) => new Promise((ok) => {
  const d = new PDFDocument({ size: [283, 425] }), partes = [];
  d.on('data', (p) => partes.push(p)).on('end', () => ok(Buffer.concat(partes)));
  paginas.forEach((txt, i) => { if (i) d.addPage(); d.fontSize(10).text(txt); });
  d.end();
});
const form = (archivos) => {
  const f = new FormData();
  for (const [n, b] of archivos) f.append('archivos', new Blob([b], { type: 'application/pdf' }), n);
  return f;
};
// Mide cuánto se atrasa el bucle de eventos del servidor mientras corre `fn` (si algo lo bloquea, el atraso es del orden del bloqueo).
async function atrasoMax(fn) {
  let max = 0, previo = Date.now();
  const iv = setInterval(() => { const ahora = Date.now(); max = Math.max(max, ahora - previo - 20); previo = ahora; }, 20);
  try { await fn(); } finally { clearInterval(iv); }
  return max;
}

before(async () => { t = await iniciar(); });
after(async () => { await limpiar(M); await rm(dir, { recursive: true, force: true }); await rm(tmp, { recursive: true, force: true }); t.server.close(); await cerrarCache(); await pool.end(); });

test('un lector que cicla para siempre se corta por tiempo y el bucle de eventos no se bloquea', async () => {
  const w = worker('ciclo.mjs', 'while (true) {}');
  let error;
  const atraso = await atrasoMax(async () => { error = await ejecutarAislado(w, {}, { tiempoMs: 400 }).catch((e) => e); });
  assert.equal(error.code, 'TIEMPO_AGOTADO');
  assert.ok(atraso < 200, `el hilo principal se atrasó ${atraso} ms`);
});

test('un lector que consume memoria sin límite muere en su worker y el proceso sigue vivo', async () => {
  const w = worker('memoria.mjs', 'const a = []; while (true) a.push(Buffer.alloc(1024 * 1024, 1).toString("latin1") + Math.random());');
  const e = await ejecutarAislado(w, {}, { tiempoMs: 20_000, memoriaMb: 48 }).catch((x) => x);
  assert.ok(['MEMORIA', 'FALLO'].includes(e.code), e.code);
  assert.equal((await t.http('GET', '/api/auth/me', t.admin)).status, 200);
});

test('la concurrencia de lectores está acotada (3): 9 tareas de 250 ms tardan al menos 3 tandas', async () => {
  const w = worker('dormir.mjs', `import { parentPort } from 'node:worker_threads'; setTimeout(() => parentPort.postMessage({ numero: 'x' }), 250);`);
  const t0 = Date.now();
  const rs = await Promise.all(Array.from({ length: 9 }, () => ejecutarAislado(w, {})));
  assert.equal(rs.length, 9);
  assert.ok(Date.now() - t0 >= 700, `tardó ${Date.now() - t0} ms: se ejecutaron más de 3 a la vez`);
});

test('PDF corrupto, truncado o con basura: «No se pudo leer» sin romper el lote', async () => {
  const buenoSin = await pdf(['Sin numero de orden']);
  const r = await t.http('POST', '/api/pedidos/etiquetas', t.admin, form([
    ['corrupto.pdf', Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 99 0 R >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF')],
    ['truncado.pdf', buenoSin.subarray(0, 120)],
    ['basura.pdf', Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(5000, 0xff)])],
    ['ok.pdf', buenoSin],
  ]));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.resultados.map((x) => x.estado), ['INVALIDO', 'INVALIDO', 'INVALIDO', 'NO_RECONOCIDA']);
});

test('solo se leen las primeras 5 páginas: un N° de orden en la página 7 no se reconoce', async () => {
  const cod = String(BASE + ++cont);
  const id = await crearPedido(`${M}${cont}`);
  await query(`UPDATE orden_venta SET codigo_externo = $2 WHERE id_orden = $1`, [id, cod]);
  const largo = await pdf([...Array(6).fill('relleno'), `Nº de orden: ${cod}`]);
  const r = await t.http('POST', '/api/pedidos/etiquetas', t.admin, form([['paginas.pdf', largo]]));
  assert.equal(r.body.resultados[0].estado, 'NO_RECONOCIDA');
  assert.equal(await leerNumeroOrden(await pdf([`Nº de orden: ${cod}`])), cod);
});

test('lote de 100 archivos: termina y el servidor sigue respondiendo mientras tanto', async () => {
  const uno = await pdf(['Etiqueta sin numero']);
  const archivos = Array.from({ length: 100 }, (_, i) => [`e${i}.pdf`, uno]);
  let r;
  const atraso = await atrasoMax(async () => { r = await t.http('POST', '/api/pedidos/etiquetas', t.admin, form(archivos)); });
  assert.equal(r.status, 200);
  assert.equal(r.body.total, 100);
  assert.ok(r.body.resultados.every((x) => x.estado === 'NO_RECONOCIDA'));
  assert.ok(atraso < 300, `el servidor se bloqueó ${atraso} ms durante el lote`);
});

test('las expresiones del N° de orden no tienen retroceso cuadrático sobre espacios y símbolos repetidos', () => {
  for (const hostil of ['N' + ' '.repeat(200_000) + 'x', 'N' + 'º. '.repeat(100_000), 'orden' + ' '.repeat(200_000), 'pedido' + ' '.repeat(200_000) + ':']) {
    const t0 = Date.now();
    extraerNumeroOrden(hostil);
    assert.ok(Date.now() - t0 < 200, `tardó ${Date.now() - t0} ms`);
  }
});

test('nombres de archivo: sin ruta, sin control ni marcas bidireccionales, a lo más 200 caracteres', () => {
  assert.equal(sanearNombre('../../etc/passwd'), 'passwd');
  assert.equal(sanearNombre('C:\\x\\y\\z.pdf'), 'z.pdf');
  assert.equal(sanearNombre('a\u202egnp.pdf'), 'agnp.pdf');
  assert.equal(sanearNombre('a\r\nb\u0000.pdf'), 'ab.pdf');
  assert.equal(sanearNombre('x'.repeat(500)).length, 200);
  assert.equal(sanearNombre('   '), 'etiqueta.pdf');
});

test('descarga: attachment, application/pdf, nosniff, CSP sandbox y nombre sin caracteres de cabecera', async () => {
  const cod = String(BASE + ++cont);
  const id = await crearPedido(`${M}${cont}`);
  await query(`UPDATE orden_venta SET codigo_externo = $2 WHERE id_orden = $1`, [id, cod]);
  const doc = await pdf([`Nº de orden: ${cod}`]);
  assert.equal((await t.http('POST', '/api/pedidos/etiquetas', t.admin, form([['e.pdf', doc]]))).body.resultados[0].estado, 'ASOCIADA');
  await query(`UPDATE orden_venta SET codigo_externo = $2 WHERE id_orden = $1`, [id, 'X"\r\nSet-Cookie: a=b/../' + cod]); // un código hostil nunca debe llegar crudo a una cabecera
  const res = await fetch(`http://localhost:${t.server.address().port}/api/pedidos/${id}/etiqueta`, { headers: { Authorization: `Bearer ${t.bodega}` } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.match(res.headers.get('content-security-policy'), /sandbox/);
  assert.match(res.headers.get('content-disposition'), /^attachment; filename="[\w.-]+"$/);
  assert.equal(res.headers.get('set-cookie'), null);
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), doc);
});

test('sin sesión o sin permiso no se llega ni a procesar el archivo', async () => {
  const doc = await pdf(['x']);
  assert.equal((await t.http('POST', '/api/pedidos/etiquetas', null, form([['e.pdf', doc]]))).status, 401);
  for (const tok of [t.bodega, t.chofer]) assert.equal((await t.http('POST', '/api/pedidos/etiquetas', tok, form([['e.pdf', doc]]))).status, 403);
});
