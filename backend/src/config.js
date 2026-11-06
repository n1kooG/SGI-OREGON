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
};

if (!config.jwtSecret || config.jwtSecret.length < 16) {
  throw new Error('JWT_SECRET no definido o demasiado corto (mínimo 16 caracteres). Copia .env.example a .env');
}
