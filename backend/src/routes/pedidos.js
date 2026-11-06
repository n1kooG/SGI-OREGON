import { Router } from 'express';
import { ah } from '../errors.js';
import { autenticar, requierePermiso } from '../middleware/auth.js';
import * as svc from '../services/pedidos.js';

const router = Router();

// GET /api/pedidos?estado=PENDIENTE_PREPARACION  (CU-06 supervisión / HU05 lista de picking)
router.get('/', autenticar, requierePermiso('pedidos:leer', 'pedidos:preparar'), ah(async (req, res) => {
  res.json(await svc.listar(req.query.estado ? String(req.query.estado) : null));
}));

// TODO(HU04/CU-05): POST /api/pedidos/importar  (.xlsx → una transacción, rebaja de stock con UPDATE condicionado)
// TODO(HU05): PATCH /api/pedidos/:id/estado  (pedidos:preparar; el trigger valida el flujo de estados)
// TODO(HU07): GET /api/despachos/mi-ruta y PATCH /api/despachos/:id (ruta:leer, entregas:registrar)

export default router;
