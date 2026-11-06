import { Router } from 'express';
import { query } from '../db.js';
import { autenticar, requierePermiso } from '../middleware/auth.js';

const router = Router();

// GET /api/inventario/buscar?q=...  (HU06, CU-09). Respuesta SIN costos ni márgenes: sirve a Bodega.
// La búsqueda por fragmento usa los índices GIN/trigramas del modelo (ix_producto_*_trgm).
router.get('/buscar', autenticar, requierePermiso('inventario:consultar', 'inventario:leer'), async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (q.length < 2) return res.json([]);
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
  res.json(rows);
});

// TODO(HU03/CU-04): POST /api/compras/recepciones (factura + detalle, una transacción; compras:recepcionar)
// TODO(HU03): POST /api/compras/recepciones/:id/confirmar-descarga (compras:confirmar_descarga)

export default router;
