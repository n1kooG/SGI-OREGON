// Mínimos privilegios: conectado como el rol de la aplicación (db/07_rol_aplicacion.sql) la bitácora no se puede
// alterar ni desactivar y el flujo normal sigue funcionando. Se omite si TEST_APP_DATABASE_URL no está definida:
//   TEST_APP_DATABASE_URL=postgres://sgi_app:CLAVE@localhost:5432/sgi_oregon_pruebas npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

const url = process.env.TEST_APP_DATABASE_URL;
const opts = { skip: url ? false : 'TEST_APP_DATABASE_URL no definida' };
let c;

before(async () => { if (url) { c = new pg.Client({ connectionString: url }); await c.connect(); } });
after(async () => { await c?.end(); });

// Cada intento va dentro de una transacción que se revierte: no deja rastro aunque algo se permitiera.
async function intentar(sql, params = []) {
  await c.query('BEGIN');
  try { return await c.query(sql, params); } finally { await c.query('ROLLBACK'); }
}
const denegado = (sql) => assert.rejects(() => intentar(sql), { code: '42501' });

test('el rol de aplicación no es superusuario ni dueño de las tablas', opts, async () => {
  const { rows: [r] } = await c.query(`SELECT rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls AS privilegiado FROM pg_roles WHERE rolname = current_user`);
  assert.equal(r.privilegiado, false);
  const { rows: [d] } = await c.query(`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public' AND tableowner = current_user`);
  assert.equal(d.n, 0);
});

test('audit_log: no se puede desactivar ni quitar el trigger, ni modificar, borrar o truncar', opts, async () => {
  await denegado(`ALTER TABLE audit_log DISABLE TRIGGER ALL`);
  await denegado(`ALTER TABLE audit_log DISABLE TRIGGER trg_audit_log_no_update_delete`);
  await denegado(`DROP TRIGGER trg_audit_log_no_update_delete ON audit_log`);
  await denegado(`DROP TABLE audit_log`);
  await denegado(`CREATE OR REPLACE FUNCTION fn_audit_log_inmutable() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN NEW; END'`);
  await denegado(`UPDATE audit_log SET accion = 'X'`);
  await denegado(`DELETE FROM audit_log`);
  await denegado(`TRUNCATE audit_log`);
});

test('no se puede saltar los triggers con session_replication_role = replica', opts, async () => {
  await denegado(`SET session_replication_role = replica`);
});

test('privilegios efectivos sobre audit_log: solo SELECT e INSERT', opts, async () => {
  const { rows } = await c.query(
    `SELECT p FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p WHERE has_table_privilege(current_user, 'audit_log', p) ORDER BY p`);
  assert.deepEqual(rows.map((r) => r.p), ['INSERT', 'SELECT']);
});

test('usuario: sin DELETE y solo columnas de sesión/estado actualizables', opts, async () => {
  await denegado(`DELETE FROM usuario`);
  await denegado(`UPDATE usuario SET email = 'otro@x.cl'`);
  await denegado(`UPDATE rol SET permisos = '[]'`);
});

test('el flujo normal funciona: login, bitácora, catálogo y cambio de clave', opts, async () => {
  const r = await intentar(
    `WITH a AS (INSERT INTO audit_log (id_usuario, tabla_afectada, accion, ip_origen) VALUES (NULL, 'usuario', 'PRUEBA_ROL', '127.0.0.1') RETURNING 1),
          p AS (INSERT INTO producto (sku, modelo, nombre, marca, costo_adquisicion_neto) VALUES ('ZZ-ROL', 'm', 'n', 'x', 1000) RETURNING sku),
          i AS (INSERT INTO inventario (sku) SELECT sku FROM p RETURNING sku),
          u AS (UPDATE usuario SET password_hash = crypt('otra-clave-larga-2', gen_salt('bf', 12)), intentos_fallidos = 0, bloqueado_hasta = NULL
                 WHERE lower(email) = 'admin@tiendaoregon.cl' RETURNING 1)
     SELECT (SELECT count(*) FROM a) AS a, (SELECT count(*) FROM i) AS i, (SELECT count(*) FROM u) AS u`);
  assert.deepEqual(r.rows[0], { a: '1', i: '1', u: '1' });
});
