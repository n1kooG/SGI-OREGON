import { query } from '../db.js';

export async function listar(estado) {
  const { rows } = await query(
    `SELECT o.id_orden, o.codigo_externo, o.canal_origen, o.fecha_orden, o.nombre_cliente, o.comuna, o.estado_orden,
            (SELECT COALESCE(SUM(d.cantidad_vendida), 0)::int FROM detalle_venta d WHERE d.id_orden = o.id_orden) AS unidades
       FROM orden_venta o
      WHERE ($1::text IS NULL OR o.estado_orden = $1)
      ORDER BY o.fecha_orden DESC LIMIT 100`,
    [estado],
  );
  return rows;
}
