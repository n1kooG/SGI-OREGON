import { Router } from 'express';
import { ah } from '../errors.js';
import { autenticar, requierePermiso } from '../middleware/auth.js';
import { auditar } from '../audit.js';
import * as svc from '../services/auditoria.js';

const router = Router();

// GET /api/auditoria?usuario=&accion=&desde=&hasta=&pagina=&limite=  (CU-07, T51)
// Fecha, Usuario, Rol, Acción, Módulo, IP de origen. Cuerpo = arreglo (compatible); el total va en X-Total-Count.
router.get('/', autenticar, requierePermiso('auditoria:leer'), ah(async (req, res) => {
  const { items, total } = await svc.listar(req.query);
  res.set('X-Total-Count', String(total)).json(items);
}));

// GET /api/auditoria/exportar?formato=xlsx|pdf + los mismos filtros (T42). La exportación queda auditada.
router.get('/exportar', autenticar, requierePermiso('auditoria:leer'), ah(async (req, res) => {
  const { buffer, tipo, nombre, filas } = await svc.exportar(req.query);
  await auditar(req, { idUsuario: req.usuario.id_usuario, tabla: 'audit_log', accion: 'EXPORTACIÓN', despues: { formato: req.query.formato, filtros: svc.filtros(req.query), filas } });
  res.set({ 'Content-Type': tipo, 'Content-Disposition': `attachment; filename="${nombre}"` }).send(buffer);
}));

export default router;
