import { Router } from 'express';
import { ah, AppError } from '../errors.js';
import { autenticar, requierePermiso } from '../middleware/auth.js';
import * as svc from '../services/pedidos.js';
import * as imp from '../services/importaciones.js';
import { plantilla } from '../excel.js';
import multer from 'multer';

const router = Router();

// GET /api/pedidos?estado=PENDIENTE_PREPARACION  (CU-06 supervisión / HU05 lista de picking)
router.get('/', autenticar, requierePermiso('pedidos:leer', 'pedidos:preparar'), ah(async (req, res) => {
  res.json(await svc.listar(req.query.estado ? String(req.query.estado) : null));
}));

// HU04 / CU-05: importación masiva de ventas desde .xlsx (permiso pedidos:importar). Campos multipart: `archivo` (.xlsx) y `canal`.
const subida = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, f, cb) => (/\.xlsx$/i.test(f.originalname) ? cb(null, true) : cb(new AppError(400, 'Solo se aceptan archivos .xlsx', 'ARCHIVO_INVALIDO'))),
});
const conArchivo = (req, res, next) => subida.single('archivo')(req, res, (e) => {
  if (!e) return req.file ? next() : next(new AppError(400, 'Falta el archivo .xlsx (campo archivo)', 'ARCHIVO_INVALIDO'));
  next(e instanceof AppError ? e : new AppError(e.code === 'LIMIT_FILE_SIZE' ? 413 : 400, e.code === 'LIMIT_FILE_SIZE' ? 'El archivo supera 10 MB' : 'Archivo inválido', 'ARCHIVO_INVALIDO'));
});
const importar = requierePermiso('pedidos:importar');

router.get('/importaciones/plantilla', autenticar, importar, ah(async (_req, res) => {
  res.set('Content-Disposition', 'attachment; filename="plantilla_ventas.xlsx"');
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(await plantilla());
}));
router.post('/importaciones/simular', autenticar, importar, conArchivo, ah(async (req, res) => {
  res.json(await imp.simular(req.file.buffer, req.file.originalname, req.body?.canal));
}));
router.post('/importaciones', autenticar, importar, conArchivo, ah(async (req, res) => {
  res.status(201).json(await imp.importar(req, req.file.buffer, req.file.originalname, req.body?.canal));
}));
// TODO(HU05): PATCH /api/pedidos/:id/estado  (pedidos:preparar; el trigger valida el flujo de estados)
// TODO(HU07): GET /api/despachos/mi-ruta y PATCH /api/despachos/:id (ruta:leer, entregas:registrar)

export default router;
