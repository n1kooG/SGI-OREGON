import * as repo from '../repositories/inventario.js';
import { conTransaccion } from '../db.js';
import { auditar } from '../audit.js';
import { AppError } from '../errors.js';

// Los comodines de LIKE se escapan: «%» o «_» escritos por el operario se buscan literalmente.
export const buscar = (q) => (q.length < 2 ? [] : repo.buscar(q.slice(0, 40).replace(/[\\%_]/g, '\\$&')));

// Texto recortado de hasta 40 caracteres; vacío o solo espacios = quitar la ubicación (NULL).
export function validarUbicacion(v) {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') throw new AppError(400, 'La ubicación debe ser texto', 'VALIDACION');
  const t = v.trim();
  if (t.length > 40) throw new AppError(400, 'La ubicación admite máximo 40 caracteres', 'VALIDACION');
  return t || null;
}

// Dentro de la transacción del llamador. Si no cambia, no se escribe ni se audita.
export async function ubicarEn(client, req, sku, valor) {
  const ubicacion = validarUbicacion(valor);
  const antes = await repo.ubicacionActual(sku, client);
  if (antes === undefined) throw new AppError(404, `Producto sin inventario: ${sku}`, 'NO_ENCONTRADO');
  if (antes !== ubicacion) {
    await repo.fijarUbicacion(sku, ubicacion, client);
    await auditar(req, { idUsuario: req.usuario.id_usuario, tabla: 'inventario', accion: 'UBICACION',
      antes: { sku, ubicacion_bodega: antes }, despues: { sku, ubicacion_bodega: ubicacion } }, client);
  }
  return { sku, ubicacion_bodega: ubicacion };
}

export function ubicar(req, skuParam, body = {}) {
  if (!('ubicacion_bodega' in body)) throw new AppError(400, 'El campo ubicacion_bodega es obligatorio', 'VALIDACION');
  const sku = String(skuParam ?? '').replace(/\s+/g, '').toUpperCase();
  return conTransaccion((c) => ubicarEn(c, req, sku, body.ubicacion_bodega));
}
