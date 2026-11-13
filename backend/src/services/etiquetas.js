// Etiquetas de despacho exportadas desde el marketplace: el administrador las importa y asocia al pedido; Bodega las descarga.
import * as repo from '../repositories/pedidos.js';
import { conTransaccion } from '../db.js';
import { auditar } from '../audit.js';
import { AppError } from '../errors.js';
import { guardarArchivo, leerArchivo, borrarArchivo } from '../storage.js';
import { leerNumeroOrden, normalizarCodigo } from '../pdf/leerOrden.js';

export const MAX_BYTES = 2 * 1024 * 1024;
export const MAX_ARCHIVOS = 100;
const NO_ENCONTRADO = () => new AppError(404, 'Pedido no encontrado', 'NO_ENCONTRADO');

// Solo el nombre (sin ruta ni caracteres de control), a lo más 200 caracteres. Se muestra y se audita; jamás forma parte de una ruta de disco.
export function sanearNombre(nombre) {
  let n = String(nombre ?? '');
  const u = Buffer.from(n, 'latin1').toString('utf8'); // multer entrega los nombres como latin1
  if (!u.includes('�')) n = u;
  n = n.split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(-200); // sin control ni marcas bidi (disfrazan la extensión)
  return n || 'etiqueta.pdf';
}

// null si es válido; si no, el motivo.
const motivoInvalido = (buffer) => {
  if (!buffer?.length) return 'El archivo está vacío';
  if (buffer.length > MAX_BYTES) return 'El archivo supera 2 MB';
  if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') return 'El archivo no es un PDF';
  return null;
};

// Guarda el PDF y lo asocia al pedido en una transacción con su auditoría. La clave sale solo de id_orden.
async function asociar(req, id, buffer, nombre, extra = {}) {
  const clave = `etiquetas/${id}.pdf`;
  return conTransaccion(async (c) => {
    const antes = await repo.etiquetaActual(c, id);
    if (!antes) throw NO_ENCONTRADO();
    await guardarArchivo(clave, buffer, 'application/pdf');
    const { rows: [{ etiqueta_importada_en }] } = await repo.fijarEtiqueta(c, id, clave, nombre);
    const reemplazo = !!antes.url_etiqueta;
    await auditar(req, { idUsuario: req.usuario.id_usuario, tabla: 'orden_venta', accion: 'ETIQUETA_IMPORTADA',
      antes: reemplazo ? { id_orden: id, archivo: antes.etiqueta_nombre_archivo } : undefined,
      despues: { id_orden: id, codigo_externo: antes.codigo_externo, archivo: nombre, reemplazo, ...extra } }, c);
    return { estado: reemplazo ? 'REEMPLAZADA' : 'ASOCIADA', id_orden: id, codigo_externo: antes.codigo_externo, etiqueta_nombre_archivo: nombre, etiqueta_importada_en };
  });
}

const PRESUPUESTO_LOTE_MS = 120_000; // tiempo total máximo de lectura de un lote; el resto se informa para reintentar

