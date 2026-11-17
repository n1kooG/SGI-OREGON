// El backend sirve la PWA compilada (despliegue de una sola plataforma) sin pisar /api.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from '../src/config.js';
import { crearApp } from '../src/app.js';

let server, base;
before(() => {
  const dist = mkdtempSync(join(tmpdir(), 'dist-'));
  mkdirSync(join(dist, 'assets'));
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>SGI</title>');
  writeFileSync(join(dist, 'assets', 'app-abc.js'), 'x');
  config.frontendDist = dist;
  server = crearApp().listen(0);
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

test('/ y una ruta del navegador devuelven index.html sin caché; los assets con hash se cachean', async () => {
  for (const ruta of ['/', '/bodega-estructura']) {
    const r = await fetch(base + ruta);
    assert.equal(r.status, 200);
    assert.match(await r.text(), /<title>SGI/);
    assert.equal(r.headers.get('cache-control'), 'no-cache');
  }
  const a = await fetch(base + '/assets/app-abc.js');
  assert.equal(a.status, 200);
  assert.match(a.headers.get('cache-control'), /immutable/);
});

test('/api desconocido sigue respondiendo JSON 404, no el HTML', async () => {
  const r = await fetch(base + '/api/no-existe');
  assert.equal(r.status, 404);
  assert.match(r.headers.get('content-type'), /json/);
});
