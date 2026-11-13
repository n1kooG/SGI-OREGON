import { query } from '../db.js';

// Un pedido reprogramado tiene varios despachos: se toma siempre el último (el vigente o el más reciente).
const ULTIMO_DESPACHO = `LEFT JOIN LATERAL (SELECT * FROM despacho x WHERE x.id_orden = o.id_orden ORDER BY x.id_despacho DESC LIMIT 1) ds ON true`;

// Datos del intento vigente: N° de despachos del pedido, fecha programada, nota del administrador y cuándo se rechazó.
const INTENTO = `(SELECT count(*)::int FROM despacho x WHERE x.id_orden = o.id_orden) AS intento,
            (SELECT count(*) > 1 FROM despacho x WHERE x.id_orden = o.id_orden) AS reprogramado,
            ds.fecha_programada::text AS fecha_programada, ds.nota_admin,
            CASE WHEN ds.estado_entrega = 'RECHAZADO' THEN ds.fecha_cierre END AS fecha_rechazo`;

export async function listar(estados, canal, porReingresar = false) {
  const { rows } = await query(
    `SELECT o.id_orden, o.codigo_externo, o.canal_origen, o.fecha_orden, o.nombre_cliente, o.direccion_despacho, o.comuna, o.estado_orden,
            ${INTENTO},
            (SELECT COALESCE(SUM(d.cantidad_vendida), 0)::int FROM detalle_venta d WHERE d.id_orden = o.id_orden) AS unidades,
            (o.url_etiqueta IS NOT NULL) AS tiene_etiqueta, o.etiqueta_nombre_archivo, o.etiqueta_importada_en,
            ds.id_usuario_chofer, u.nombre_completo AS nombre_chofer, ds.estado_entrega,
            ds.motivo_rechazo, ds.nombre_receptor, ds.reingresado_en, (ds.reingresado_en IS NOT NULL) AS reingresado
       FROM orden_venta o
       ${ULTIMO_DESPACHO}
       LEFT JOIN usuario u ON u.id_usuario = ds.id_usuario_chofer
      WHERE ($1::text[] IS NULL OR o.estado_orden = ANY($1)) AND ($2::text IS NULL OR o.canal_origen = $2)
        AND (NOT $3::boolean OR (ds.estado_entrega = 'RECHAZADO' AND ds.reingresado_en IS NULL))
      ORDER BY o.fecha_orden DESC LIMIT 100`,
    [estados, canal, porReingresar],
  );
  return rows;
}

export async function obtener(id, c = { query }) {
  const { rows } = await c.query(
    `SELECT o.id_orden, o.codigo_externo, o.canal_origen, o.fecha_orden, o.nombre_cliente, o.direccion_despacho, o.comuna,
            o.telefono_contacto, o.estado_orden, o.numero_documento_sii, o.rut_cliente,
            (o.url_etiqueta IS NOT NULL) AS tiene_etiqueta, o.etiqueta_nombre_archivo, o.etiqueta_importada_en,
            ${INTENTO},
            ds.id_despacho, ds.id_usuario_chofer, ch.nombre_completo AS nombre_chofer, ds.fecha_asignacion, ds.fecha_cierre,
            (ds.url_evidencia_s3 IS NOT NULL) AS tiene_evidencia, ds.estado_entrega,
            (SELECT a.geolocalizacion FROM audit_log a WHERE a.tabla_afectada = 'despacho' AND a.accion = 'ENTREGA'
                AND (a.valores_nuevos->>'id_despacho')::int = ds.id_despacho ORDER BY a.id_log DESC LIMIT 1) AS geolocalizacion,
            ds.motivo_rechazo, ds.nombre_receptor, (ds.url_firma_s3 IS NOT NULL) AS tiene_firma,
            ds.reingresado_en, (ds.reingresado_en IS NOT NULL) AS reingresado
       FROM orden_venta o ${ULTIMO_DESPACHO} LEFT JOIN usuario ch ON ch.id_usuario = ds.id_usuario_chofer WHERE o.id_orden = $1`, [id]);
  return rows[0] ?? null;
}

