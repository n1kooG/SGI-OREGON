// Opciones TLS de la conexión a PostgreSQL, compartidas por la API y los scripts. Sin DB_SSL=true no hay TLS (desarrollo local).
// Con DB_SSL=true el certificado SIEMPRE se valida: RDS usa una CA propia, así que se entrega el paquete en DB_SSL_CA (ruta a un .pem).
import { readFileSync } from 'node:fs';

export function opcionesSsl(env = process.env) {
  if (env.DB_SSL !== 'true') return false;
  if (!env.DB_SSL_CA) return { rejectUnauthorized: true };
  let ca;
  try {
    ca = readFileSync(env.DB_SSL_CA, 'utf8');
  } catch {
    throw new Error(`DB_SSL_CA: no se puede leer el paquete de CA en «${env.DB_SSL_CA}»`);
  }
  if (!ca.includes('BEGIN CERTIFICATE')) throw new Error('DB_SSL_CA: el archivo no contiene certificados PEM');
  return { ca, rejectUnauthorized: true };
}
