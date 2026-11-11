import { Router } from 'express';
import { ah } from '../errors.js';
import { autenticar, requierePermiso, tiene } from '../middleware/auth.js';
import { auditar } from '../audit.js';
import * as svc from '../services/reportes.js';

const router = Router();

// GET /api/reportes/gestion/exportar?formato=xlsx|pdf&periodo=semana|mes|anio  (HU10, T41/T42). La exportación queda auditada.
// Costos y márgenes solo salen para quien tiene `costos:leer`.
router.get('/gestion/exportar', autenticar, requierePermiso('reportes:leer'), ah(async (req, res) => {
  const { buffer, tipo, nombre, formato, periodo } = await svc.exportarGestion(req.query, req.usuario.nombre_completo, tiene(req, 'costos:leer'));
  await auditar(req, { idUsuario: req.usuario.id_usuario, tabla: 'audit_log', accion: 'EXPORTACIÓN', despues: { reporte: 'gestion', formato, periodo } });
  res.set({ 'Content-Type': tipo, 'Content-Disposition': `attachment; filename="${nombre}"` }).send(buffer);
}));

export default router;
