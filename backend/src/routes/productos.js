import { Router } from 'express';
import { ah } from '../errors.js';
import { autenticar, requierePermiso } from '../middleware/auth.js';
import * as svc from '../services/productos.js';

const router = Router();

// GET /api/productos  (HU01, HU02, CU-03). Costos y precios solo se incluyen si el rol los tiene (HU08, PU-09).
// TODO(HU01): POST /api/productos y PUT /api/productos/:sku (catalogo:escribir; el SKU es inmutable)
// TODO(HU02): PUT /api/productos/:sku/precios (precios:escribir)
router.get('/', autenticar, requierePermiso('catalogo:leer'), ah(async (req, res) => {
  res.json(await svc.listar(req.usuario.permisos));
}));

export default router;
