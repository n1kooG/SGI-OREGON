import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db.js';
import { auditar } from '../audit.js';
import { autenticar } from '../middleware/auth.js';

const router = Router();
const MSG_GENERICO = 'Usuario o contraseña incorrectos'; // anti-enumeración (PU-08)

// POST /api/auth/login  { email, password, rol }
// Políticas: bcrypt vía pgcrypto (PU-06/07), mensaje único (PU-08), bloqueo tras N intentos (M11),
// rol elegido en pantalla solo se compara con el rol real de la BD (CU-01, PI-07).
router.post('/login', async (req, res) => {
  const { email, password, rol } = req.body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    return res.status(400).json({ error: 'Debes ingresar usuario y contraseña' });
  }

  const { rows } = await query(
    `SELECT u.id_usuario, u.nombre_completo, u.email, u.activo, u.intentos_fallidos, u.bloqueado_hasta,
            r.nombre_rol AS rol, r.permisos,
            (u.password_hash = crypt($2, u.password_hash)) AS clave_ok,
            (u.bloqueado_hasta IS NOT NULL AND u.bloqueado_hasta > now()) AS bloqueada
       FROM usuario u JOIN rol r ON r.id_rol = u.id_rol
      WHERE lower(u.email) = lower($1)`,
    [email.trim(), password],
  );
  const u = rows[0];

  if (!u) {
    await query(`SELECT crypt($1, gen_salt('bf', 12))`, [password]); // iguala tiempos de respuesta
    await auditar(req, { tabla: 'usuario', accion: 'LOGIN_FALLIDO', despues: { email: email.trim().toLowerCase() } });
    return res.status(401).json({ error: MSG_GENERICO });
  }

  if (!u.activo) {
    await auditar(req, { idUsuario: u.id_usuario, tabla: 'usuario', accion: 'LOGIN_FALLIDO', despues: { motivo: 'cuenta inactiva' } });
    return res.status(401).json({ error: MSG_GENERICO });
  }

  if (u.bloqueada) {
    await auditar(req, { idUsuario: u.id_usuario, tabla: 'usuario', accion: 'CUENTA_BLOQUEADA', despues: { hasta: u.bloqueado_hasta } });
    return res.status(401).json({ error: MSG_GENERICO });
  }

  if (!u.clave_ok) {
    const { rows: [f] } = await query(
      `UPDATE usuario
          SET intentos_fallidos = intentos_fallidos + 1,
              bloqueado_hasta = CASE WHEN intentos_fallidos + 1 >= $2
                                     THEN now() + make_interval(mins => $3) ELSE bloqueado_hasta END
        WHERE id_usuario = $1
        RETURNING intentos_fallidos, bloqueado_hasta`,
      [u.id_usuario, config.maxIntentos, config.bloqueoMinutos],
    );
    await auditar(req, {
      idUsuario: u.id_usuario, tabla: 'usuario', accion: 'LOGIN_FALLIDO',
      despues: { intentos: f.intentos_fallidos, bloqueado_hasta: f.bloqueado_hasta },
    });
    return res.status(401).json({ error: MSG_GENERICO });
  }

  // El rol seleccionado en la pantalla solo decide a qué interfaz se redirige.
  if (rol && rol !== u.rol) {
    await auditar(req, { idUsuario: u.id_usuario, tabla: 'usuario', accion: 'ACCESO_DENEGADO', despues: { rol_elegido: rol, rol_real: u.rol } });
    return res.status(403).json({ error: 'El rol seleccionado no corresponde a tu cuenta' });
  }

  await query(
    `UPDATE usuario SET intentos_fallidos = 0, bloqueado_hasta = NULL, ultimo_acceso = now() WHERE id_usuario = $1`,
    [u.id_usuario],
  );
  await auditar(req, { idUsuario: u.id_usuario, tabla: 'usuario', accion: 'LOGIN' });

  const token = jwt.sign({ sub: u.id_usuario }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
  res.json({
    token,
    usuario: { id: u.id_usuario, nombre: u.nombre_completo, email: u.email, rol: u.rol, permisos: u.permisos },
  });
});

router.get('/me', autenticar, (req, res) => {
  const { id_usuario, nombre_completo, email, rol, permisos } = req.usuario;
  res.json({ id: id_usuario, nombre: nombre_completo, email, rol, permisos });
});

export default router;
