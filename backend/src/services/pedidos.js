import * as repo from '../repositories/pedidos.js';
import * as despachos from '../repositories/despachos.js';
import { conTransaccion } from '../db.js';
import { auditar } from '../audit.js';
import { AppError } from '../errors.js';
import { tiene } from '../middleware/auth.js';

const bad = (msg, status = 400, codigo = 'VALIDACION') => new AppError(status, msg, codigo);
const BODEGA = ['PENDIENTE_PREPARACION', 'ARMADO', 'ETIQUETADO', 'EN_CAMION']; // los 4 estados reversibles (Tabla 17)
const ESTADOS = [...BODEGA, 'EN_RUTA', 'ENTREGADO', 'RECHAZADO'];

// Los errores de los triggers del esquema (transición no permitida, chofer inválido) son 409; la regla vive en la BD, no se repite aquí.
const dePg = (e) => {
  if (e.code === '23514') throw bad(e.message, 409, 'TRANSICION_INVALIDA');
  if (e.code === '23505') throw bad('El pedido ya tiene un despacho asignado', 409, 'YA_ASIGNADO');
  throw e;
};

// Bodega (sin pedidos:leer) ve solo lo que debe preparar (y, aparte, los rechazos por reingresar); el Administrador ve todo para supervisar (CU-06).
// `por_reingresar` (Bodega y Administrador): solo los RECHAZADO cuyo bulto aún no volvió a bodega; aparte de los 4 estados de bodega.
// Paginado: `pagina` (≥ 1) y `limite` (1..LIMITE_MAX, por defecto LIMITE_DEFECTO). Devuelve { filas, total }; el total va en X-Total-Count.
export const LIMITE_DEFECTO = 100;
export const LIMITE_MAX = 500;
const entero = (v, def, nombre, min, max) => {
  if (v === undefined || v === '') return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${nombre} debe ser un entero entre ${min} y ${max}`);
  return n;
};

export async function listar(req, { estado, canal, por_reingresar, pagina, limite } = {}) {
  if (estado && !ESTADOS.includes(estado)) throw bad('Estado inválido');
  const pagina_ = entero(pagina, 1, 'pagina', 1, 1_000_000);
  const limite_ = entero(limite, LIMITE_DEFECTO, 'limite', 1, LIMITE_MAX);
  const admin = tiene(req, 'pedidos:leer');
  const porReingresar = ['1', 'true'].includes(String(por_reingresar));
  if (porReingresar && estado && estado !== 'RECHAZADO') throw bad('por_reingresar solo aplica a pedidos RECHAZADO');
  if (!admin && estado && !BODEGA.includes(estado) && !porReingresar) throw new AppError(403, 'No tienes permiso para consultar pedidos en ese estado', 'ACCESO_DENEGADO');
  const estados = porReingresar ? ['RECHAZADO'] : estado ? [estado] : admin ? null : BODEGA;
  const { filas, total } = await repo.listar(estados, canal ? String(canal) : null, porReingresar, { limite: limite_, offset: (pagina_ - 1) * limite_, fifo: !admin });
  // Los choferes (nombre e id) son información de administración: Bodega no los necesita para preparar ni reingresar.
  return { filas: admin ? filas : filas.map(({ id_usuario_chofer, nombre_chofer, ...resto }) => resto), total };
}

export const resumen = () => repo.resumen();

async function existente(id) {
  const o = await repo.obtener(id);
  if (!o) throw new AppError(404, 'Pedido no encontrado', 'NO_ENCONTRADO');
  return o;
}

export async function detalle(req, id) {
  const o = await existente(id);
  const [items, intentos] = await Promise.all([repo.items(id), repo.intentos(id)]);
  // El precio de venta es del Administrador (precios:leer); Bodega solo recibe lo que necesita para recolectar.
  const base = tiene(req, 'pedidos:leer') ? o : (({ rut_cliente, geolocalizacion, nombre_chofer, fecha_cierre, ...resto }) => resto)(o); // RUT, chofer y ubicación del cierre: solo administración
  // Los nombres de las personas (chofer y quien asignó) son solo de administración.
  const hist = tiene(req, 'pedidos:leer') ? intentos : intentos.map(({ chofer, asignado_por, ...resto }) => resto);
  return { ...base, intentos: hist, items: tiene(req, 'precios:leer') ? items : items.map(({ precio_unitario, subtotal, ...resto }) => resto) };
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

// CU-06 / T50: asigna chofer (EN_CAMION -> EN_RUTA) y crea el despacho en una sola transacción con su auditoría.
export async function asignarChofer(req, id, idChofer) {
  if (!Number.isInteger(idChofer) || idChofer <= 0) throw bad('id_chofer debe ser un entero');
  try {
    return await conTransaccion(async (c) => {
      const antes = await repo.bloquear(c, id);
      if (!antes) throw new AppError(404, 'Pedido no encontrado', 'NO_ENCONTRADO');
      const idDespacho = await despachos.insertar(c, id, idChofer, req.usuario.id_usuario); // trg_despacho_solo_chofer exige un CHOFER activo
      await repo.fijarEstado(c, id, 'EN_RUTA'); // trg_orden_transicion exige EN_CAMION
      await auditar(req, { idUsuario: req.usuario.id_usuario, tabla: 'despacho', accion: 'ASIGNACION_CHOFER', antes: { id_orden: id, estado_orden: antes }, despues: { id_orden: id, id_despacho: idDespacho, id_usuario_chofer: idChofer, estado_orden: 'EN_RUTA' } }, c);
      return { id_despacho: idDespacho, id_orden: id, id_usuario_chofer: idChofer, estado_orden: 'EN_RUTA' };
    });
  } catch (e) { return dePg(e); }
}

const LARGOS = { direccion_despacho: 200, comuna: 60, telefono_contacto: 20 }; // = largos de columna en orden_venta
const FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

// Reprograma la entrega de un rechazo ya reingresado: datos de entrega opcionales, despacho nuevo con fecha y nota, pedido a EN_RUTA y auditoría, en una transacción.
// «Hoy» es la fecha civil de America/Santiago (fn_hoy() en la base): la fecha de entrega no puede ser anterior.
export async function reprogramar(req, id, body = {}) {
  const { id_chofer: idChofer, fecha_entrega: fecha, nota } = body;
  if (!Number.isInteger(idChofer) || idChofer <= 0) throw bad('id_chofer debe ser un entero');
  const m = typeof fecha === 'string' && FECHA.exec(fecha);
  if (!m || new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toISOString().slice(0, 10) !== fecha) throw bad('fecha_entrega debe ser una fecha válida con formato AAAA-MM-DD');
  if (nota !== undefined && nota !== null && typeof nota !== 'string') throw bad('nota debe ser texto');
  const notaTxt = (nota ?? '').trim() || null;
  if (notaTxt && notaTxt.length > 300) throw bad('nota admite máximo 300 caracteres');
  const nuevos = {};
  for (const [k, max] of Object.entries(LARGOS)) {
    if (body[k] === undefined || body[k] === null) continue;
    const v = typeof body[k] === 'string' ? body[k].trim() : null;
    if (!v) throw bad(`${k} debe ser un texto no vacío`);
    if (v.length > max) throw bad(`${k} admite máximo ${max} caracteres`);
    if (k === 'telefono_contacto' && !/^\+?[0-9][0-9 -]*$/.test(v)) throw bad('telefono_contacto admite solo +, dígitos, espacios y guiones');
    nuevos[k] = v;
  }
  try {
    return await conTransaccion(async (c) => {
      const estado = await repo.bloquear(c, id);
      if (!estado) throw new AppError(404, 'Pedido no encontrado', 'NO_ENCONTRADO');
      const ultimo = await despachos.ultimoDeOrden(c, id);
      if (estado !== 'EN_CAMION' || ultimo?.estado_entrega !== 'RECHAZADO' || !ultimo.reingresado_en) {
        throw bad('Solo se reprograma un pedido rechazado y reingresado a bodega (EN_CAMION)', 409, 'NO_REPROGRAMABLE');
      }
      if (fecha < (await despachos.hoy(c))) throw bad('fecha_entrega no puede ser anterior a hoy', 400, 'FECHA_PASADA');
      const actual = await repo.entregaActual(c, id);
      const cambios = Object.fromEntries(Object.entries(nuevos).filter(([k, v]) => actual[k] !== v));
      await repo.actualizarEntrega(c, id, cambios);
      const idDespacho = await despachos.insertar(c, id, idChofer, req.usuario.id_usuario, { fecha, nota: notaTxt }); // trg_despacho_solo_chofer exige un CHOFER activo
      await repo.fijarEstado(c, id, 'EN_RUTA');
      await auditar(req, {
        idUsuario: req.usuario.id_usuario, tabla: 'despacho', accion: 'REPROGRAMACION',
        antes: { id_orden: id, estado_orden: 'EN_CAMION', id_despacho: ultimo.id_despacho, id_usuario_chofer: ultimo.id_usuario_chofer, fecha_programada: ultimo.fecha_programada, ...Object.fromEntries(Object.keys(cambios).map((k) => [k, actual[k]])) },
        despues: { id_orden: id, estado_orden: 'EN_RUTA', id_despacho: idDespacho, id_usuario_chofer: idChofer, fecha_programada: fecha, nota_largo: notaTxt?.length ?? 0, ...cambios }, // la nota completa no va a la bitácora: solo su largo
      }, c);
      return { id_despacho: idDespacho, id_orden: id, id_usuario_chofer: idChofer, estado_orden: 'EN_RUTA', fecha_programada: fecha, nota_admin: notaTxt, ...cambios };
    });
  } catch (e) { return dePg(e); }
}

// T30: el N° de boleta/factura SII lo registra o corrige el Administrador. Vacío o null lo quita; si no cambia no se escribe ni se audita.
export async function documentar(req, id, numero) {
  if (numero !== undefined && numero !== null && typeof numero !== 'string') throw bad('numero_documento debe ser texto');
  const n = (numero ?? '').trim();
  if (n && !/^[0-9-]{1,20}$/.test(n)) throw bad('numero_documento admite solo dígitos y guion (máximo 20 caracteres)');
  return conTransaccion(async (c) => {
    const actual = await repo.documentoActual(c, id);
    if (!actual) throw new AppError(404, 'Pedido no encontrado', 'NO_ENCONTRADO');
    const nuevo = n || null;
    if (actual.numero !== nuevo) {
      await repo.fijarDocumento(c, id, nuevo);
      await auditar(req, { idUsuario: req.usuario.id_usuario, tabla: 'orden_venta', accion: 'DOCUMENTO_SII', antes: { id_orden: id, numero_documento_sii: actual.numero }, despues: { id_orden: id, numero_documento_sii: nuevo } }, c);
    }
    return { id_orden: id, numero_documento_sii: nuevo };
  });
}
