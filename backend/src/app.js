import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { config } from './config.js';
import authRouter from './routes/auth.js';
import productosRouter from './routes/productos.js';
import inventarioRouter from './routes/inventario.js';
import bodegaRouter from './routes/bodega.js';
import dashboardRouter from './routes/dashboard.js';
import comprasRouter from './routes/compras.js';
import pedidosRouter from './routes/pedidos.js';
import despachosRouter from './routes/despachos.js';
import auditoriaRouter from './routes/auditoria.js';
import reportesRouter from './routes/reportes.js';
import usuariosRouter from './routes/usuarios.js';
import healthRouter from './routes/health.js';
import { manejadorErrores, noEncontrado } from './middleware/errores.js';

export function crearApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy); // sin proxy (false) X-Forwarded-For se ignora y no se puede falsificar la IP
  app.use(helmet(config.forzarHttps ? {} : {
    hsts: false,
    contentSecurityPolicy: { directives: { ...helmet.contentSecurityPolicy.getDefaultDirectives(), 'upgrade-insecure-requests': null } },
  }));
  app.use(cors({ origin: config.corsOrigin, exposedHeaders: ['X-Total-Count', 'Content-Disposition', 'X-Cache'] }));
  app.use(express.json({ limit: '100kb' }));

  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/productos', productosRouter);
  app.use('/api/inventario', inventarioRouter);
  app.use('/api/bodega', bodegaRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/compras', comprasRouter);
  app.use('/api/pedidos', pedidosRouter);
  app.use('/api/despachos', despachosRouter);
  app.use('/api/auditoria', auditoriaRouter);
  app.use('/api/reportes', reportesRouter);
  app.use('/api/usuarios', usuariosRouter);

  app.use('/api', noEncontrado);

  // PWA compilada: los assets con hash se cachean un año; index.html y sw.js nunca, para que cada despliegue se vea al recargar.
  const { frontendDist } = config;
  if (existsSync(join(frontendDist, 'index.html'))) {
    const sinCache = (res) => res.setHeader('Cache-Control', 'no-cache');
    app.use(express.static(frontendDist, { index: false, setHeaders: (res, ruta) => { if (/assets[\\/]/.test(ruta)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); else sinCache(res); } }));
    app.get('*', (_req, res) => { sinCache(res); res.sendFile(join(frontendDist, 'index.html')); }); // rutas de React Router
  }
  app.use(manejadorErrores);
  return app;
}
