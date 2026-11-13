import { query } from '../db.js';

// Sin fecha, la parada queda programada para hoy (fn_hoy(): hora de Santiago, ver db/01_modelo_datos.sql).
export const insertar = async (c, idOrden, idChofer, idAsigna, { fecha = null, nota = null } = {}) =>
  (await c.query(
    `INSERT INTO despacho (id_orden, id_usuario_chofer, id_usuario_asigna, fecha_programada, nota_admin) VALUES ($1, $2, $3, COALESCE($4::date, fn_hoy()), $5) RETURNING id_despacho`,
    [idOrden, idChofer, idAsigna, fecha, nota])).rows[0].id_despacho;

// Despachos PENDIENTE de un chofer (los pedidos que quedarían sin quien los cierre si se le da de baja); la lista se acota a 20.
export async function pendientesDeChofer(c, idChofer) {
  const { rows } = await c.query(
    `SELECT o.id_orden, o.codigo_externo, count(*) OVER ()::int AS total
       FROM despacho d JOIN orden_venta o ON o.id_orden = d.id_orden
      WHERE d.id_usuario_chofer = $1 AND d.estado_entrega = 'PENDIENTE' ORDER BY d.id_despacho LIMIT 20`, [idChofer]);
  return { total: rows[0]?.total ?? 0, ordenes: rows.map(({ id_orden, codigo_externo }) => ({ id_orden, codigo_externo })) };
}

export const hoy = async (c) => (await c.query(`SELECT fn_hoy()::text AS hoy`)).rows[0].hoy;

// Último despacho del pedido, bloqueado: decide si es reprogramable.
export const ultimoDeOrden = async (c, idOrden) =>
  (await c.query(`SELECT id_despacho, id_usuario_chofer, estado_entrega, reingresado_en, fecha_programada::text AS fecha_programada FROM despacho WHERE id_orden = $1 ORDER BY id_despacho DESC LIMIT 1 FOR UPDATE`, [idOrden])).rows[0] ?? null;

// Mismas columnas en la hoja de ruta, el historial y el detalle (sin precios ni costos).
const PARADA = `ds.id_despacho, ds.id_orden, ds.estado_entrega, ds.fecha_asignacion, ds.fecha_cierre,
            o.codigo_externo, o.nombre_cliente, o.direccion_despacho, o.comuna, o.telefono_contacto, o.numero_documento_sii,
            ds.fecha_programada::text AS fecha_programada, ds.nota_admin,
            (ds.estado_entrega = 'PENDIENTE' AND ds.fecha_programada > fn_hoy()) AS futura,
            (SELECT count(*)::int FROM despacho x WHERE x.id_orden = ds.id_orden AND x.id_despacho <= ds.id_despacho) AS intento,
            EXISTS (SELECT 1 FROM despacho x WHERE x.id_orden = ds.id_orden AND x.id_despacho < ds.id_despacho) AS reprogramada,
            ds.nombre_receptor, (ds.url_firma_s3 IS NOT NULL) AS tiene_firma,
            (SELECT COALESCE(SUM(d.cantidad_vendida), 0)::int FROM detalle_venta d WHERE d.id_orden = o.id_orden) AS bultos`;

// «Cerrada hoy» se mide en la fecha civil de Santiago, no en la de la sesión de la base.
const CERRADA_HOY = `ds.fecha_cierre >= fn_hoy()::timestamp AT TIME ZONE 'America/Santiago'`;

// Paradas abiertas del chofer (las de fecha futura van al final y marcadas `futura`) más las cerradas hoy (el contador de pendientes baja y el cierre queda visible).
export async function miRuta(idChofer) {
  const { rows } = await query(
    `SELECT ${PARADA}
       FROM despacho ds JOIN orden_venta o ON o.id_orden = ds.id_orden
      WHERE ds.id_usuario_chofer = $1 AND (ds.estado_entrega = 'PENDIENTE' OR ${CERRADA_HOY})
      ORDER BY (ds.estado_entrega <> 'PENDIENTE'), (ds.fecha_programada > fn_hoy()), o.comuna, ds.id_despacho`, [idChofer]);
  return rows;
}

// Conteos de la jornada: pendientes de hoy o vencidos (las programadas a futuro no cuentan) y lo cerrado hoy.
export async function resumenJornada(idChofer) {
  const { rows: [r] } = await query(
    `SELECT count(*) FILTER (WHERE ds.estado_entrega = 'PENDIENTE' AND ds.fecha_programada <= fn_hoy())::int AS pendientes,
            count(*) FILTER (WHERE ds.estado_entrega = 'ENTREGADO' AND ${CERRADA_HOY})::int AS entregadas,
            count(*) FILTER (WHERE ds.estado_entrega = 'RECHAZADO' AND ${CERRADA_HOY})::int AS rechazadas
       FROM despacho ds WHERE ds.id_usuario_chofer = $1`, [idChofer]);
  return r;
}

// Entregas ya cerradas del chofer, de la más reciente a la más antigua, sin el corte de fecha de la hoja de ruta.
export async function historial(idChofer, limite, desplazamiento) {
  const { rows } = await query(
    `SELECT ${PARADA}, count(*) OVER ()::int AS total
       FROM despacho ds JOIN orden_venta o ON o.id_orden = ds.id_orden
      WHERE ds.id_usuario_chofer = $1 AND ds.estado_entrega <> 'PENDIENTE'
      ORDER BY ds.fecha_cierre DESC, ds.id_despacho DESC LIMIT $2 OFFSET $3`, [idChofer, limite, desplazamiento]);
  return rows;
}

export async function detalle(idChofer, id) {
  const { rows: [p] } = await query(
    `SELECT ${PARADA}, ds.motivo_rechazo FROM despacho ds JOIN orden_venta o ON o.id_orden = ds.id_orden
      WHERE ds.id_despacho = $1 AND ds.id_usuario_chofer = $2`, [id, idChofer]);
  if (!p) return null;
  const { rows } = await query(
    `SELECT d.sku, pr.nombre, pr.modelo, d.cantidad_vendida AS cantidad FROM detalle_venta d JOIN producto pr ON pr.sku = d.sku WHERE d.id_orden = $1 ORDER BY d.sku`, [p.id_orden]);
  return { ...p, items: rows };
}

export const bloquear = async (c, id) =>
  (await c.query(`SELECT id_despacho, id_orden, id_usuario_chofer, estado_entrega, reingresado_en, fecha_programada::text AS fecha_programada, (fecha_programada > fn_hoy()) AS futura FROM despacho WHERE id_despacho = $1 FOR UPDATE`, [id])).rows[0] ?? null;

export const cerrar = (c, id, estado, motivo, clave, claveFirma, receptor) => c.query(
  `UPDATE despacho SET estado_entrega = $2, motivo_rechazo = $3, url_evidencia_s3 = $4, url_firma_s3 = $5, nombre_receptor = $6, fecha_cierre = now() WHERE id_despacho = $1`,
  [id, estado, motivo, clave, claveFirma, receptor]);

export const lineasOrden = async (c, idOrden) =>
  (await c.query(`SELECT sku, cantidad_vendida::int AS cantidad FROM detalle_venta WHERE id_orden = $1 ORDER BY sku`, [idOrden])).rows;

export const marcarReingreso = async (c, id, idUsuario) =>
  (await c.query(`UPDATE despacho SET reingresado_en = now(), id_usuario_reingreso = $2 WHERE id_despacho = $1 RETURNING reingresado_en`, [id, idUsuario])).rows[0].reingresado_en;
