import { fileURLToPath } from 'node:url';

// TRUST_PROXY: nº de proxies propios delante de la API (p. ej. 1 con un ALB), lista de IP/CIDR de confianza o vacío (sin proxy).
// «true» confía en cualquier X-Forwarded-For y permitiría falsificar la IP de la bitácora y del límite de intentos: se rechaza.
function leerTrustProxy(v = '') {
  const t = v.trim();
  if (t === '' || t === 'false' || t === '0') return false;
  if (/^\d+$/.test(t)) return Number(t);
  if (t === 'true') throw new Error('TRUST_PROXY=true confía en cualquier X-Forwarded-For: indica el número de proxies (p. ej. 1) o sus IP/CIDR');
  return t;
}
const entero = (v, def) => (v === undefined || v === '' || !Number.isFinite(Number(v)) ? def : Math.max(0, Math.floor(Number(v))));

export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/sgi_oregon',
  redisUrl: process.env.REDIS_URL ?? '',
  jwtSecret: process.env.JWT_SECRET ?? '',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '30m',
  trustProxy: leerTrustProxy(process.env.TRUST_PROXY),
  // Límite de intentos de login (además del bloqueo de cuenta): por IP y por correo dentro de una ventana fija. 0 desactiva el límite.
  loginVentanaSeg: entero(process.env.LOGIN_VENTANA_SEGUNDOS, 900),
  loginMaxPorIp: entero(process.env.LOGIN_MAX_POR_IP, 50),
  loginMaxPorCorreo: entero(process.env.LOGIN_MAX_POR_CORREO, 20),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  maxIntentos: Number(process.env.MAX_INTENTOS ?? 5),
  bloqueoMinutos: Number(process.env.BLOQUEO_MINUTOS ?? 15),
  kpiTtl: Number(process.env.KPI_TTL_SEGUNDOS ?? 30),
  sessionIdleMinutes: Number(process.env.SESSION_IDLE_MINUTES ?? 15),
  storageEnabled: process.env.STORAGE_ENABLED === 'true',
  s3Bucket: process.env.S3_BUCKET ?? '',
  // Con true, cerrar una entrega como ENTREGADO exige la firma o el nombre del receptor; por defecto son opcionales.
  exigirReceptorEntrega: process.env.EXIGIR_RECEPTOR_ENTREGA === 'true',
  // Sin S3 (desarrollo) las etiquetas importadas se guardan en disco, en este directorio.
  etiquetasDir: process.env.ETIQUETAS_DIR || fileURLToPath(new URL('../storage-local/etiquetas/', import.meta.url)),
  s3Region: process.env.S3_REGION ?? 'sa-east-1',
};

if (!config.jwtSecret || config.jwtSecret.length < 16) {
  throw new Error('JWT_SECRET no definido o demasiado corto (mínimo 16 caracteres). Copia .env.example a .env');
}

// En producción el secreto de ejemplo del repositorio (público) o uno corto permitiría falsificar sesiones.
if (process.env.NODE_ENV === 'production' && (config.jwtSecret.length < 32 || config.jwtSecret.startsWith('cambia-esto'))) {
  throw new Error('JWT_SECRET débil o igual al valor de ejemplo: en producción usa un secreto aleatorio de al menos 32 caracteres');
}

// En producción el origen permitido debe ser explícito: el valor por defecto (localhost) o un comodín no son aceptables.
if (process.env.NODE_ENV === 'production' && (!process.env.CORS_ORIGIN || process.env.CORS_ORIGIN.includes('*'))) {
  throw new Error('CORS_ORIGIN debe definirse explícitamente en producción (URL del frontend, sin comodines)');
}
