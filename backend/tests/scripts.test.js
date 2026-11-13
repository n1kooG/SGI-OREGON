// scripts/arranque-produccion.mjs y scripts/clave-usuario.mjs contra una base vacía temporal (solo db/01_modelo_datos.sql).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const NOMBRE = `sgi_scripts_${process.pid}_${Date.now().toString(36)}`;
const urlBase = new URL(process.env.DATABASE_URL);
const urlDe = (bd) => { const u = new URL(urlBase); u.pathname = `/${bd}`; return u.toString(); };
const CLAVE = 'Clave-Inicial-Segura-1';
const ADMIN = { ADMIN_EMAIL: 'Jefatura@Tienda.cl', ADMIN_RUT: '12.345.678-5', ADMIN_NOMBRE: 'Jefatura' };
let temporal, motivoSkip;

const correr = (script, args, env, stdin = '') => spawnSync(process.execPath, [`scripts/${script}`, ...args], {
  env: { PATH: process.env.PATH, DATABASE_URL_MIGRACION: urlDe(NOMBRE), ...env }, input: stdin, encoding: 'utf8',
});
const q = (sql, p) => temporal.query(sql, p).then((r) => r.rows);

before(async () => {
  const admin = new pg.Client({ connectionString: urlDe('postgres') });
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE ${NOMBRE}`);
  } catch (e) { motivoSkip = `no se pudo crear la base temporal: ${e.message}`; return; } finally { await admin.end().catch(() => {}); }
  temporal = new pg.Client({ connectionString: urlDe(NOMBRE) });
  await temporal.connect();
  await temporal.query(await readFile(new URL('../../db/01_modelo_datos.sql', import.meta.url), 'utf8'));
});
after(async () => {
  await temporal?.end();
  if (motivoSkip) return;
  const admin = new pg.Client({ connectionString: urlDe('postgres') });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${NOMBRE} WITH (FORCE)`);
  await admin.end();
});
const t = (nombre, fn) => test(nombre, (ctx) => (motivoSkip ? ctx.skip(motivoSkip) : fn(ctx)));

t('arranque: rechaza claves que no cumplen la política y no toca la base', async () => {
  for (const clave of ['corta', 'Demo-Oregon-2026', 'a'.repeat(73)]) {
    const r = correr('arranque-produccion.mjs', [], ADMIN, clave);
    assert.equal(r.status, 1, r.stderr);
  }
  assert.equal(correr('arranque-produccion.mjs', [], { ...ADMIN, ADMIN_RUT: '11.111.111-9' }, CLAVE).status, 1);
  assert.equal(correr('arranque-produccion.mjs', [], {}, CLAVE).status, 1); // sin correo ni RUT
  assert.equal((await q(`SELECT count(*)::int n FROM rol`))[0].n, 0);
  assert.equal((await q(`SELECT count(*)::int n FROM usuario`))[0].n, 0);
});

