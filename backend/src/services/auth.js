import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { AppError } from '../errors.js';
import * as repo from '../repositories/usuarios.js';
import { auditar } from '../audit.js';

const MSG_GENERICO = 'Usuario o contraseña incorrectos'; // anti-enumeración (PU-08)
const credencialesInvalidas = () => new AppError(401, MSG_GENERICO, 'CREDENCIALES_INVALIDAS');

// Políticas: bcrypt vía pgcrypto (PU-06/07), mensaje único (PU-08), bloqueo tras N intentos (M11),
// el rol sale siempre de la BD; cualquier rol enviado por el cliente se ignora (CU-01, PI-07).
export async function login(req, email, password) {
  const u = await repo.buscarParaLogin(email, password);

  if (!u) {
    await repo.simularHash(password);
    await auditar(req, { tabla: 'usuario', accion: 'LOGIN_FALLIDO', despues: { email: email.toLowerCase() } });
    throw credencialesInvalidas();
  }
  if (!u.activo) {
    await auditar(req, { idUsuario: u.id_usuario, tabla: 'usuario', accion: 'LOGIN_FALLIDO', despues: { motivo: 'cuenta inactiva' } });
    throw credencialesInvalidas();
  }
  if (u.bloqueada) {
    await auditar(req, { idUsuario: u.id_usuario, tabla: 'usuario', accion: 'CUENTA_BLOQUEADA', despues: { hasta: u.bloqueado_hasta } });
    throw credencialesInvalidas();
  }
  if (!u.clave_ok) {
    const f = await repo.registrarFallo(u.id_usuario, config.maxIntentos, config.bloqueoMinutos);
    await auditar(req, {
      idUsuario: u.id_usuario, tabla: 'usuario', accion: 'LOGIN_FALLIDO',
      despues: { intentos: f.intentos_fallidos, bloqueado_hasta: f.bloqueado_hasta },
    });
    throw credencialesInvalidas();
  }

  await repo.registrarAcceso(u.id_usuario);
  await auditar(req, { idUsuario: u.id_usuario, tabla: 'usuario', accion: 'LOGIN' });
  const token = jwt.sign({ sub: u.id_usuario }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
  return { token, usuario: { id: u.id_usuario, nombre: u.nombre_completo, email: u.email, rol: u.rol, permisos: u.permisos } };
}
