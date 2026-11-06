import { query } from '../db.js';

// Las columnas de costo/margen solo se piden a la BD si el rol puede verlas (HU08, PU-09).
export async function listar({ verCostos, verPrecios }) {
  const { rows } = await query(
    `SELECT p.sku, p.modelo, p.nombre, p.marca, p.categoria, p.estado, p.stock_minimo,
            i.stock_fisico, i.stock_reservado, i.ubicacion_bodega,
            ${verCostos ? 'p.costo_adquisicion_neto,' : ''}
            ${verPrecios ? `(SELECT json_object_agg(l.canal_venta, json_build_object('precio', l.precio_venta_neto${verCostos ? ", 'margen', l.margen_porcentual" : ''}))
                              FROM lista_precio l WHERE l.sku = p.sku) AS precios,` : ''}
            true AS _fin
       FROM producto p LEFT JOIN inventario i ON i.sku = p.sku
      ORDER BY p.sku`,
  );
  return rows.map(({ _fin, ...r }) => r);
}
