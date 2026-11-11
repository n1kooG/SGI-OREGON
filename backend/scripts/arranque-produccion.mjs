// Arranque de una base de producción vacía, sin datos de ejemplo: crea los roles de negocio con sus permisos
// (db/roles_permisos.sql, la misma fuente que 02_datos_ejemplo.sql) y el primer administrador.
// Se niega a correr si ya existe un administrador. Requiere haber cargado db/01_modelo_datos.sql. Uso:
//   ADMIN_EMAIL=jefatura@tienda.cl ADMIN_RUT=12.345.678-5 ADMIN_NOMBRE='Jefatura' \
//     printf '%s' "$CLAVE" | node --env-file=.env scripts/arranque-produccion.mjs
// La clave por stdin o ADMIN_CLAVE (nunca por argumento). No hay marca de «cambio obligatorio»: tras el primer
// ingreso el administrador debe rotarla con PUT /api/auth/clave o scripts/clave-usuario.mjs.
import { readFile } from 'node:fs/promises';
import { errorPoliticaClave } from '../src/politicaClave.js';
import { conectar, leerClave, fallar } from './_comun.mjs';

const email = (process.env.ADMIN_EMAIL ?? '').trim();
const rut = (process.env.ADMIN_RUT ?? '').trim();
const nombre = (process.env.ADMIN_NOMBRE ?? 'Administrador').trim();
if (!email || !rut) fallar('Define ADMIN_EMAIL y ADMIN_RUT (y opcionalmente ADMIN_NOMBRE); la clave por stdin o ADMIN_CLAVE');
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 120) fallar('ADMIN_EMAIL inválido');
if (!nombre || nombre.length > 120) fallar('ADMIN_NOMBRE vacío o demasiado largo (máximo 120 caracteres)');
const clave = await leerClave('ADMIN_CLAVE');
const motivo = errorPoliticaClave(clave);
if (motivo) fallar(motivo);

const sqlRoles = await readFile(new URL('../../db/roles_permisos.sql', import.meta.url), 'utf8');
const db = await conectar();
try {
  await db.query('BEGIN');
  await db.query(`SELECT pg_advisory_xact_lock(hashtext('sgi_arranque_produccion'))`); // dos ejecuciones simultáneas no pasan juntas
  const { rows: [{ ya }] } = await db.query(
    `SELECT EXISTS (SELECT 1 FROM usuario u JOIN rol r ON r.id_rol = u.id_rol WHERE r.permisos ? 'usuarios:administrar') AS ya`);
  if (ya) { await db.query('ROLLBACK'); fallar('Ya existe un administrador: no se hace nada. Para cambiar su clave usa scripts/clave-usuario.mjs', 3); }
  const { rows: [{ ok }] } = await db.query(`SELECT fn_rut_valido($1) AS ok`, [rut]);
  if (!ok) { await db.query('ROLLBACK'); fallar('ADMIN_RUT inválido (formato 12.345.678-5 con dígito verificador correcto)'); }

  await db.query(sqlRoles);
  const { rows: [u] } = await db.query(
    `INSERT INTO usuario (rut, nombre_completo, email, password_hash, id_rol)
     VALUES ($1, $2, $3, crypt($4, gen_salt('bf', 12)), (SELECT id_rol FROM rol WHERE nombre_rol = 'ADMINISTRADOR')) RETURNING id_usuario`,
    [rut, nombre, email, clave],
  );
  await db.query(
    `INSERT INTO audit_log (id_usuario, tabla_afectada, accion, valores_nuevos, ip_origen) VALUES ($1, 'usuario', 'ADMIN_INICIAL_CREADO', $2, '127.0.0.1')`,
    [u.id_usuario, { id_usuario: u.id_usuario, email: email.toLowerCase(), via: 'arranque-produccion' }],
  );
  await db.query('COMMIT');
  console.log(`Roles creados y administrador inicial ${email} registrado. Rota su clave tras el primer ingreso.`);
} catch (e) {
  await db.query('ROLLBACK').catch(() => {});
  fallar(e.code === '23505' ? 'Ya existe un usuario con ese correo o RUT' : e.message);
} finally {
  await db.end();
}
