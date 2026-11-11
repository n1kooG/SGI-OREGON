import * as repo from '../repositories/despachos.js';
import * as pedidos from '../repositories/pedidos.js';
import { incrementarFisico } from '../repositories/inventario.js';
import { conTransaccion } from '../db.js';
import { auditar } from '../audit.js';
import { AppError } from '../errors.js';
import { almacenamientoActivo, subir } from '../storage.js';
import { config } from '../config.js';

const bad = (msg, status = 400, codigo = 'VALIDACION') => new AppError(status, msg, codigo);
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png' };
const JPG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47];
const PNG_FIRMA = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const FIRMA_MAX = 1024 * 1024; // un trazo en un canvas pesa pocos KB

export const miRuta = (req) => repo.miRuta(req.usuario.id_usuario);

// Coordenadas opcionales (PI-04): ambas o ninguna; se guardan como «lat,lon» con 6 decimales, formato que exige el CHECK de audit_log.
function geo(lat, lon) {
  if ((lat ?? '') === '' && (lon ?? '') === '') return null;
  const [la, lo] = [Number(lat), Number(lon)];
  if (lat === '' || lon === '' || !Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) throw bad('latitud y longitud deben ser coordenadas válidas');
  return `${la.toFixed(6)},${lo.toFixed(6)}`;
}

// `foto` y `firma` = { buffer, mimetype } opcionales (la firma solo aplica a ENTREGADO). Como en compras, S3 y la BD no comparten transacción: la foto se sube antes de abrirla
// (clave determinista, se sobrescribe al reintentar); si la transacción falla a lo sumo queda un objeto huérfano.
export async function cerrar(req, id, body = {}, foto = null, firma = null) {
  const estado = body.estado;
  if (!['ENTREGADO', 'RECHAZADO'].includes(estado)) throw bad('estado debe ser ENTREGADO o RECHAZADO');
  const motivo = typeof body.motivo === 'string' ? body.motivo.trim() : '';
  if (estado === 'RECHAZADO' && !motivo) throw bad('El rechazo exige una causal (motivo)', 400, 'CAUSAL_OBLIGATORIA');
  if (motivo.length > 300) throw bad('El motivo admite máximo 300 caracteres');
  const coords = geo(body.latitud, body.longitud);
  if (foto) {
    const ok = foto.buffer.length > 4 && (foto.mimetype === 'image/jpeg' ? JPG : foto.mimetype === 'image/png' ? PNG : null)?.every((b, i) => foto.buffer[i] === b);
    if (!ok) throw bad('La evidencia debe ser una imagen JPG o PNG');
  }
  const receptor = typeof body.nombre_receptor === 'string' ? body.nombre_receptor.trim() : '';
  if (receptor.length > 120) throw bad('El nombre del receptor admite máximo 120 caracteres');
  if (estado === 'RECHAZADO' && (firma || receptor)) throw bad('La firma y el receptor solo aplican a las entregas');
  if (estado === 'ENTREGADO' && config.exigirReceptorEntrega && !firma && !receptor) throw bad('La entrega exige la firma o el nombre del receptor', 400, 'RECEPTOR_OBLIGATORIO');
  if (firma) {
    if (firma.mimetype !== 'image/png' || !PNG_FIRMA.every((b, i) => firma.buffer[i] === b)) throw bad('La firma debe ser una imagen PNG');
    if (firma.buffer.length > FIRMA_MAX) throw bad('La firma supera 1 MB', 413, 'ARCHIVO_INVALIDO');
  }

  const d = await conTransaccion((c) => repo.bloquear(c, id));
  if (!d || d.id_usuario_chofer !== req.usuario.id_usuario) throw new AppError(404, 'Despacho no encontrado', 'NO_ENCONTRADO'); // no se revela el de otro chofer
  if (d.estado_entrega !== 'PENDIENTE') throw bad('La entrega ya fue cerrada', 409, 'YA_CERRADO');

  let clave = null;
  if (foto && almacenamientoActivo()) {
    clave = `evidencias/${id}.${EXT[foto.mimetype]}`;
    await subir(clave, foto.buffer, foto.mimetype);
  } // shortcut: con almacenamiento desactivado la foto se descarta sin error y url_evidencia_s3 queda NULL.
  let claveFirma = null;
  if (firma && almacenamientoActivo()) claveFirma = await subir(`firmas/${id}.png`, firma.buffer, 'image/png'); // igual: sin S3 url_firma_s3 queda NULL; el nombre sí se guarda

  return conTransaccion(async (c) => {
    const actual = await repo.bloquear(c, id);
    if (actual.estado_entrega !== 'PENDIENTE') throw bad('La entrega ya fue cerrada', 409, 'YA_CERRADO');
    await repo.cerrar(c, id, estado, motivo || null, clave, claveFirma, receptor || null);
    try {
      await pedidos.fijarEstado(c, actual.id_orden, estado); // trg_orden_transicion: solo desde EN_RUTA
    } catch (e) {
      if (e.code === '23514') throw bad(e.message, 409, 'TRANSICION_INVALIDA');
      throw e;
    }
    await auditar(req, {
      idUsuario: req.usuario.id_usuario, tabla: 'despacho', accion: 'ENTREGA', geo: coords,
      antes: { id_despacho: id, estado_entrega: 'PENDIENTE' },
      despues: { id_despacho: id, id_orden: actual.id_orden, estado_entrega: estado, motivo_rechazo: motivo || null, evidencia: clave, firma: claveFirma, nombre_receptor: receptor || null }, // la imagen nunca va a la bitácora: solo su clave
    }, c);
    return { id_despacho: id, id_orden: actual.id_orden, estado_entrega: estado, evidencia: !!clave, firma: !!claveFirma, nombre_receptor: receptor || null };
  });
}

