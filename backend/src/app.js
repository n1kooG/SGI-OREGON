import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { config } from './config.js';
import authRouter from './routes/auth.js';
import productosRouter from './routes/productos.js';
import inventarioRouter from './routes/inventario.js';
import dashboardRouter from './routes/dashboard.js';
import pedidosRouter from './routes/pedidos.js';
import auditoriaRouter from './routes/auditoria.js';

export function crearApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRouter);
  app.use('/api/productos', productosRouter);
  app.use('/api/inventario', inventarioRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/pedidos', pedidosRouter);
  app.use('/api/auditoria', auditoriaRouter);

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));
  // Errores: respuesta genérica, sin detalles internos (OWASP A02/A10).
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(err.status ?? 500).json({ error: 'Error interno del servidor' });
  });
  return app;
}
