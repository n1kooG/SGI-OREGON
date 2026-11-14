// Etiquetas importadas del marketplace: asignación manual (el admin las asigna; no se leen ni se asocian solas), borrado, descarga, permisos y almacenamiento en disco.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';

const dir = await mkdtemp(join(tmpdir(), 'etq-api-'));
process.env.ETIQUETAS_DIR = dir; // antes de cargar la app: así el disco de la prueba es desechable
process.env.STORAGE_ENABLED = 'false';
const { iniciar, crearPedido, limpiar } = await import('./_aux.js');
const { pool, query } = await import('../src/db.js');
const { cerrarCache } = await import('../src/cache.js');
const { almacenamientoActivo } = await import('../src/storage.js');
const { sanearNombre } = await import('../src/services/etiquetas.js');

const M = `etq${Date.now().toString(36)}`;
const BASE = Number(String(Date.now()).slice(-8)) * 100;
let t, cont = 0;

// Pedido con un N° de orden único (los de prueba no colisionan con los del seed).
async function pedido(codigo = String(BASE + ++cont)) {
  const id = await crearPedido(`${M}${cont}`);
  await query(`UPDATE orden_venta SET codigo_externo = $2 WHERE id_orden = $1`, [id, codigo]);
  return { id, codigo };
}
const pdf = (texto) => new Promise((ok) => {
  const d = new PDFDocument({ size: [283, 425] }), partes = [];
  d.on('data', (p) => partes.push(p)).on('end', () => ok(Buffer.concat(partes)));
  d.fontSize(10).text('Remitente: Comercial Oregon').text(texto).end();
});
const form = (archivos, campo = 'archivos') => {
  const f = new FormData();
  for (const [nombre, buf] of archivos) f.append(campo, new Blob([buf], { type: 'application/pdf' }), nombre);
  return f;
};
const subir = (token, id, nombre, buf) => t.http('PUT', `/api/pedidos/${id}/etiqueta`, token, form([[nombre, buf]], 'archivo'));
const fila = async (id) => (await query(`SELECT * FROM orden_venta WHERE id_orden = $1`, [id])).rows[0];
const auditoria = async (accion, id) => (await query(`SELECT * FROM audit_log WHERE accion = $1 AND (valores_nuevos->>'id_orden')::int = $2 ORDER BY id_log`, [accion, id])).rows;

before(async () => { t = await iniciar(); });
after(async () => { await limpiar(M); await rm(dir, { recursive: true, force: true }); t.server.close(); await cerrarCache(); await pool.end(); });

test('sin S3 el almacenamiento es el disco local', () => assert.equal(almacenamientoActivo(), false));

test('asignación manual: asocia sin leer el texto, valida el PDF y reemplaza', async () => {
  const p = await pedido();
  const sinNumero = await pdf('Etiqueta sin N° reconocible');
  const r = await t.http('PUT', `/api/pedidos/${p.id}/etiqueta`, t.admin, form([['manual.pdf', sinNumero]], 'archivo'));
  assert.equal(r.status, 200);
  assert.equal(r.body.estado, 'ASOCIADA');
  assert.equal(r.body.etiqueta_nombre_archivo, 'manual.pdf');
  assert.equal((await fila(p.id)).etiqueta_nombre_archivo, 'manual.pdf');
  assert.equal((await readFile(join(dir, `${p.id}.pdf`))).subarray(0, 5).toString(), '%PDF-');
  const [a] = await auditoria('ETIQUETA_IMPORTADA', p.id);
  assert.equal(a.id_usuario, t.idAdmin);
  assert.equal(a.valores_nuevos.manual, true);
  assert.ok(!JSON.stringify(a).includes('%PDF'));
  const otra = await t.http('PUT', `/api/pedidos/${p.id}/etiqueta`, t.admin, form([['otra.pdf', sinNumero]], 'archivo'));
  assert.equal(otra.body.estado, 'REEMPLAZADA');
  const mala = await t.http('PUT', `/api/pedidos/${p.id}/etiqueta`, t.admin, form([['x.pdf', Buffer.from('no soy pdf')]], 'archivo'));
  assert.equal(mala.status, 400);
  assert.equal(mala.body.codigo, 'ARCHIVO_INVALIDO');
  assert.equal((await t.http('PUT', `/api/pedidos/${p.id}/etiqueta`, t.admin, new FormData())).status, 400);
  assert.equal((await t.http('PUT', '/api/pedidos/999999999/etiqueta', t.admin, form([['x.pdf', sinNumero]], 'archivo'))).status, 404);
  assert.equal((await fila(p.id)).etiqueta_nombre_archivo, 'otra.pdf');
});

