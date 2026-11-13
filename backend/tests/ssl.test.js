// Conexión a la base con TLS verificado (hallazgo 21): DB_SSL=true valida el certificado; DB_SSL_CA aporta la CA de RDS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { opcionesSsl } from '../src/ssl.js';

const dir = mkdtempSync(join(tmpdir(), 'ssl-'));

test('sin DB_SSL no hay TLS (desarrollo local)', () => {
  assert.equal(opcionesSsl({}), false);
  assert.equal(opcionesSsl({ DB_SSL: 'false', DB_SSL_CA: '/no/existe' }), false);
});

test('DB_SSL=true sin CA usa el almacén del sistema pero siempre valida', () => {
  assert.deepEqual(opcionesSsl({ DB_SSL: 'true' }), { rejectUnauthorized: true });
});

test('DB_SSL_CA se carga como CA y la validación sigue activa', () => {
  const pem = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n';
  const ruta = join(dir, 'ca.pem');
  writeFileSync(ruta, pem);
  assert.deepEqual(opcionesSsl({ DB_SSL: 'true', DB_SSL_CA: ruta }), { ca: pem, rejectUnauthorized: true });
});

test('CA ausente o que no es PEM: falla al arrancar, nunca degrada a sin verificar', () => {
  assert.throws(() => opcionesSsl({ DB_SSL: 'true', DB_SSL_CA: join(dir, 'nada.pem') }), /DB_SSL_CA/);
  const mala = join(dir, 'mala.pem');
  writeFileSync(mala, 'hola');
  assert.throws(() => opcionesSsl({ DB_SSL: 'true', DB_SSL_CA: mala }), /PEM/);
});
