import * as repo from '../repositories/pedidos.js';
import * as despachos from '../repositories/despachos.js';
import { conTransaccion } from '../db.js';
import { auditar } from '../audit.js';
import { AppError } from '../errors.js';
import { tiene } from '../middleware/auth.js';
import { pdfEtiqueta } from '../pdf/etiqueta.js';
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
// `por_reingresar` (Bodega y Administrador): solo los RECHAZADO cuyo bulto aún no volvió a bodega; aparte de los 4 estados de bodega.
export function listar(req, { estado, canal, por_reingresar } = {}) {
  if (estado && !ESTADOS.includes(estado)) throw bad('Estado inválido');
  const porReingresar = ['1', 'true'].includes(String(por_reingresar));
  if (porReingresar && estado && estado !== 'RECHAZADO') throw bad('por_reingresar solo aplica a pedidos RECHAZADO');
  const estados = porReingresar ? ['RECHAZADO'] : estado ? [estado] : tiene(req, 'pedidos:leer') ? null : BODEGA;
  return repo.listar(estados, canal ? String(canal) : null, porReingresar);
}

export const resumen = () => repo.resumen();

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
  const pdf = await pdfEtiqueta(o, rut && (formatearRut(rut) ?? rut));
  await auditar(req, { idUsuario: req.usuario.id_usuario, tabla: 'orden_venta', accion: 'ETIQUETA', despues: { id_orden: id } });
  return { pdf, nombre: `etiqueta_${o.codigo_externo}.pdf` };
}

export { dibujarEtiqueta } from '../pdf/etiqueta.js';

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