test('descarga: Bodega y Admin reciben el PDF y se audita; sin etiqueta es 404 SIN_ETIQUETA', async () => {
  const p = await pedido();
  const sin = await t.http('GET', `/api/pedidos/${p.id}/etiqueta`, t.bodega);
  assert.equal(sin.status, 404);
  assert.equal(sin.body.codigo, 'SIN_ETIQUETA');
  const original = await pdf(`Nº de orden: ${p.codigo}`);
  await subir(t.admin, p.id, 'd.pdf', original);
  for (const tok of [t.bodega, t.admin]) {
    const r = await t.http('GET', `/api/pedidos/${p.id}/etiqueta`, tok);
    assert.equal(r.status, 200);
    assert.match(r.tipo, /application\/pdf/);
    assert.deepEqual(r.body, original);
  }
  const r = await fetch(`http://localhost:${t.server.address().port}/api/pedidos/${p.id}/etiqueta`, { headers: { Authorization: `Bearer ${t.bodega}` } });
  assert.equal(r.headers.get('content-disposition'), `attachment; filename="etiqueta_${p.codigo}.pdf"`);
  assert.equal((await auditoria('ETIQUETA', p.id)).length, 3);
  assert.equal((await t.http('GET', '/api/pedidos/999999999/etiqueta', t.bodega)).status, 404);
});

test('listados y detalle: tiene_etiqueta, nombre y fecha para Admin y Bodega; nunca la clave', async () => {
  const con = await pedido(), sin = await pedido();
  await subir(t.admin, con.id, 'lista.pdf', await pdf('etiqueta lista'));
  for (const tok of [t.admin, t.bodega]) {
    const lista = (await t.http('GET', '/api/pedidos', tok)).body;
    const a = lista.find((x) => x.id_orden === con.id), b = lista.find((x) => x.id_orden === sin.id);
    assert.equal(a.tiene_etiqueta, true);
    assert.equal(a.etiqueta_nombre_archivo, 'lista.pdf');
    assert.ok(a.etiqueta_importada_en);
    assert.deepEqual([b.tiene_etiqueta, b.etiqueta_nombre_archivo, b.etiqueta_importada_en], [false, null, null]);
    const d = (await t.http('GET', `/api/pedidos/${con.id}`, tok)).body;
    assert.deepEqual([d.tiene_etiqueta, d.etiqueta_nombre_archivo], [true, 'lista.pdf']);
    assert.doesNotMatch(JSON.stringify([lista, d]), /url_etiqueta|etiquetas\//);
  }
});

test('quitar: borra el archivo, limpia las columnas y audita; sin etiqueta 404', async () => {
  const p = await pedido();
  await subir(t.admin, p.id, 'q.pdf', await pdf('etiqueta q'));
  const r = await t.http('DELETE', `/api/pedidos/${p.id}/etiqueta`, t.admin);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { id_orden: p.id });
  const o = await fila(p.id);
  assert.deepEqual([o.url_etiqueta, o.etiqueta_nombre_archivo, o.etiqueta_importada_en], [null, null, null]);
  assert.equal(existsSync(join(dir, `${p.id}.pdf`)), false);
  const [a] = await auditoria('ETIQUETA_ELIMINADA', p.id);
  assert.equal(a.valores_anteriores.archivo, 'q.pdf');
  const otra = await t.http('DELETE', `/api/pedidos/${p.id}/etiqueta`, t.admin);
  assert.equal(otra.status, 404);
  assert.equal(otra.body.codigo, 'SIN_ETIQUETA');
  assert.equal((await t.http('DELETE', '/api/pedidos/999999999/etiqueta', t.admin)).status, 404);
  assert.equal((await t.http('GET', `/api/pedidos/${p.id}/etiqueta`, t.bodega)).status, 404);
});

