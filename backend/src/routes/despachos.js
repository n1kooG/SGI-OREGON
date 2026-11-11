import { Router } from 'express';
import multer from 'multer';
import { ah, AppError } from '../errors.js';
import { autenticar, requierePermiso } from '../middleware/auth.js';
import * as svc from '../services/despachos.js';

const router = Router();

// HU07: el Chofer ve su hoja de ruta (ruta:leer) y cierra entregas (entregas:registrar). El cierre admite JSON o multipart con `foto` y `firma` (PNG).
const subida = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 2 } });
const conArchivos = (req, res, next) => subida.fields([{ name: 'foto', maxCount: 1 }, { name: 'firma', maxCount: 1 }])(req, res, (e) => {
  if (!e) return next();
  next(new AppError(e.code === 'LIMIT_FILE_SIZE' ? 413 : 400, e.code === 'LIMIT_FILE_SIZE' ? 'El archivo supera 5 MB' : 'Archivo inválido', 'ARCHIVO_INVALIDO'));
});

router.get('/mi-ruta', autenticar, requierePermiso('ruta:leer'), ah(async (req, res) => res.json(await svc.miRuta(req))));
router.get('/mi-ruta/resumen', autenticar, requierePermiso('ruta:leer'), ah(async (req, res) => res.json(await svc.resumenJornada(req))));
router.get('/historial', autenticar, requierePermiso('ruta:leer'), ah(async (req, res) => res.json(await svc.historial(req, req.query))));
router.get('/:id(\\d+)', autenticar, requierePermiso('ruta:leer'), ah(async (req, res) => res.json(await svc.detalle(req, Number(req.params.id)))));
router.patch('/:id(\\d+)', autenticar, requierePermiso('entregas:registrar'), conArchivos, ah(async (req, res) => {
  res.json(await svc.cerrar(req, Number(req.params.id), req.body ?? {}, req.files?.foto?.[0] ?? null, req.files?.firma?.[0] ?? null));
}));

// PI-05: Bodega o Administrador reingresan un rechazo (devuelve el stock y deja el pedido listo para reasignar).
router.post('/:id(\\d+)/reingresar', autenticar, requierePermiso('entregas:reingresar'), ah(async (req, res) => res.json(await svc.reingresar(req, Number(req.params.id)))));

export default router;
