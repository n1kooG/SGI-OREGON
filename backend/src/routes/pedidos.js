import { Router } from 'express';
import { ah, AppError } from '../errors.js';
import { autenticar, requierePermiso } from '../middleware/auth.js';
import * as svc from '../services/pedidos.js';
import * as imp from '../services/importaciones.js';
import * as etq from '../services/etiquetas.js';
import { plantilla } from '../excel.js';
import multer from 'multer';

const router = Router();

// GET /api/pedidos?estado=&canal=&pagina=&limite=  (CU-06 supervisión / HU05 lista de picking). Cuerpo = arreglo; el total va en X-Total-Count.
router.get('/', autenticar, requierePermiso('pedidos:leer', 'pedidos:preparar'), ah(async (req, res) => {
  const { filas, total } = await svc.listar(req, { estado: req.query.estado && String(req.query.estado), canal: req.query.canal, por_reingresar: req.query.por_reingresar, pagina: req.query.pagina, limite: req.query.limite });
  res.set('X-Total-Count', String(total)).json(filas);
}));

// HU04 / CU-05: importación masiva de ventas desde .xlsx (permiso pedidos:importar). Campos multipart: `archivo` (.xlsx) y `canal`.
const subida = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 10, parts: 12 },
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

// Etiquetas PDF exportadas del marketplace. El tope por archivo es holgado a propósito: los PDF de más de 2 MB se informan como INVALIDO en el lote sin abortarlo.
const subidaPdf = multer({ storage: multer.memoryStorage(), limits: { fileSize: 3 * 1024 * 1024, files: etq.MAX_ARCHIVOS, fields: 5, parts: etq.MAX_ARCHIVOS + 10 } });
const conPdf = (campo, varios) => (req, res, next) => (varios ? subidaPdf.array(campo, etq.MAX_ARCHIVOS) : subidaPdf.single(campo))(req, res, (e) => {
  if (!e) return next();
  const grande = e.code === 'LIMIT_FILE_SIZE';
  next(e instanceof AppError ? e : new AppError(grande ? 413 : 400, grande ? 'Un archivo supera el tamaño máximo' : e.code === 'LIMIT_FILE_COUNT' || e.code === 'LIMIT_UNEXPECTED_FILE' ? `Máximo ${etq.MAX_ARCHIVOS} archivos por solicitud` : 'Archivos inválidos', 'ARCHIVO_INVALIDO'));
});
const etiquetas = requierePermiso('pedidos:etiquetas');
router.post('/etiquetas', autenticar, etiquetas, conPdf('archivos', true), ah(async (req, res) => res.json(await etq.importar(req, req.files))));

// HU05 / CU-10 (Bodega) y CU-06 (Administrador). `:id` numérico para no chocar con /importaciones/*.
const id = (req) => Number(req.params.id);
const ver = requierePermiso('pedidos:leer', 'pedidos:preparar');
const preparar = requierePermiso('pedidos:preparar');
router.get('/resumen', autenticar, ver, ah(async (_req, res) => res.json(await svc.resumen())));
router.get('/:id(\\d+)', autenticar, ver, ah(async (req, res) => res.json(await svc.detalle(req, id(req)))));
router.patch('/:id(\\d+)/estado', autenticar, preparar, ah(async (req, res) => res.json(await svc.cambiarEstado(req, id(req), req.body?.estado))));
router.post('/:id(\\d+)/comentarios', autenticar, preparar, ah(async (req, res) => res.status(201).json(await svc.comentar(req, id(req), req.body ?? {}))));
router.get('/:id(\\d+)/etiqueta', autenticar, ver, ah(async (req, res) => {
  const { pdf, nombre } = await etq.descargar(req, id(req));
  // Archivo de un tercero: siempre descarga (attachment), tipo fijo, sin sniffing y con CSP «sandbox», de modo que ni un PDF
  // con scripts ni una mala configuración del navegador lo ejecuten dentro del origen de la aplicación.
  res.set({
    'Content-Disposition': `attachment; filename="${nombre.replace(/[^\w.-]/g, '_')}"`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cache-Control': 'private, no-store',
  }).type('application/pdf').send(pdf);
}));
router.put('/:id(\\d+)/etiqueta', autenticar, etiquetas, conPdf('archivo', false), ah(async (req, res) => res.json(await etq.asignar(req, id(req), req.file))));
router.delete('/:id(\\d+)/etiqueta', autenticar, etiquetas, ah(async (req, res) => res.json(await etq.quitar(req, id(req)))));
router.patch('/:id(\\d+)/documento', autenticar, requierePermiso('pedidos:documentar'), ah(async (req, res) => res.json(await svc.documentar(req, id(req), req.body?.numero_documento))));
router.post('/:id(\\d+)/asignar-chofer', autenticar, requierePermiso('pedidos:asignar_chofer'), ah(async (req, res) => res.json(await svc.asignarChofer(req, id(req), req.body?.id_chofer))));
router.post('/:id(\\d+)/reprogramar', autenticar, requierePermiso('pedidos:asignar_chofer'), ah(async (req, res) => res.json(await svc.reprogramar(req, id(req), req.body ?? {}))));

export default router;
