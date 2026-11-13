import * as repo from '../repositories/inventario.js';
import { conTransaccion } from '../db.js';
import { auditar } from '../audit.js';
import { AppError } from '../errors.js';

export const resumen = () => repo.resumen();

// Los comodines de LIKE se escapan: «%» o «_» escritos por el operario se buscan literalmente.
export const buscar = (q) => (q.length < 2 ? [] : repo.buscar(q.slice(0, 40).replace(/[\\%_]/g, '\\$&')));

// Productos activos sin ubicación (la misma definición que `sin_ubicacion` del resumen), paginados; `q` filtra por SKU o nombre.
export async function sinUbicacion({ limite, pagina, q } = {}) {
  const l = limite === undefined ? 20 : Number(limite);
  const p = pagina === undefined ? 1 : Number(pagina);
  if (!Number.isInteger(l) || l < 1 || l > 100) throw new AppError(400, 'limite debe ser un entero entre 1 y 100', 'VALIDACION');
  if (!Number.isInteger(p) || p < 1) throw new AppError(400, 'pagina debe ser un entero ≥ 1', 'VALIDACION');
  const texto = typeof q === 'string' ? q.trim().slice(0, 40).replace(/[\\%_]/g, '\\$&') : '';
  const filas = await repo.sinUbicacion(texto || null, l, (p - 1) * l);
  return { total: filas[0]?.total ?? 0, pagina: p, limite: l, items: filas.map(({ total, ...f }) => f) };
}

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
