// Importación masiva del catálogo (API): simular no escribe nada; aplicar repite la validación y escribe en una transacción.
// Límites: .xlsx de hasta 5 MB y 20.000 filas (MAX_FILAS). Ver catalogoXlsx.js para el formato y las fórmulas de precios.
import path from 'node:path';
import ExcelJS from 'exceljs';
import { conTransaccion, query } from '../db.js';
import { auditar } from '../audit.js';
import { AppError } from '../errors.js';
import { leerCatalogo, escribirCatalogo, invalido } from './catalogoXlsx.js';

const VISTA = 200; // filas de la vista previa; los conteos siempre son del total

function nombreSeguro(original) {
  const base = path.basename(String(original ?? '')).replace(/[^\w.-]/g, '_');
  if (!/\.xlsx$/i.test(base)) throw invalido('Solo se aceptan archivos .xlsx');
  return base.slice(0, 150);
}
const existentes = async (db, skus) => new Set((await db.query(`SELECT sku FROM producto WHERE sku = ANY($1)`, [skus])).rows.map((r) => r.sku));
const detalleBajoCosto = (a) => a.bajoCosto.map((p) => ({ sku: p.sku, nombre: p.nombre, costo: p.costo, precios: p.precios }));

export async function simular(buffer, archivo) {
  nombreSeguro(archivo);
  const a = await leerCatalogo(buffer);
  const ya = await existentes({ query }, a.productos.map((p) => p.sku));
  return {
    valido: a.bajoCosto.length === 0 && a.productos.length > 0,
    filas: a.filas, validos: a.productos.length, nuevos: a.productos.length - ya.size, existentes: ya.size,
    omitidas: a.omitidas.map(({ fila, sku, motivo }) => ({ fila, sku, motivo })),
    bajo_costo: detalleBajoCosto(a),
    productos: a.productos.slice(0, VISTA).map((p) => ({ ...p, existe: ya.has(p.sku) })), productos_truncado: a.productos.length > VISTA,
  };
}

export async function aplicar(req, buffer, archivo) {
  const nombre = nombreSeguro(archivo);
  const a = await leerCatalogo(buffer);
  if (a.bajoCosto.length) {
    throw Object.assign(new AppError(422, `${a.bajoCosto.length} producto(s) tienen un precio menor o igual al costo; no se escribió nada`, 'IMPORTACION_INVALIDA'), { detalle: detalleBajoCosto(a) });
  }
  if (!a.productos.length) throw invalido('La planilla no tiene productos válidos');
  return conTransaccion(async (c) => {
    const ya = await existentes(c, a.productos.map((p) => p.sku));
    await escribirCatalogo(c, a.productos);
    const r = { archivo: nombre, validos: a.productos.length, nuevos: a.productos.length - ya.size, actualizados: ya.size, omitidas: a.omitidas.length };
    await auditar(req, { idUsuario: req.usuario.id_usuario, tabla: 'producto', accion: 'IMPORTACIÓN', despues: r }, c);
    return r;
  });
}

// Plantilla mínima: solo los encabezados (sin fila de ejemplo, que se importaría como un producto más).
export async function plantilla() {
  const wb = new ExcelJS.Workbook();
  const h = wb.addWorksheet('Catalogo');
  h.addRow(['MARCA', 'CODIGO', 'PRODUCTOS', 'COSTO NETO', 'PVP']).font = { bold: true };
  [14, 16, 40, 14, 14].forEach((w, i) => { h.getColumn(i + 1).width = w; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
