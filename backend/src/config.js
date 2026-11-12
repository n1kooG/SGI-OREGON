export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/sgi_oregon',
  redisUrl: process.env.REDIS_URL ?? '',
  jwtSecret: process.env.JWT_SECRET ?? '',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '30m',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  maxIntentos: Number(process.env.MAX_INTENTOS ?? 5),
  bloqueoMinutos: Number(process.env.BLOQUEO_MINUTOS ?? 15),
  kpiTtl: Number(process.env.KPI_TTL_SEGUNDOS ?? 30),
  dbSsl: process.env.DB_SSL === 'true',
  sessionIdleMinutes: Number(process.env.SESSION_IDLE_MINUTES ?? 15),
  storageEnabled: process.env.STORAGE_ENABLED === 'true',
  s3Bucket: process.env.S3_BUCKET ?? '',
  // Con true, cerrar una entrega como ENTREGADO exige la firma o el nombre del receptor; por defecto son opcionales.
  exigirReceptorEntrega: process.env.EXIGIR_RECEPTOR_ENTREGA === 'true',
  s3Region: process.env.S3_REGION ?? 'sa-east-1',
};

if (!config.jwtSecret || config.jwtSecret.length < 16) {
  throw new Error('JWT_SECRET no definido o demasiado corto (mínimo 16 caracteres). Copia .env.example a .env');
}

// En producción el secreto de ejemplo del repositorio (público) o uno corto permitiría falsificar sesiones.
if (process.env.NODE_ENV === 'production' && (config.jwtSecret.length < 32 || config.jwtSecret.startsWith('cambia-esto'))) {
  throw new Error('JWT_SECRET débil o igual al valor de ejemplo: en producción usa un secreto aleatorio de al menos 32 caracteres');
}
