import PDFDocument from 'pdfkit';
import * as repo from '../repositories/pedidos.js';
import * as despachos from '../repositories/despachos.js';
import { conTransaccion } from '../db.js';
import { auditar } from '../audit.js';
import { AppError } from '../errors.js';
import { tiene } from '../middleware/auth.js';
import { C, marca, rotulo } from '../pdf/estilo.js';
import { dibujarCode128 } from '../pdf/code128.js';
import { formatearRut } from '../rut.js';

const bad = (msg, status = 400, codigo = 'VALIDACION') => new AppError(status, msg, codigo);
const BODEGA = ['PENDIENTE_PREPARACION', 'ARMADO', 'ETIQUETADO', 'EN_CAMION']; // los 4 estados reversibles (Tabla 17)
const ESTADOS = [...BODEGA, 'EN_RUTA', 'ENTREGADO', 'RECHAZADO'];

// Los errores de los triggers del esquema (transición no permitida, chofer inválido) son 409; la regla vive en la BD, no se repite aquí.
const dePg = (e) => {
  if (e.code === '23514') throw bad(e.message, 409, 'TRANSICION_INVALIDA');
  if (e.code === '23505') throw bad('El pedido ya tiene un despacho asignado', 409, 'YA_ASIGNADO');
  throw e;
};

// Bodega (sin pedidos:leer) ve solo lo que debe preparar; el Administrador ve todo para supervisar (CU-06).
export function listar(req, { estado, canal } = {}) {
  if (estado && !ESTADOS.includes(estado)) throw bad('Estado inválido');
  const estados = estado ? [estado] : tiene(req, 'pedidos:leer') ? null : BODEGA;
  return repo.listar(estados, canal ? String(canal) : null);
}

async function existente(id) {
  const o = await repo.obtener(id);
  if (!o) throw new AppError(404, 'Pedido no encontrado', 'NO_ENCONTRADO');
  return o;
}

export async function detalle(req, id) {
  const o = await existente(id);
  const items = await repo.items(id);
  // El precio de venta es del Administrador (precios:leer); Bodega solo recibe lo que necesita para recolectar.
  return { ...o, items: tiene(req, 'precios:leer') ? items : items.map(({ precio_unitario, subtotal, ...resto }) => resto) };
}

export async function cambiarEstado(req, id, estado) {
  if (!BODEGA.includes(estado)) throw bad(`Estado inválido. Permitidos: ${BODEGA.join(', ')}`);
  try {
    return await conTransaccion(async (c) => {
      const antes = await repo.bloquear(c, id);
      if (!antes) throw new AppError(404, 'Pedido no encontrado', 'NO_ENCONTRADO');
      if (antes === estado) return { id_orden: id, estado_orden: estado };
      await repo.fijarEstado(c, id, estado);
      await auditar(req, { idUsuario: req.usuario.id_usuario, tabla: 'orden_venta', accion: 'CAMBIO_ESTADO', antes: { id_orden: id, estado_orden: antes }, despues: { id_orden: id, estado_orden: estado } }, c);
      return { id_orden: id, estado_orden: estado };
    });
  } catch (e) { return dePg(e); }
}

// Discrepancia de picking (dañado / faltante): no hay tabla propia, queda en la bitácora inmutable.
export async function comentar(req, id, { sku, tipo, comentario } = {}) {
  await existente(id);
  if (!['DANADO', 'FALTANTE'].includes(tipo)) throw bad('tipo debe ser DANADO o FALTANTE');
  const txt = typeof comentario === 'string' ? comentario.trim() : '';
  if (!txt || txt.length > 300) throw bad('El comentario es obligatorio (máximo 300 caracteres)');
  const s = String(sku ?? '').trim().toUpperCase();
  if (!(await repo.skuEnOrden(id, s))) throw bad(`El SKU ${s} no pertenece al pedido`, 422, 'SKU_FUERA_DE_PEDIDO');
  await conTransaccion((c) => auditar(req, { idUsuario: req.usuario.id_usuario, tabla: 'orden_venta', accion: 'DISCREPANCIA', despues: { id_orden: id, sku: s, tipo, comentario: txt } }, c));
  return { id_orden: id, sku: s, tipo, comentario: txt };
}

// Etiqueta de despacho 10×15 cm (CU-10). Se genera en memoria; no se guarda.
export async function etiqueta(req, id) {
  const o = await detalle(req, id);
  const rut = await repo.rutCliente(id);
  const doc = new PDFDocument({ size: [283, 425], margin: 0, info: { Title: `Etiqueta ${o.codigo_externo}`, Author: 'Tienda Oregón' } });
  const partes = [];
  doc.on('data', (b) => partes.push(b));
  const fin = new Promise((ok) => doc.on('end', () => ok(Buffer.concat(partes))));
  dibujarEtiqueta(doc, o, rut);
  doc.end();
  await auditar(req, { idUsuario: req.usuario.id_usuario, tabla: 'orden_venta', accion: 'ETIQUETA', despues: { id_orden: id } });
  return { pdf: await fin, nombre: `etiqueta_${o.codigo_externo}.pdf` };
}