// Importación masiva: cada archivo se resuelve por separado y un archivo malo no aborta el lote. La lectura de los PDF (no confiables)
// corre en workers aislados con tope de tiempo, memoria y concurrencia; la asociación a pedidos sigue siendo secuencial y en orden.
export async function importar(req, archivos = []) {
  if (!archivos.length) throw new AppError(400, 'Adjunta al menos un PDF (campo archivos)', 'ARCHIVO_INVALIDO');
  const limite = Date.now() + PRESUPUESTO_LOTE_MS;
  const lecturas = archivos.map((f) => (motivoInvalido(f.buffer) ? null : (async () => {
    if (Date.now() > limite) return { fallo: 'Se agotó el tiempo de procesamiento del lote; vuelve a subir este archivo' };
    try { return { numero: await leerNumeroOrden(f.buffer) }; } catch (e) { return { fallo: e.code === 'TIEMPO_AGOTADO' ? 'El PDF tardó demasiado en leerse' : 'No se pudo leer el PDF' }; }
  })()));
  const resultados = [];
  for (const [i, f] of archivos.entries()) {
    const archivo = sanearNombre(f.originalname);
    const motivo = motivoInvalido(f.buffer);
    if (motivo) { resultados.push({ archivo, estado: 'INVALIDO', motivo }); continue; }
    const lectura = await lecturas[i];
    if (lectura.fallo) { resultados.push({ archivo, estado: 'INVALIDO', motivo: lectura.fallo }); continue; }
    const numero = lectura.numero;
    const norm = numero && normalizarCodigo(numero);
    if (!norm) { resultados.push({ archivo, estado: 'NO_RECONOCIDA', motivo: 'No se encontró el N° de orden en el PDF' }); continue; }
    const pedidos = await repo.buscarPorCodigo(norm);
    if (pedidos.length !== 1) {
      resultados.push({ archivo, estado: 'PEDIDO_NO_ENCONTRADO', codigo_externo: numero, motivo: pedidos.length ? 'Más de un pedido coincide con ese N° de orden; asígnala a mano' : 'Ningún pedido tiene ese N° de orden' });
      continue;
    }
    try {
      const r = await asociar(req, pedidos[0].id_orden, f.buffer, archivo);
      resultados.push({ archivo, estado: r.estado, id_orden: r.id_orden, codigo_externo: r.codigo_externo });
    } catch (e) { resultados.push({ archivo, estado: 'INVALIDO', motivo: e instanceof AppError ? e.message : 'No se pudo guardar el archivo' }); }
  }
  return { total: resultados.length, resultados };
}

// Asignación manual (no se lee el texto del PDF).
export async function asignar(req, id, archivo) {
  if (!archivo) throw new AppError(400, 'Falta el PDF (campo archivo)', 'ARCHIVO_INVALIDO');
  const motivo = motivoInvalido(archivo.buffer);
  if (motivo) throw new AppError(400, motivo, 'ARCHIVO_INVALIDO');
  const { estado, id_orden, etiqueta_nombre_archivo, etiqueta_importada_en } = await asociar(req, id, archivo.buffer, sanearNombre(archivo.originalname), { manual: true });
  return { id_orden, estado, etiqueta_nombre_archivo, etiqueta_importada_en };
}

export async function quitar(req, id) {
  return conTransaccion(async (c) => {
    const actual = await repo.etiquetaActual(c, id);
    if (!actual) throw NO_ENCONTRADO();
    if (!actual.url_etiqueta) throw new AppError(404, 'El pedido no tiene etiqueta', 'SIN_ETIQUETA');
    await repo.limpiarEtiqueta(c, id);
    await auditar(req, { idUsuario: req.usuario.id_usuario, tabla: 'orden_venta', accion: 'ETIQUETA_ELIMINADA', antes: { id_orden: id, archivo: actual.etiqueta_nombre_archivo }, despues: { id_orden: id } }, c);
    await borrarArchivo(actual.url_etiqueta); // al final: si la transacción falla, el archivo sigue asociado
    return { id_orden: id };
  });
}

export async function descargar(req, id) {
  const o = await repo.etiquetaDe(id);
  if (!o) throw NO_ENCONTRADO();
  const sinEtiqueta = new AppError(404, 'El pedido no tiene etiqueta', 'SIN_ETIQUETA');
  if (!o.url_etiqueta) throw sinEtiqueta;
  const partes = [];
  try { for await (const p of await leerArchivo(o.url_etiqueta)) partes.push(p); }
  catch (e) { if (e.code === 'ENOENT' || e.name === 'NoSuchKey') throw sinEtiqueta; throw e; }
  await auditar(req, { idUsuario: req.usuario.id_usuario, tabla: 'orden_venta', accion: 'ETIQUETA', despues: { id_orden: id } });
  return { pdf: Buffer.concat(partes), nombre: `etiqueta_${o.codigo_externo}.pdf` };
}
