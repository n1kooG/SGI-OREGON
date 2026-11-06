import { query } from './db.js';

// Bitácora inmutable (CU-07). Un fallo al auditar nunca debe tumbar la petición.
export async function auditar(req, { idUsuario = null, tabla, accion, antes = null, despues = null, geo = null }) {
  try {
    await query(
      `INSERT INTO audit_log (id_usuario, tabla_afectada, accion, valores_anteriores, valores_nuevos, ip_origen, geolocalizacion)
       VALUES ($1, $2, $3, $4, $5, $6::inet, $7)`,
      [idUsuario, tabla, accion, antes, despues, ipDe(req), geo],
    );
  } catch (e) {
    console.error('[auditoria] no se pudo registrar:', e.message);
  }
}

export function ipDe(req) {
  return req.ip || req.socket?.remoteAddress || '0.0.0.0';
}
