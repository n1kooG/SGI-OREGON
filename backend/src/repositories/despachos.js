import { query } from '../db.js';

export const insertar = async (c, idOrden, idChofer) =>
  (await c.query(`INSERT INTO despacho (id_orden, id_usuario_chofer) VALUES ($1, $2) RETURNING id_despacho`, [idOrden, idChofer])).rows[0].id_despacho;

// Paradas abiertas del chofer más las cerradas hoy (el contador de pendientes baja y el cierre queda visible).
export async function miRuta(idChofer) {
  const { rows } = await query(
    `SELECT ds.id_despacho, ds.id_orden, ds.estado_entrega, ds.fecha_asignacion, ds.fecha_cierre,
            o.codigo_externo, o.nombre_cliente, o.direccion_despacho, o.comuna, o.telefono_contacto, o.numero_documento_sii,
            ds.nombre_receptor, (ds.url_firma_s3 IS NOT NULL) AS tiene_firma,
            (SELECT COALESCE(SUM(d.cantidad_vendida), 0)::int FROM detalle_venta d WHERE d.id_orden = o.id_orden) AS bultos
       FROM despacho ds JOIN orden_venta o ON o.id_orden = ds.id_orden
      WHERE ds.id_usuario_chofer = $1 AND (ds.estado_entrega = 'PENDIENTE' OR ds.fecha_cierre >= CURRENT_DATE)
      ORDER BY (ds.estado_entrega <> 'PENDIENTE'), o.comuna, ds.id_despacho`, [idChofer]);
  return rows;
}

export const bloquear = async (c, id) =>
  (await c.query(`SELECT id_despacho, id_orden, id_usuario_chofer, estado_entrega, reingresado_en FROM despacho WHERE id_despacho = $1 FOR UPDATE`, [id])).rows[0] ?? null;

export const cerrar = (c, id, estado, motivo, clave, claveFirma, receptor) => c.query(
  `UPDATE despacho SET estado_entrega = $2, motivo_rechazo = $3, url_evidencia_s3 = $4, url_firma_s3 = $5, nombre_receptor = $6, fecha_cierre = now() WHERE id_despacho = $1`,
  [id, estado, motivo, clave, claveFirma, receptor]);

export const lineasOrden = async (c, idOrden) =>
  (await c.query(`SELECT sku, cantidad_vendida::int AS cantidad FROM detalle_venta WHERE id_orden = $1 ORDER BY sku`, [idOrden])).rows;

export const marcarReingreso = async (c, id, idUsuario) =>
  (await c.query(`UPDATE despacho SET reingresado_en = now(), id_usuario_reingreso = $2 WHERE id_despacho = $1 RETURNING reingresado_en`, [id, idUsuario])).rows[0].reingresado_en;
