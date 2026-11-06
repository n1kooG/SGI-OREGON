import { Router } from 'express';
import { query } from '../db.js';
import { autenticar, requierePermiso } from '../middleware/auth.js';

const router = Router();

// GET /api/pedidos?estado=PENDIENTE_PREPARACION  (CU-06 supervisión / HU05 lista de picking)
router.get('/', autenticar, requierePermiso('pedidos:leer', 'pedidos:preparar'), async (req, res) => {
  const estado = req.query.estado ? String(req.query.estado) : null;
  const { rows } = await query(
    `SELECT o.id_orden, o.codigo_externo, o.canal_origen, o.fecha_orden, o.nombre_cliente, o.comuna, o.estado_orden,
            (SELECT COALESCE(SUM(d.cantidad_vendida), 0)::int FROM detalle_venta d WHERE d.id_orden = o.id_orden) AS unidades
       FROM orden_venta o
      WHERE ($1::text IS NULL OR o.estado_orden = $1)
      ORDER BY o.fecha_orden DESC LIMIT 100`,
    [estado],
  );
  res.json(rows);
});

// TODO(HU04/CU-05): POST /api/pedidos/importar  (.xlsx → una transacción, rebaja de stock con UPDATE condicionado)
// TODO(HU05): PATCH /api/pedidos/:id/estado  (pedidos:preparar; el trigger valida el flujo de estados)
// TODO(HU07): GET /api/despachos/mi-ruta y PATCH /api/despachos/:id (ruta:leer, entregas:registrar)

export default router;
