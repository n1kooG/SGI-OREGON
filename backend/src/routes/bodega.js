import { Router } from 'express';
import { ah } from '../errors.js';
import { autenticar, requierePermiso } from '../middleware/auth.js';
import * as svc from '../services/bodega.js';

const router = Router();
const configurar = requierePermiso('bodega:configurar');

// Estructura con sus ubicaciones: la leen Bodega (para elegir ubicación) y Administrador.
router.get('/', autenticar, requierePermiso('inventario:consultar', 'inventario:leer'), ah(async (_req, res) => res.json(await svc.estructura())));

router.post('/pasillos', autenticar, configurar, ah(async (req, res) => res.status(201).json(await svc.crearPasillo(req, req.body ?? {}))));
router.delete('/pasillos/:n', autenticar, configurar, ah(async (req, res) => res.json(await svc.borrarPasillo(req, req.params.n))));
router.post('/pasillos/:n/racks', autenticar, configurar, ah(async (req, res) => res.status(201).json(await svc.crearRack(req, req.params.n, req.body ?? {}))));
router.put('/pasillos/:n/racks/:letra', autenticar, configurar, ah(async (req, res) => res.json(await svc.cambiarPisos(req, req.params.n, req.params.letra, req.body ?? {}))));
router.delete('/pasillos/:n/racks/:letra', autenticar, configurar, ah(async (req, res) => res.json(await svc.borrarRack(req, req.params.n, req.params.letra))));

export default router;
