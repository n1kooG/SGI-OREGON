import { Router } from 'express';
import { query } from '../db.js';
import { autenticar, requierePermiso, tiene } from '../middleware/auth.js';

const router = Router();

// GET /api/productos  (HU01, HU02, CU-03). Costos y precios solo se incluyen si el rol los tiene (HU08, PU-09).
// TODO(HU01): POST /api/productos y PUT /api/productos/:sku (catalogo:escribir; el SKU es inmutable)
// TODO(HU02): PUT /api/productos/:sku/precios (precios:escribir)
router.get('/', autenticar, requierePermiso('catalogo:leer'), async (req, res) => {
  const verCostos = tiene(req, 'costos:leer');
  const verPrecios = tiene(req, 'precios:leer');
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
  res.json(rows.map(({ _fin, ...r }) => r));
});

export default router;