t('arranque: crea los 3 roles con los permisos de la fuente única y el primer administrador', async () => {
  const r = correr('arranque-produccion.mjs', [], ADMIN, `${CLAVE}\n`);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!r.stdout.includes(CLAVE) && !r.stderr.includes(CLAVE));
  const roles = await q(`SELECT nombre_rol, permisos FROM rol ORDER BY nombre_rol`);
  assert.deepEqual(roles.map((x) => x.nombre_rol), ['ADMINISTRADOR', 'BODEGA', 'CHOFER']);
  // Los permisos coinciden con los que carga el seed de desarrollo (misma fuente: db/roles_permisos.sql).
  const sql = await readFile(new URL('../../db/roles_permisos.sql', import.meta.url), 'utf8');
  const esperado = [...sql.matchAll(/\('([A-Z]+)',\s*'[^']*',\s*'(\[[^']*\])'\)/g)].map((m) => [m[1], JSON.parse(m[2])]);
  assert.equal(esperado.length, 3);
  for (const [nombre, permisos] of esperado) assert.deepEqual(roles.find((x) => x.nombre_rol === nombre).permisos, permisos);
  assert.ok(roles.find((x) => x.nombre_rol === 'ADMINISTRADOR').permisos.includes('usuarios:administrar'));

  const [u] = await q(`SELECT email, rut, activo, left(password_hash, 7) AS pref, password_hash = crypt($1, password_hash) AS ok, r.nombre_rol
                         FROM usuario u JOIN rol r USING (id_rol)`, [CLAVE]);
  assert.deepEqual(u, { email: 'Jefatura@Tienda.cl', rut: '12.345.678-5', activo: true, pref: '$2a$12$', ok: true, nombre_rol: 'ADMINISTRADOR' });
  const [a] = await q(`SELECT * FROM audit_log WHERE accion = 'ADMIN_INICIAL_CREADO'`);
  assert.ok(a && !JSON.stringify(a).includes(CLAVE) && !JSON.stringify(a).includes('$2a$'));
});

t('arranque: con un administrador existente se niega y no cambia nada', async () => {
  const antes = await q(`SELECT count(*)::int n, max(password_hash) h FROM usuario`);
  const r = correr('arranque-produccion.mjs', [], { ...ADMIN, ADMIN_EMAIL: 'otro@tienda.cl', ADMIN_RUT: '11.111.111-1' }, 'Otra-Clave-Distinta-9');
  assert.equal(r.status, 3);
  assert.match(r.stderr, /Ya existe un administrador/);
  assert.deepEqual(await q(`SELECT count(*)::int n, max(password_hash) h FROM usuario`), antes);
});

t('clave-usuario: restablece la clave por stdin o variable, reinicia el bloqueo y audita sin la clave', async () => {
  await q(`UPDATE usuario SET intentos_fallidos = 5, bloqueado_hasta = now() + interval '10 minutes'`);
  const nueva = 'Otra-Clave-Valida-42';
  const r = correr('clave-usuario.mjs', ['jefatura@tienda.cl'], {}, nueva);
  assert.equal(r.status, 0, r.stderr);
  const [u] = await q(`SELECT intentos_fallidos, bloqueado_hasta, password_hash = crypt($1, password_hash) AS ok, password_hash = crypt($2, password_hash) AS vieja FROM usuario`, [nueva, CLAVE]);
  assert.deepEqual(u, { intentos_fallidos: 0, bloqueado_hasta: null, ok: true, vieja: false });
  assert.ok((await q(`SELECT clave_cambiada_en FROM usuario`))[0].clave_cambiada_en); // revoca los tokens anteriores
  const [a] = await q(`SELECT * FROM audit_log WHERE accion = 'CLAVE_RESTABLECIDA'`);
  assert.ok(a && !JSON.stringify(a).includes(nueva));
  const porEnv = correr('clave-usuario.mjs', ['jefatura@tienda.cl'], { CLAVE_NUEVA: CLAVE });
  assert.equal(porEnv.status, 0, porEnv.stderr);
  assert.equal((await q(`SELECT password_hash = crypt($1, password_hash) AS ok FROM usuario`, [CLAVE]))[0].ok, true);
});

t('clave-usuario: clave débil, correo inexistente o sin clave fallan sin cambiar nada', async () => {
  const hash = (await q(`SELECT password_hash FROM usuario`))[0].password_hash;
  assert.equal(correr('clave-usuario.mjs', ['jefatura@tienda.cl'], {}, 'corta').status, 1);
  assert.equal(correr('clave-usuario.mjs', ['nadie@tienda.cl'], {}, 'Clave-Valida-Larga-5').status, 2);
  assert.equal(correr('clave-usuario.mjs', [], {}, 'Clave-Valida-Larga-5').status, 1);
  assert.equal((await q(`SELECT password_hash FROM usuario`))[0].password_hash, hash);
});