test('permisos: Bodega no asigna ni borra; Chofer y sin sesión no entran', async () => {
  const p = await pedido();
  const buen = await pdf('etiqueta permisos');
  await subir(t.admin, p.id, 'perm.pdf', buen);
  for (const tok of [t.bodega, t.chofer]) {
    assert.equal((await subir(tok, p.id, 'x.pdf', buen)).status, 403);
    assert.equal((await t.http('PUT', `/api/pedidos/${p.id}/etiqueta`, tok, form([['x.pdf', buen]], 'archivo'))).status, 403);
    assert.equal((await t.http('DELETE', `/api/pedidos/${p.id}/etiqueta`, tok)).status, 403);
  }
  assert.equal((await t.http('GET', `/api/pedidos/${p.id}/etiqueta`, t.chofer)).status, 403);
  assert.equal((await t.http('GET', `/api/pedidos/${p.id}/etiqueta`, null)).status, 401);
  assert.equal((await subir(null, p.id, 'x.pdf', buen)).status, 401);
  assert.equal((await fila(p.id)).etiqueta_nombre_archivo, 'perm.pdf');
  const roles = Object.fromEntries((await query(`SELECT nombre_rol, permisos FROM rol`)).rows.map((r) => [r.nombre_rol, r.permisos]));
  assert.ok(roles.ADMINISTRADOR.includes('pedidos:etiquetas'));
  assert.ok(!roles.BODEGA.includes('pedidos:etiquetas') && !roles.CHOFER.includes('pedidos:etiquetas'));
});

test('disco seguro: nombres con ../ no escapan del directorio y la clave sale solo de id_orden', async () => {
  const p = await pedido();
  const r = await subir(t.admin, p.id, '../../../../tmp/evil.pdf', await pdf('x'));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.estado, 'ASOCIADA');
  assert.equal((await fila(p.id)).etiqueta_nombre_archivo, 'evil.pdf');
  assert.ok((await readdir(dir)).every((x) => /^\d+\.pdf$/.test(x)));
  assert.equal(existsSync(join(dir, '..', 'evil.pdf')) || existsSync('/tmp/evil.pdf'), false);
  const raro = await t.http('PUT', `/api/pedidos/${p.id}/etiqueta`, t.admin, form([['..\\..\\ab.pdf', await pdf('x')]], 'archivo'));
  assert.equal(raro.status, 200, JSON.stringify(raro.body));
  assert.equal(raro.body.etiqueta_nombre_archivo, 'ab.pdf');
});

test('nombres de archivo: sin ruta, sin control ni marcas bidireccionales, a lo más 200 caracteres', () => {
  assert.equal(sanearNombre('../../etc/passwd'), 'passwd');
  assert.equal(sanearNombre('C:\\x\\y\\z.pdf'), 'z.pdf');
  const comoMulter = (x) => Buffer.from(x, 'utf8').toString('latin1'); // multer entrega los nombres decodificados como latin1
  assert.equal(sanearNombre(comoMulter('a\u202egnp.pdf')), 'agnp.pdf');
  assert.equal(sanearNombre('a\r\nb\u0000.pdf'), 'ab.pdf');
  assert.equal(sanearNombre('x'.repeat(500)).length, 200);
  assert.equal(sanearNombre('   '), 'etiqueta.pdf');
});

test('descarga segura: attachment, application/pdf, nosniff, CSP sandbox y nombre sin caracteres de cabecera', async () => {
  const p = await pedido();
  const doc = await pdf('etiqueta descarga segura');
  await subir(t.admin, p.id, 'e.pdf', doc);
  await query(`UPDATE orden_venta SET codigo_externo = $2 WHERE id_orden = $1`, [p.id, 'X"\r\nSet-Cookie: a=b/../' + p.codigo]); // un código hostil nunca debe llegar crudo a una cabecera
  const res = await fetch(`http://localhost:${t.server.address().port}/api/pedidos/${p.id}/etiqueta`, { headers: { Authorization: `Bearer ${t.bodega}` } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.match(res.headers.get('content-security-policy'), /sandbox/);
  assert.match(res.headers.get('content-disposition'), /^attachment; filename="[\w.-]+"$/);
  assert.equal(res.headers.get('set-cookie'), null);
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), doc);
});
