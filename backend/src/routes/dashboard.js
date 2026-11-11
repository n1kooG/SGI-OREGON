import { Router } from 'express';
import { ah } from '../errors.js';
import { autenticar, requierePermiso, tiene } from '../middleware/auth.js';
import * as svc from '../services/dashboard.js';

const router = Router();

// GET /api/dashboard/kpis  (CU-02, HU09)
router.get('/kpis', autenticar, requierePermiso('inventario:leer'), ah(async (_req, res) => {
  const { data, cache } = await svc.kpis();
  res.set('X-Cache', cache).json(data);
}));

// GET /api/dashboard/top-productos
router.get('/top-productos', autenticar, requierePermiso('inventario:leer'), ah(async (_req, res) => {
  const { data, cache } = await svc.topProductos();
  res.set('X-Cache', cache).json(data);
}));

// GET /api/dashboard/alertas  (HU09)
router.get('/alertas', autenticar, requierePermiso('alertas:leer'), ah(async (_req, res) => {
  const { data, cache } = await svc.alertas();
  res.set('X-Cache', cache).json(data);
}));

// GET /api/dashboard/graficos?periodo=semana|mes|anio  (HU10; por defecto mes)
router.get('/graficos', autenticar, requierePermiso('reportes:leer'), ah(async (req, res) => {
  const { data, cache } = await svc.graficos(tiene(req, 'costos:leer'), req.query.periodo);
  res.set('X-Cache', cache).json(data);
}));

export default router;
