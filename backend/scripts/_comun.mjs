// Utilidades de los scripts de administración. Se ejecutan con: node --env-file=.env scripts/<script>.mjs
import pg from 'pg';

// Los scripts usan el rol propietario (DATABASE_URL_MIGRACION); si no está definido, DATABASE_URL.
export async function conectar() {
  const connectionString = process.env.DATABASE_URL_MIGRACION || process.env.DATABASE_URL;
  if (!connectionString) fallar('Define DATABASE_URL_MIGRACION (o DATABASE_URL)');
  // shortcut: con DB_SSL=true no se verifica el certificado (igual que src/db.js).
  const client = new pg.Client({ connectionString, ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false });
  await client.connect();
  return client;
}

// La clave nunca va por argumento (queda en el historial y en `ps`): variable de entorno o stdin (primera línea).
export async function leerClave(nombreVariable) {
  if (process.env[nombreVariable]) return process.env[nombreVariable];
  if (process.stdin.isTTY) fallar(`Entrega la clave por stdin (echo ... | node ...) o en la variable ${nombreVariable}`);
  let datos = '';
  for await (const parte of process.stdin) datos += parte;
  return datos.split(/\r?\n/)[0];
}

export function fallar(mensaje, codigo = 1) {
  console.error(`ERROR: ${mensaje}`);
  process.exit(codigo);
}