// Historial de intentos de entrega del pedido, del primero al último.
export async function intentos(id) {
  const { rows } = await query(
    `SELECT (row_number() OVER (ORDER BY ds.id_despacho))::int AS intento, ds.id_despacho, ch.nombre_completo AS chofer,
            ds.fecha_asignacion, ds.fecha_programada::text AS fecha_programada, ds.estado_entrega, ds.motivo_rechazo, ds.reingresado_en,
            ds.nota_admin, asg.nombre_completo AS asignado_por
       FROM despacho ds JOIN usuario ch ON ch.id_usuario = ds.id_usuario_chofer LEFT JOIN usuario asg ON asg.id_usuario = ds.id_usuario_asigna
      WHERE ds.id_orden = $1 ORDER BY ds.id_despacho`, [id]);
  return rows;
}

export async function items(id) {
  const { rows } = await query(
    `SELECT d.sku, p.nombre, p.modelo, i.ubicacion_bodega, d.cantidad_vendida AS cantidad, d.precio_unitario, d.subtotal
       FROM detalle_venta d JOIN producto p ON p.sku = d.sku LEFT JOIN inventario i ON i.sku = d.sku
      WHERE d.id_orden = $1 ORDER BY i.ubicacion_bodega NULLS LAST, d.sku`, [id]);
  return rows;
}

// Datos de entrega editables al reprogramar. `campos` solo trae columnas fijas del servicio (nunca nombres del cliente).
export async function actualizarEntrega(c, id, campos) {
  const cols = Object.keys(campos);
  if (!cols.length) return;
  await c.query(`UPDATE orden_venta SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id_orden = $1`, [id, ...cols.map((k) => campos[k])]);
}
export async function entregaActual(c, id) {
  return (await c.query(`SELECT direccion_despacho, comuna, telefono_contacto FROM orden_venta WHERE id_orden = $1`, [id])).rows[0];
}

// Bloquea la orden durante la transacción: dos cambios de estado simultáneos se serializan y el "antes" auditado es el real.
export const bloquear = async (c, id) => (await c.query(`SELECT estado_orden FROM orden_venta WHERE id_orden = $1 FOR UPDATE`, [id])).rows[0]?.estado_orden ?? null;
// El trigger trg_orden_transicion valida el flujo; aquí solo se escribe.
export const fijarEstado = (c, id, estado) => c.query(`UPDATE orden_venta SET estado_orden = $2 WHERE id_orden = $1`, [id, estado]);
export const skuEnOrden = async (id, sku) => (await query(`SELECT 1 FROM detalle_venta WHERE id_orden = $1 AND sku = $2`, [id, sku])).rowCount === 1;

// RUT -> válido, en una sola consulta (la planilla puede traer miles de filas).
export async function rutsInvalidos(ruts) {
  const { rows } = await query(`SELECT r FROM unnest($1::text[]) AS t(r) WHERE NOT fn_rut_valido(r)`, [ruts]);
  return new Set(rows.map((x) => x.r));
}

export async function insertarLote(c, { idUsuario, archivo, ordenes, lineas }) {
  const { rows } = await c.query(
    `INSERT INTO lote_importacion (id_usuario, nombre_archivo, url_archivo_s3, total_ordenes, total_lineas) VALUES ($1,$2,'pendiente',$3,$4) RETURNING id_lote`,
    [idUsuario, archivo, ordenes, lineas]);
  return rows[0].id_lote;
}

export const fijarClaveLote = (c, idLote, clave) => c.query(`UPDATE lote_importacion SET url_archivo_s3 = $2 WHERE id_lote = $1`, [idLote, clave]);

// Inserta todas las órdenes del lote de una vez; devuelve codigo_externo -> id_orden.
export async function insertarOrdenes(c, idLote, canal, ordenes) {
  const { rows } = await c.query(
    `INSERT INTO orden_venta (id_lote, codigo_externo, canal_origen, rut_cliente, nombre_cliente)
     SELECT $1, cod, $2, rut, nombre FROM unnest($3::text[], $4::text[], $5::text[]) AS t(cod, rut, nombre)
     RETURNING id_orden, codigo_externo`,
    [idLote, canal, ordenes.map((o) => o.codigo), ordenes.map((o) => o.rut), ordenes.map((o) => o.nombre)]);
  return new Map(rows.map((r) => [r.codigo_externo, r.id_orden]));
}