// Mayor tamaño (de `max` a `min`) con que el texto cabe en `ancho`; null si ni al mínimo cabe.
function ajustar(doc, t, fuente, max, min, ancho) {
  for (let f = max; f >= min; f -= 0.5) if (doc.font(fuente).fontSize(f).widthOfString(t) <= ancho) return f;
  return null;
}
// Recorta con «…» para que el texto (a ese tamaño) quepa en `ancho`.
function recortar(doc, t, fuente, tam, ancho, espaciado = 0) {
  doc.font(fuente).fontSize(tam);
  const cabe = (x) => doc.widthOfString(x, { characterSpacing: espaciado }) <= ancho;
  if (cabe(t)) return t;
  let r = t;
  while (r.length > 1 && !cabe(r + '…')) r = r.slice(0, -1);
  return r.trimEnd() + '…';
}

export function dibujarEtiqueta(doc, o, rut) {
  const M = 14, W = 283 - 2 * M, cl = (d) => new Date(d).toLocaleDateString('es-CL', { timeZone: 'America/Santiago' });
  const caja = (y, h) => doc.lineWidth(1).roundedRect(M, y, W, h, 3).strokeColor(C.tinta).stroke();
  doc.rect(0, 0, 283, 425).fill(C.blanco); // fondo blanco explícito
  // Encabezado de marca
  doc.rect(0, 0, 283, 40).fill(C.tinta);
  marca(doc, M, 12, 14);
  doc.font('Helvetica-Bold').fontSize(7).fillColor(C.blanco).text('ETIQUETA DE DESPACHO', M, 16, { width: W, align: 'right', characterSpacing: 0.8, lineBreak: false });
  // Código de orden + canal: el código se reduce hasta caber en una línea; la píldora se mide por su texto
  // y, si el código no cabe a ≥ 20 pt a su lado, baja a la fila del rótulo «Orden».
  const canal = recortar(doc, String(o.canal_origen).toUpperCase(), 'Helvetica-Bold', 8, 150, 0.6), cw = doc.font('Helvetica-Bold').fontSize(8).widthOfString(canal, { characterSpacing: 0.6 }) + 16;
  const codigo = String(o.codigo_externo), junto = ajustar(doc, codigo, 'Helvetica-Bold', 27, 20, W - cw - 10);
  const pillY = junto ? 62 : 46, tam = junto ?? ajustar(doc, codigo, 'Helvetica-Bold', 27, 12, W) ?? 12;
  rotulo(doc, 'Orden', M, 50);
  doc.font('Helvetica-Bold').fontSize(tam).fillColor(C.tinta).text(recortar(doc, codigo, 'Helvetica-Bold', tam, junto ? W - cw - 10 : W), M, junto ? 59 : 67 + (27 - tam) / 2, { lineBreak: false });
  doc.lineWidth(1.2).roundedRect(M + W - cw, pillY, cw, 18, 9).strokeColor(C.tinta).stroke();
  doc.font('Helvetica-Bold').fontSize(8).fillColor(C.tinta).text(canal, M + W - cw, pillY + 5.5, { width: cw, align: 'center', characterSpacing: 0.6, lineBreak: false });
  // Código de barras
  const mod = Math.min(2.2, W / (11 * (o.codigo_externo.length + 2) + 13));
  const ancho = dibujarCode128(doc, o.codigo_externo, M, 98, 34, mod);
  doc.font('Courier').fontSize(8).fillColor(C.tinta).text(recortar(doc, codigo, 'Courier', 8, W, 1), M, 136, { width: Math.max(ancho, 1), align: 'center', characterSpacing: 1, lineBreak: false });
  // Destinatario
  caja(154, 100);
  doc.rect(M, 154, 3, 100).fill(C.tinta);
  rotulo(doc, 'Destinatario', M + 12, 161);
  const tn = ajustar(doc, o.nombre_cliente, 'Helvetica-Bold', 13, 10, W - 22) ?? 10;
  doc.font('Helvetica-Bold').fontSize(tn).fillColor(C.tinta).text(recortar(doc, o.nombre_cliente, 'Helvetica-Bold', tn, W - 22), M + 12, 173 + (13 - tn) / 2, { lineBreak: false });
  let y = 191;
  if (rut) { doc.font('Courier').fontSize(8.5).fillColor(C.tinta3).text(`RUT ${formatearRut(rut) ?? rut}`, M + 12, y, { lineBreak: false }); y += 13; }
  doc.font('Helvetica').fontSize(9).fillColor(C.tinta).text(o.direccion_despacho ?? 'Sin dirección registrada', M + 12, y, { width: W - 22, height: 22, ellipsis: true });
  doc.font('Helvetica-Bold').fontSize(11).text(recortar(doc, (o.comuna ?? '').toUpperCase(), 'Helvetica-Bold', 11, W - 22), M + 12, rut ? 230 : 226, { lineBreak: false });
  if (o.telefono_contacto) doc.font('Courier').fontSize(8.5).fillColor(C.tinta3).text(`Tel. ${o.telefono_contacto}`, M + 12, rut ? 242 : 240, { lineBreak: false });
  // Contenido
  rotulo(doc, 'Contenido', M, 263);
  const unidades = o.items.reduce((a, i) => a + i.cantidad, 0);
  rotulo(doc, `${unidades} ${unidades === 1 ? 'unidad' : 'unidades'}`, M, 263, { width: W, align: 'right' });
  doc.rect(M, 274, W, 13).fill(C.tinta);
  for (const [t, x, w, al] of [['SKU', 5, 56], ['Descripción', 62, 86], ['Ubic.', 150, 66], ['Cant.', 218, 33, 'right']]) {
    doc.font('Helvetica-Bold').fontSize(6.5).fillColor(C.blanco).text(t.toUpperCase(), M + x, 278.5, { width: w, align: al, characterSpacing: 0.5, lineBreak: false });
  }
  const MAX = 4;
  y = 287;
  o.items.slice(0, MAX).forEach((i, n) => {
    if (n % 2) doc.rect(M, y, W, 15).fill(C.fondo);
    doc.font('Courier-Bold').fontSize(7.5).fillColor(C.tinta).text(i.sku, M + 5, y + 4, { width: 56, lineBreak: false, ellipsis: true });
    doc.font('Helvetica').fontSize(7.5).text(i.nombre, M + 62, y + 3.8, { width: 84, lineBreak: false, ellipsis: true });
    doc.font('Helvetica').fontSize(6.5).fillColor(C.tinta3).text(i.ubicacion_bodega ?? '—', M + 150, y + 4.5, { width: 66, lineBreak: false, ellipsis: true });
    doc.font('Helvetica-Bold').fontSize(9).fillColor(C.tinta).text(String(i.cantidad), M + 218, y + 3.5, { width: 33, align: 'right', lineBreak: false });
    y += 15;
  });
  if (o.items.length > MAX) { doc.font('Helvetica-Oblique').fontSize(7).fillColor(C.tinta3).text(`+ ${o.items.length - MAX} ítem(s) más en el pedido`, M + 5, y + 2, { lineBreak: false }); y += 12; }
  doc.moveTo(M, y).lineTo(M + W, y).lineWidth(0.5).strokeColor(C.lineaFuerte).stroke();
  // Pie: bultos, documento, fecha
  const py = 366, h = 44, tercio = W / 3;
  caja(py, h);
  doc.moveTo(M + tercio, py).lineTo(M + tercio, py + h).moveTo(M + 2 * tercio, py).lineTo(M + 2 * tercio, py + h).lineWidth(0.5).strokeColor(C.tinta).stroke();
  [['Bultos', '1 / 1', 'Helvetica-Bold', 15], ['N° doc. SII', o.numero_documento_sii ?? '—', 'Courier-Bold', 11], ['Fecha', cl(o.fecha_orden), 'Helvetica-Bold', 11]].forEach(([r, v, f, t], n) => {
    rotulo(doc, r, M + n * tercio + 8, py + 8, { tam: 6 });
    doc.font(f).fontSize(t).fillColor(C.tinta).text(v, M + n * tercio + 8, py + 21, { width: tercio - 12, lineBreak: false, ellipsis: true });
  });
}

