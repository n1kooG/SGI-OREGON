import { query } from '../db.js';

export async function kpis() {
  const [{ rows: [k] }, { rows: criticos }] = await Promise.all([
    query(`SELECT COALESCE(SUM(i.stock_fisico * p.costo_adquisicion_neto), 0)::float AS valorizacion_inventario,
                  (SELECT COUNT(*) FROM orden_venta WHERE estado_orden IN ('PENDIENTE_PREPARACION','ARMADO','ETIQUETADO'))::int AS ordenes_pendientes,
                  (SELECT ROUND(AVG(margen_porcentual), 1)::float FROM lista_precio) AS margen_promedio
             FROM inventario i JOIN producto p ON p.sku = i.sku WHERE p.estado = 'ACTIVO'`),
    query(`SELECT sku, nombre, marca, stock_fisico, stock_minimo, ubicacion_bodega FROM v_stock_critico ORDER BY sku`),
  ]);
  return { ...k, stock_critico: criticos.length, quiebres: criticos.length, productos_criticos: criticos };
}

// HU09: SKU en quiebre con reorden sugerido = reponer hasta el doble del mínimo (al menos 1 unidad).
export async function alertas() {
  const { rows } = await query(
    `SELECT v.sku, p.modelo, v.stock_fisico, v.stock_minimo, GREATEST(2 * v.stock_minimo - v.stock_fisico, 1)::int AS sugerido_reorden
       FROM v_stock_critico v JOIN producto p ON p.sku = v.sku ORDER BY (v.stock_fisico - v.stock_minimo), v.sku`);
  return rows;
}

// HU10 (T39/T40): ventana de 30 días, órdenes rechazadas excluidas. Márgenes = realizado (precio de venta vs. costo vigente) por canal de la orden.
export async function graficos() {
  const [ventas, margenes, rotacion, inmovilizado] = await Promise.all([
    query(`SELECT o.canal_origen AS canal, SUM(d.subtotal)::float AS total
             FROM orden_venta o JOIN detalle_venta d ON d.id_orden = o.id_orden
            WHERE o.estado_orden <> 'RECHAZADO' AND o.fecha_orden >= now() - interval '30 days'
            GROUP BY o.canal_origen ORDER BY total DESC`),
    query(`SELECT o.canal_origen AS canal,
                  ROUND(100 * SUM(d.subtotal - d.cantidad_vendida * p.costo_adquisicion_neto) / NULLIF(SUM(d.subtotal), 0), 1)::float AS margen_promedio
             FROM orden_venta o JOIN detalle_venta d ON d.id_orden = o.id_orden JOIN producto p ON p.sku = d.sku
            WHERE o.estado_orden <> 'RECHAZADO' AND o.fecha_orden >= now() - interval '30 days'
            GROUP BY o.canal_origen ORDER BY margen_promedio DESC NULLS LAST`),
    // rotación = unidades vendidas en 30 días / stock físico actual (mínimo 1): cuántas veces se "vació" el stock.
    query(`SELECT p.sku, p.modelo, ROUND(SUM(d.cantidad_vendida)::numeric / GREATEST(i.stock_fisico, 1), 2)::float AS rotacion
             FROM detalle_venta d JOIN orden_venta o ON o.id_orden = d.id_orden
             JOIN producto p ON p.sku = d.sku JOIN inventario i ON i.sku = p.sku
            WHERE o.estado_orden <> 'RECHAZADO' AND o.fecha_orden >= now() - interval '30 days'
            GROUP BY p.sku, p.modelo, i.stock_fisico ORDER BY rotacion DESC, p.sku LIMIT 10`),
    // inmovilizado = stock > 0 sin ventas ni ingresos en 60 días. dias = null si nunca tuvo movimiento registrado.
    query(`WITH ult AS (
             SELECT sku, MAX(f) AS f FROM (
               SELECT d.sku, o.fecha_orden AS f FROM detalle_venta d JOIN orden_venta o ON o.id_orden = d.id_orden WHERE o.estado_orden <> 'RECHAZADO'
               UNION ALL
               SELECT dr.sku, r.fecha_recepcion FROM detalle_recepcion dr JOIN recepcion_compra r ON r.id_recepcion = dr.id_recepcion) m GROUP BY sku)
           SELECT p.sku, p.modelo, i.stock_fisico, (i.stock_fisico * p.costo_adquisicion_neto)::float AS valor,
                  (CURRENT_DATE - ult.f::date)::int AS dias_sin_movimiento
             FROM producto p JOIN inventario i ON i.sku = p.sku LEFT JOIN ult ON ult.sku = p.sku
            WHERE p.estado = 'ACTIVO' AND i.stock_fisico > 0 AND (ult.f IS NULL OR ult.f < now() - interval '60 days')
            ORDER BY valor DESC LIMIT 20`),
  ]);
  return { ventas_por_canal: ventas.rows, margenes: margenes.rows, rotacion: rotacion.rows, inmovilizado: inmovilizado.rows };
}
