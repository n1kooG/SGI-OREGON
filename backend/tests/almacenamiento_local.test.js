// Almacenamiento de etiquetas: con S3 desactivado usa disco y la clave nunca puede salir del directorio.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = await mkdtemp(join(tmpdir(), 'etq-'));
process.env.ETIQUETAS_DIR = dir;
process.env.STORAGE_ENABLED = 'false';
const { guardarArchivo, leerArchivo, borrarArchivo, almacenamientoActivo } = await import('../src/storage.js');
after(() => rm(dir, { recursive: true, force: true }));

const leer = async (s) => { const partes = []; for await (const p of s) partes.push(p); return Buffer.concat(partes); };

test('sin S3 guarda, lee y borra en el directorio local', async () => {
  assert.equal(almacenamientoActivo(), false);
  await guardarArchivo('etiquetas/42.pdf', Buffer.from('%PDF-1.4 hola'));
  assert.deepEqual(await readdir(dir), ['42.pdf']);
  assert.equal((await leer(await leerArchivo('etiquetas/42.pdf'))).toString(), '%PDF-1.4 hola');
  await guardarArchivo('etiquetas/42.pdf', Buffer.from('%PDF-otro')); // reemplaza
  assert.equal((await readFile(join(dir, '42.pdf'))).toString(), '%PDF-otro');
  await borrarArchivo('etiquetas/42.pdf');
  assert.deepEqual(await readdir(dir), []);
  await borrarArchivo('etiquetas/42.pdf'); // borrar lo inexistente no falla
});

test('claves con rutas o texto libre no escapan del directorio', async () => {
  for (const mala of ['etiquetas/../../x.pdf', '../etiquetas/1.pdf', 'etiquetas/1.pdf/../../a', '/etc/passwd', 'etiquetas/a.pdf', 'etiquetas/1.pdf\u0000.x', 'otra/1.pdf']) {
    await assert.rejects(guardarArchivo(mala, Buffer.from('x')), /no permitida/);
    await assert.rejects(leerArchivo(mala), /no permitida/);
    await assert.rejects(borrarArchivo(mala), /no permitida/);
  }
  assert.deepEqual(await readdir(dir), []);
});