// PI-05: el rechazo vuelve físicamente a bodega. Devuelve el stock de cada línea, marca el reingreso y deja el pedido en EN_CAMION
// para reasignar chofer, todo en una transacción (si falla cualquier paso no queda stock devuelto a medias).
export async function reingresar(req, id) {
  return conTransaccion(async (c) => {
    const d = await repo.bloquear(c, id);
    if (!d) throw new AppError(404, 'Despacho no encontrado', 'NO_ENCONTRADO');
    if (d.estado_entrega !== 'RECHAZADO') throw bad('Solo se reingresan despachos rechazados', 409, 'NO_RECHAZADO');
    if (d.reingresado_en) throw bad('El rechazo ya fue reingresado', 409, 'YA_REINGRESADO');
    const lineas = await repo.lineasOrden(c, d.id_orden);
    for (const l of lineas) {
      if (!(await incrementarFisico(l.sku, l.cantidad, c))) throw bad(`El SKU ${l.sku} no tiene inventario`, 409, 'SIN_INVENTARIO');
    }
    const reingresadoEn = await repo.marcarReingreso(c, id, req.usuario.id_usuario);
    try {
      await pedidos.fijarEstado(c, d.id_orden, 'EN_CAMION'); // trg_orden_transicion: RECHAZADO -> EN_CAMION
    } catch (e) {
      if (e.code === '23514') throw bad(e.message, 409, 'TRANSICION_INVALIDA');
      throw e;
    }
    const unidades = lineas.reduce((n, l) => n + l.cantidad, 0);
    await auditar(req, {
      idUsuario: req.usuario.id_usuario, tabla: 'despacho', accion: 'REINGRESO',
      antes: { id_orden: d.id_orden, estado_orden: 'RECHAZADO' },
      despues: { id_orden: d.id_orden, id_despacho: id, estado_orden: 'EN_CAMION', unidades, items: lineas },
    }, c);
    return { id_despacho: id, id_orden: d.id_orden, estado_orden: 'EN_CAMION', unidades, reingresado_en: reingresadoEn };
  });
}