export const insertarDetalles = (c, lineas) => c.query(
  `INSERT INTO detalle_venta (id_orden, sku, cantidad_vendida, precio_unitario)
   SELECT * FROM unnest($1::int[], $2::text[], $3::int[], $4::numeric[])`,
  [lineas.map((l) => l.idOrden), lineas.map((l) => l.sku), lineas.map((l) => l.cantidad), lineas.map((l) => l.precio)]);

// Conteos de la jornada de Bodega. «En camión» = esperando que el administrador asigne chofer (no tiene despacho abierto).
export async function resumen() {
  const { rows } = await query(`SELECT estado_orden, count(*)::int AS n FROM orden_venta WHERE estado_orden IN ('PENDIENTE_PREPARACION', 'ARMADO', 'ETIQUETADO', 'EN_CAMION') GROUP BY estado_orden`);
  const por = Object.fromEntries(rows.map((r) => [r.estado_orden, r.n]));
  const { rows: [{ n }] } = await query(`SELECT count(*)::int AS n FROM despacho WHERE estado_entrega = 'RECHAZADO' AND reingresado_en IS NULL`);
  return {
    pendiente_preparacion: por.PENDIENTE_PREPARACION ?? 0, armado: por.ARMADO ?? 0, etiquetado: por.ETIQUETADO ?? 0,
    en_camion_esperando_chofer: por.EN_CAMION ?? 0, rechazados_por_reingresar: n,
  };
}

export const documentoActual = async (c, id) => {
  const { rows } = await c.query(`SELECT numero_documento_sii FROM orden_venta WHERE id_orden = $1 FOR UPDATE`, [id]);
  return rows.length ? { numero: rows[0].numero_documento_sii } : null;
};
export const fijarDocumento = (c, id, numero) => c.query(`UPDATE orden_venta SET numero_documento_sii = $2 WHERE id_orden = $1`, [id, numero]);

// Etiquetas importadas. La coincidencia con el N° de orden del marketplace usa la misma normalización que `normalizarCodigo` (pdf/leerOrden.js).
// shortcut: recorre orden_venta sin índice funcional; suficiente para el volumen de la tienda, indexar si crece a cientos de miles de pedidos.
const NORM_CODIGO_SQL = `regexp_replace(regexp_replace(upper(codigo_externo), '\\s+', '', 'g'), '^(#|ORD-?)*0*', '')`;
export async function buscarPorCodigo(norm) {
  const { rows } = await query(`SELECT id_orden, codigo_externo, (url_etiqueta IS NOT NULL) AS tiene_etiqueta FROM orden_venta WHERE ${NORM_CODIGO_SQL} = $1 LIMIT 2`, [norm]);
  return rows;
}
// Bloquea la orden y devuelve su etiqueta actual (o null si el pedido no existe).
export async function etiquetaActual(c, id) {
  const { rows } = await c.query(`SELECT codigo_externo, url_etiqueta, etiqueta_nombre_archivo FROM orden_venta WHERE id_orden = $1 FOR UPDATE`, [id]);
  return rows[0] ?? null;
}
export const fijarEtiqueta = (c, id, clave, nombre) => c.query(
  `UPDATE orden_venta SET url_etiqueta = $2, etiqueta_nombre_archivo = $3, etiqueta_importada_en = now() WHERE id_orden = $1 RETURNING etiqueta_importada_en`, [id, clave, nombre]);
export const limpiarEtiqueta = (c, id) => c.query(`UPDATE orden_venta SET url_etiqueta = NULL, etiqueta_nombre_archivo = NULL, etiqueta_importada_en = NULL WHERE id_orden = $1`, [id]);
export async function etiquetaDe(id) {
  const { rows } = await query(`SELECT codigo_externo, url_etiqueta, etiqueta_nombre_archivo FROM orden_venta WHERE id_orden = $1`, [id]);
  return rows[0] ?? null;
}
