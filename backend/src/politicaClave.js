// Política mínima de claves (cambio de clave, arranque de producción y restablecimiento por script).
export const CLAVE_EJEMPLO = 'Demo-Oregon-2026'; // clave de los datos de ejemplo: pública, nunca válida como clave real
export const LARGO_MIN = 12;
export const BYTES_MAX = 72; // bcrypt ignora lo que pase de 72 bytes

// Devuelve el motivo del rechazo o null si la clave cumple. `actual` es la clave vigente (si existe).
export function errorPoliticaClave(nueva, actual = null) {
  if (typeof nueva !== 'string') return 'La nueva contraseña es obligatoria';
  if (nueva.length < LARGO_MIN) return `La nueva contraseña debe tener al menos ${LARGO_MIN} caracteres`;
  if (Buffer.byteLength(nueva) > BYTES_MAX) return `La nueva contraseña no puede superar ${BYTES_MAX} bytes`;
  if (nueva.toLowerCase() === CLAVE_EJEMPLO.toLowerCase()) return 'La nueva contraseña no puede ser la clave de ejemplo';
  if (actual !== null && nueva === actual) return 'La nueva contraseña debe ser distinta de la actual';
  return null;
}
