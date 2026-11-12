// Almacenamiento S3 (T45): listo pero sin uso funcional. Con STORAGE_ENABLED=false no se crea cliente ni se llama a AWS.
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from './config.js';

let s3 = null;
const cliente = () => (s3 ??= new S3Client({ region: config.s3Region })); // credenciales: cadena estándar de AWS

export const almacenamientoActivo = () => config.storageEnabled && !!config.s3Bucket;

function exigirActivo() {
  if (!almacenamientoActivo()) throw new Error('Almacenamiento desactivado (STORAGE_ENABLED / S3_BUCKET)');
}

export async function subir(clave, cuerpo, contentType = 'application/octet-stream') {
  exigirActivo();
  await cliente().send(new PutObjectCommand({ Bucket: config.s3Bucket, Key: clave, Body: cuerpo, ContentType: contentType }));
  return clave;
}

export async function urlFirmada(clave, segundos = 300) {
  exigirActivo();
  return getSignedUrl(cliente(), new GetObjectCommand({ Bucket: config.s3Bucket, Key: clave }), { expiresIn: segundos });
}

// Etiquetas importadas: S3 en producción; sin S3 (desarrollo) disco local. La clave sale siempre de id_orden; el patrón
// estricto impide que un nombre armado con texto del usuario salga del directorio.
const CLAVE_ETIQUETA = /^etiquetas\/(\d{1,10})\.pdf$/;
const rutaLocal = (clave) => {
  const m = CLAVE_ETIQUETA.exec(clave);
  if (!m) throw new Error('Clave de archivo no permitida');
  return join(config.etiquetasDir, `${m[1]}.pdf`);
};

export async function guardarArchivo(clave, cuerpo, contentType = 'application/pdf') {
  if (almacenamientoActivo()) return subir(clave, cuerpo, contentType);
  const ruta = rutaLocal(clave);
  await mkdir(config.etiquetasDir, { recursive: true });
  await writeFile(ruta, cuerpo);
  return clave;
}

// Devuelve un stream legible del archivo.
export async function leerArchivo(clave) {
  if (!almacenamientoActivo()) return createReadStream(rutaLocal(clave));
  return (await cliente().send(new GetObjectCommand({ Bucket: config.s3Bucket, Key: clave }))).Body;
}

export async function borrarArchivo(clave) {
  if (almacenamientoActivo()) await cliente().send(new DeleteObjectCommand({ Bucket: config.s3Bucket, Key: clave }));
  else await rm(rutaLocal(clave), { force: true });
}

// 'ok' | 'desactivado' (no hace llamadas a AWS: solo informa configuración)
export const estadoAlmacenamiento = () => (almacenamientoActivo() ? 'ok' : 'desactivado');
