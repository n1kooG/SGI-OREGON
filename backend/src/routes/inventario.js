import { Router } from 'express';
import { ah } from '../errors.js';
import { autenticar, requierePermiso } from '../middleware/auth.js';
import * as svc from '../services/inventario.js';

const router = Router();

// GET /api/inventario/buscar?q=...  (HU06, CU-09). Respuesta SIN costos ni márgenes: sirve a Bodega.
router.get('/buscar', autenticar, requierePermiso('inventario:consultar', 'inventario:leer'), ah(async (req, res) => {
  res.json(await svc.buscar(String(req.query.q ?? '').trim()));
}));

router.get('/resumen', autenticar, requierePermiso('inventario:consultar', 'inventario:leer'), ah(async (_req, res) => res.json(await svc.resumen())));

// Bodega la fija al descargar; el Administrador la corrige en el Catálogo. No expone costos.
router.put('/:sku/ubicacion', autenticar, requierePermiso('inventario:ubicar'), ah(async (req, res) => {
  res.json(await svc.ubicar(req, req.params.sku, req.body ?? {}));
}));

export default router;
