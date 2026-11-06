import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db.js';
import { auditar } from '../audit.js';

// 1) Valida firma y vencimiento del JWT en CADA petición.
// 2) El rol y los permisos se leen de la base de datos (no del token): si el Administrador cambia
//    un rol o desactiva una cuenta, el efecto es inmediato (M10).
export async function autenticar(req, res, next) {
  const h = req.headers.authorization ?? '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  try {
    const { sub } = jwt.verify(token, config.jwtSecret);
    const { rows } = await query(
      `SELECT u.id_usuario, u.nombre_completo, u.email, r.nombre_rol AS rol, r.permisos
         FROM usuario u JOIN rol r ON r.id_rol = u.id_rol
        WHERE u.id_usuario = $1 AND u.activo`,
      [sub],
    );
    if (!rows.length) return res.status(401).json({ error: 'Sesión inválida' });
    req.usuario = rows[0];
    next();
  } catch {
    res.status(401).json({ error: 'Sesión inválida o expirada' });
  }
}

// Denegación por defecto (M3): basta con tener AL MENOS uno de los permisos indicados.
export const requierePermiso = (...permisos) => async (req, res, next) => {
  if (permisos.some((p) => req.usuario.permisos.includes(p))) return next();
  await auditar(req, {
    idUsuario: req.usuario.id_usuario,
    tabla: 'api',
    accion: 'ACCESO_DENEGADO',
    despues: { ruta: req.originalUrl, metodo: req.method, requiere: permisos },
  });
  res.status(403).json({ error: 'No tienes permiso para esta operación' });
};

export const tiene = (req, permiso) => req.usuario.permisos.includes(permiso);
