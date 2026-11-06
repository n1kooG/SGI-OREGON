import { Router } from 'express';
import { query } from '../db.js';
import { autenticar, requierePermiso } from '../middleware/auth.js';

const router = Router();

// GET /api/auditoria?limite=50  (CU-07): Fecha, Usuario, Rol, Acción, Módulo, IP de origen.
router.get('/', autenticar, requierePermiso('auditoria:leer'), async (req, res) => {
  const limite = Math.min(Number(req.query.limite) || 50, 200);
  const { rows } = await query(
    `SELECT a.id_log, a.fecha_hora, u.nombre_completo AS usuario, r.nombre_rol AS rol,
            a.accion, a.tabla_afectada AS modulo, host(a.ip_origen) AS ip_origen, a.valores_nuevos AS detalle
       FROM audit_log a
       LEFT JOIN usuario u ON u.id_usuario = a.id_usuario
       LEFT JOIN rol r ON r.id_rol = u.id_rol
      ORDER BY a.fecha_hora DESC, a.id_log DESC LIMIT $1`,
    [limite],
  );
  res.json(rows);
});

export default router;
