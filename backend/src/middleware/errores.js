import { AppError } from '../errors.js';

export const noEncontrado = (_req, res) => res.status(404).json({ error: 'Ruta no encontrada', codigo: 'NO_ENCONTRADO' });

// Formato uniforme { error, codigo }. Nada interno se filtra al cliente (OWASP A02/A10).
// eslint-disable-next-line no-unused-vars
export function manejadorErrores(err, _req, res, _next) {
  if (err instanceof AppError) return res.status(err.status).json({ error: err.message, codigo: err.codigo, ...(err.detalle && { detalle: err.detalle }) });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido', codigo: 'SOLICITUD_INVALIDA' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Cuerpo demasiado grande', codigo: 'SOLICITUD_INVALIDA' });
  // Datos fuera de rango o mal formados que llegan a PostgreSQL (número desbordado, texto inválido, NUL, fecha imposible): son del cliente, no un 500.
  if (['22003', '22P02', '22P05', '22021', '22001', '22007', '22008'].includes(err.code)) return res.status(400).json({ error: 'Datos fuera de rango o con formato inválido', codigo: 'SOLICITUD_INVALIDA' });
  if (err instanceof URIError) return res.status(400).json({ error: 'Solicitud inválida', codigo: 'SOLICITUD_INVALIDA' });
  if (err.expose && err.status >= 400 && err.status < 500) return res.status(err.status).json({ error: 'Solicitud inválida', codigo: 'SOLICITUD_INVALIDA' }); // errores 4xx de Express/body-parser (p. ej. 415)
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor', codigo: 'ERROR_INTERNO' });
}
