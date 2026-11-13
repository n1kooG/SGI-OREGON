// Restablece la clave de un usuario (administrador de infraestructura). Reinicia el bloqueo por intentos y deja
// el hecho en la bitácora (sin la clave). Uso:
//   printf '%s' "$NUEVA" | node --env-file=.env scripts/clave-usuario.mjs correo@tiendaoregon.cl
//   CLAVE_NUEVA='...' node --env-file=.env scripts/clave-usuario.mjs correo@tiendaoregon.cl
import { errorPoliticaClave } from '../src/politicaClave.js';
import { conectar, leerClave, fallar } from './_comun.mjs';

const email = (process.argv[2] ?? process.env.CORREO ?? '').trim();
if (!email) fallar('Uso: node --env-file=.env scripts/clave-usuario.mjs <correo>  (la clave por stdin o CLAVE_NUEVA)');
const clave = await leerClave('CLAVE_NUEVA');
const motivo = errorPoliticaClave(clave);
if (motivo) fallar(motivo);

const db = await conectar();
try {
  await db.query('BEGIN');
  const { rows: [u] } = await db.query(
    `UPDATE usuario SET password_hash = crypt($2, gen_salt('bf', 12)), intentos_fallidos = 0, bloqueado_hasta = NULL, clave_cambiada_en = now()
      WHERE lower(email) = lower($1) RETURNING id_usuario`,
    [email, clave],
  );
  if (!u) { await db.query('ROLLBACK'); fallar(`No existe un usuario con el correo ${email}`, 2); }
  await db.query(
    `INSERT INTO audit_log (id_usuario, tabla_afectada, accion, valores_nuevos, ip_origen) VALUES ($1, 'usuario', 'CLAVE_RESTABLECIDA', $2, '127.0.0.1')`,
    [u.id_usuario, { id_usuario: u.id_usuario, via: 'script' }],
  );
  await db.query('COMMIT');
  console.log(`Clave restablecida para ${email}`);
} catch (e) {
  await db.query('ROLLBACK').catch(() => {});
  fallar(e.message);
} finally {
  await db.end();
}
