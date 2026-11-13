// Arranque seguro: en producción se rechaza un JWT_SECRET débil o el de ejemplo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const cargar = (env) => spawnSync(process.execPath, ['--input-type=module', '-e', "import './src/config.js'"], {
  env: { PATH: process.env.PATH, ...env }, encoding: 'utf8',
});
const FUERTE = 'f'.repeat(16) + 'a1b2c3d4e5f60718' + 'z'.repeat(16);

test('producción: rechaza el secreto de ejemplo del .env.example', () => {
  const r = cargar({ NODE_ENV: 'production', JWT_SECRET: 'cambia-esto-por-un-secreto-largo-y-aleatorio' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /JWT_SECRET débil/);
});

test('producción: rechaza un secreto corto (menos de 32 caracteres)', () => {
  const r = cargar({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(31) });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /JWT_SECRET débil/);
});

test('producción: acepta un secreto largo y distinto del ejemplo', () => {
  assert.equal(cargar({ NODE_ENV: 'production', JWT_SECRET: FUERTE, CORS_ORIGIN: 'https://app.tiendaoregon.cl' }).status, 0);
});

test('desarrollo: el secreto de ejemplo sigue permitido', () => {
  assert.equal(cargar({ JWT_SECRET: 'cambia-esto-por-un-secreto-largo-y-aleatorio' }).status, 0);
});

test('producción: exige CORS_ORIGIN explícito y sin comodines', () => {
  const base = { NODE_ENV: 'production', JWT_SECRET: FUERTE };
  assert.match(cargar(base).stderr, /CORS_ORIGIN/);
  assert.match(cargar({ ...base, CORS_ORIGIN: '*' }).stderr, /CORS_ORIGIN/);
  assert.equal(cargar({ ...base, CORS_ORIGIN: 'https://app.tiendaoregon.cl' }).status, 0);
});

test('TRUST_PROXY: acepta número de saltos o lista; «true» se rechaza (permitiría falsificar la IP)', () => {
  const base = { JWT_SECRET: FUERTE };
  assert.equal(cargar({ ...base, TRUST_PROXY: '1' }).status, 0);
  assert.equal(cargar({ ...base, TRUST_PROXY: 'loopback, 10.0.0.0/8' }).status, 0);
  const r = cargar({ ...base, TRUST_PROXY: 'true' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /TRUST_PROXY/);
});
