import { query } from '../db.js';

// Sin costos ni márgenes: sirve a Bodega. Usa los índices GIN/trigramas del modelo.
export async function buscar(q) {
  const { rows } = await query(
    `SELECT p.sku, p.modelo, p.nombre, p.marca,
            i.stock_fisico, i.stock_reservado, (i.stock_fisico - i.stock_reservado) AS stock_disponible,
            i.ubicacion_bodega
       FROM producto p JOIN inventario i ON i.sku = p.sku
      WHERE p.estado = 'ACTIVO'
        AND (p.sku ILIKE $1 || '%' OR p.modelo ILIKE '%' || $1 || '%' OR p.nombre ILIKE '%' || $1 || '%')
      ORDER BY p.sku
      LIMIT 20`,
    [q],
  );
  return rows;
}
