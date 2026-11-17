import { Router } from 'express';
import { ah, AppError } from '../errors.js';
import { autenticar, requierePermiso } from '../middleware/auth.js';
import * as svc from '../services/productos.js';
import * as imp from '../services/catalogoImportacion.js';
import multer from 'multer';

const router = Router();

// GET /api/productos?q=&pagina=&limite=  (HU01, HU02, CU-03). Cuerpo = arreglo; el total va en X-Total-Count.
router.get('/', autenticar, requierePermiso('catalogo:leer'), ah(async (req, res) => {
  const { filas, total } = await svc.listar(req.usuario.permisos, req.query);
  res.set('X-Total-Count', String(total)).json(filas);
}));

// Importación masiva del catálogo (.xlsx, campo `archivo`, máx. 5 MB). Declaradas antes de /:sku para no chocar con él.
const subida = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 5, parts: 7 },
  fileFilter: (_req, f, cb) => (/\.xlsx$/i.test(f.originalname) ? cb(null, true) : cb(new AppError(400, 'Solo se aceptan archivos .xlsx', 'ARCHIVO_INVALIDO'))),
});
const conArchivo = (req, res, next) => subida.single('archivo')(req, res, (e) => {
  if (!e) return req.file ? next() : next(new AppError(400, 'Falta el archivo .xlsx (campo archivo)', 'ARCHIVO_INVALIDO'));
  next(e instanceof AppError ? e : new AppError(e.code === 'LIMIT_FILE_SIZE' ? 413 : 400, e.code === 'LIMIT_FILE_SIZE' ? 'El archivo supera 5 MB' : 'Archivo inválido', 'ARCHIVO_INVALIDO'));
});
const escribir = requierePermiso('catalogo:escribir');
router.get('/importacion/plantilla', autenticar, escribir, ah(async (_req, res) => {
  res.set('Content-Disposition', 'attachment; filename="plantilla_catalogo.xlsx"');
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(await imp.plantilla());
}));
router.post('/importacion/simular', autenticar, escribir, conArchivo, ah(async (req, res) => {
  res.json(await imp.simular(req.file.buffer, req.file.originalname));
}));
router.post('/importacion', autenticar, escribir, conArchivo, ah(async (req, res) => {
  res.status(201).json(await imp.aplicar(req, req.file.buffer, req.file.originalname));
}));

router.get('/:sku', autenticar, requierePermiso('catalogo:leer'), ah(async (req, res) => {
  res.json(await svc.obtener(req.usuario.permisos, req.params.sku));
}));

router.post('/', autenticar, requierePermiso('catalogo:escribir'), ah(async (req, res) => {
  res.status(201).json(await svc.crear(req, req.body));
}));

// Edita datos y estado (ACTIVO/INACTIVO); el SKU es inmutable.
router.put('/:sku', autenticar, requierePermiso('catalogo:escribir'), ah(async (req, res) => {
  res.json(await svc.editar(req, req.params.sku, req.body));
}));

// Solo precio por canal: el margen lo calcula la BD (HU02).
router.put('/:sku/precios/:canal', autenticar, requierePermiso('precios:escribir'), ah(async (req, res) => {
  res.json(await svc.fijarPrecio(req, req.params.sku, req.params.canal, req.body));
}));

export default router;
