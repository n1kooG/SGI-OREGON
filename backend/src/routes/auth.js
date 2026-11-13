import { Router } from 'express';
import { AppError, ah } from '../errors.js';
import { autenticar } from '../middleware/auth.js';
import * as svc from '../services/auth.js';
import { limitarLogin } from '../limiteLogin.js';

const router = Router();

// POST /api/auth/login  { email, password }
router.post('/login', ah(limitarLogin), ah(async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    throw new AppError(400, 'Debes ingresar usuario y contraseña', 'SOLICITUD_INVALIDA');
  }
  // Tope de largo: evita auditar correos de decenas de KB y hashear contraseñas gigantes.
  if (email.length > 254 || password.length > 256) throw new AppError(400, 'Usuario o contraseña demasiado largos', 'SOLICITUD_INVALIDA');
  res.json(await svc.login(req, email.trim(), password));
}));

// PUT /api/auth/clave  { actual, nueva }  (el usuario autenticado cambia la suya)
router.put('/clave', autenticar, ah(async (req, res) => {
  const { actual, nueva } = req.body ?? {};
  await svc.cambiarClave(req, actual, nueva);
  res.json({ mensaje: 'Contraseña actualizada' });
}));

router.get('/me', autenticar, (req, res) => {
  const { id_usuario, nombre_completo, email, rol, permisos } = req.usuario;
  res.json({ id: id_usuario, nombre: nombre_completo, email, rol, permisos });
});

export default router;