// CU-06 / T50: asigna chofer (EN_CAMION -> EN_RUTA) y crea el despacho en una sola transacción con su auditoría.
export async function asignarChofer(req, id, idChofer) {
  if (!Number.isInteger(idChofer) || idChofer <= 0) throw bad('id_chofer debe ser un entero');
  try {
    return await conTransaccion(async (c) => {
      const antes = await repo.bloquear(c, id);
      if (!antes) throw new AppError(404, 'Pedido no encontrado', 'NO_ENCONTRADO');
      const idDespacho = await despachos.insertar(c, id, idChofer); // trg_despacho_solo_chofer exige un CHOFER activo
      await repo.fijarEstado(c, id, 'EN_RUTA'); // trg_orden_transicion exige EN_CAMION
      await auditar(req, { idUsuario: req.usuario.id_usuario, tabla: 'despacho', accion: 'ASIGNACION_CHOFER', antes: { id_orden: id, estado_orden: antes }, despues: { id_orden: id, id_despacho: idDespacho, id_usuario_chofer: idChofer, estado_orden: 'EN_RUTA' } }, c);
      return { id_despacho: idDespacho, id_orden: id, id_usuario_chofer: idChofer, estado_orden: 'EN_RUTA' };
    });
  } catch (e) { return dePg(e); }
}
