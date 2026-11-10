// Infraestructura Excel (HU04): lectura de la planilla de ventas y plantilla base descargable.
import ExcelJS from 'exceljs';
import { AppError } from './errors.js';

export const COLUMNAS = ['RUT CLIENTE', 'NOMBRE CLIENTE', 'SKU', 'NOMBRE PRODUCTO', 'CANTIDAD', 'PRECIO', 'MARCA'];
export const MAX_FILAS = 20000; // protege memoria; el objetivo de PR-02 son 5.000 líneas
const invalido = (m) => new AppError(400, m, 'ARCHIVO_INVALIDO');
const norm = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();

// Valor primitivo de una celda (texto enriquecido, fórmula, hipervínculo).
function valor(v) {
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if ('result' in v) return v.result;
    if ('text' in v) return v.text;
  }
  return v;
}

// Devuelve [{ fila, rut, nombre, sku, producto, cantidad, precio, marca }] con los valores tal como vienen (sin validar su contenido).
export async function leerPlanilla(buffer) {
  if (buffer.length < 4 || buffer.subarray(0, 2).toString() !== 'PK') throw invalido('El archivo no es un .xlsx válido');
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch { throw invalido('El archivo no es un .xlsx válido'); }
  const hoja = wb.worksheets[0];
  if (!hoja) throw invalido('El libro no tiene hojas');
  const idx = {};
  hoja.getRow(1).eachCell((cel, n) => { idx[norm(valor(cel.value))] ??= n; });
  const faltan = COLUMNAS.filter((c) => !idx[c]);
  if (faltan.length) throw invalido(`Faltan columnas en la fila 1: ${faltan.join(', ')}`);
  if (hoja.rowCount - 1 > MAX_FILAS) throw invalido(`La planilla supera ${MAX_FILAS} filas`);
  const filas = [];
  for (let n = 2; n <= hoja.rowCount; n++) {
    const r = hoja.getRow(n);
    const g = (c) => valor(r.getCell(idx[c]).value);
    const fila = { fila: n, rut: g('RUT CLIENTE'), nombre: g('NOMBRE CLIENTE'), sku: g('SKU'), producto: g('NOMBRE PRODUCTO'), cantidad: g('CANTIDAD'), precio: g('PRECIO'), marca: g('MARCA') };
    if (EJEMPLO.test(norm(fila.rut))) continue; // fila de ejemplo de la plantilla
    if (Object.entries(fila).some(([k, v]) => k !== 'fila' && v !== null && v !== undefined && String(v).trim() !== '')) filas.push(fila);
  }
  if (!filas.length) throw invalido('La planilla no tiene filas de datos');
  return filas;
}

// La fila de ejemplo de la plantilla lleva este sufijo en el RUT; leerPlanilla la descarta aunque el usuario la deje.
const EJEMPLO = /\(EJEMPLO\)\s*$/;
const FILA_EJEMPLO = ['11.111.111-1 (ejemplo)', 'Cliente de Ejemplo SpA', 'TH-4500', 'Hervidor Eléctrico 1.7L', 2, 22990, 'Thomas'];
const HASTA = 5000; // filas con validación; el máximo de importación es MAX_FILAS

const rellenar = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const FINO = { style: 'thin', color: { argb: 'FFE4E9F0' } };

export async function plantilla() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Tienda Oregón';
  const hoja = wb.addWorksheet('Ventas', { views: [{ state: 'frozen', ySplit: 1 }] });
  [18, 28, 16, 34, 12, 14, 16].forEach((w, i) => { hoja.getColumn(i + 1).width = w; });
  const cab = hoja.addRow(COLUMNAS);
  cab.height = 24;
  cab.eachCell((c) => {
    c.font = { name: 'Calibri', bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    c.fill = rellenar('FF0B172A');
    c.alignment = { vertical: 'middle', indent: 1 };
  });
  const ej = hoja.addRow(FILA_EJEMPLO);
  ej.eachCell((c) => {
    c.font = { name: 'Calibri', italic: true, size: 11, color: { argb: 'FF8A94A6' } };
    c.fill = rellenar('FFF1F3F6');
    c.border = { bottom: FINO };
  });
  hoja.getColumn(5).numFmt = '0';
  hoja.getColumn(6).numFmt = '#,##0';
  for (let n = 3; n <= HASTA; n++) {
    hoja.getCell(n, 5).dataValidation = { type: 'whole', operator: 'greaterThanOrEqual', formulae: [1], allowBlank: true, showErrorMessage: true, errorTitle: 'Cantidad no válida', error: 'Ingrese un número entero mayor o igual a 1.' };
    hoja.getCell(n, 6).dataValidation = { type: 'decimal', operator: 'greaterThanOrEqual', formulae: [0], allowBlank: true, showErrorMessage: true, errorTitle: 'Precio no válido', error: 'Ingrese un número mayor o igual a 0.' };
  }

  const ins = wb.addWorksheet('Instrucciones', { views: [{ showGridLines: false }] });
  ins.getColumn(1).width = 22; ins.getColumn(2).width = 80;
  ins.mergeCells('A1:B1');
  ins.getCell('A1').value = 'Plantilla de carga masiva de ventas';
  ins.getCell('A1').font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FF0B172A' } };
  ins.mergeCells('A2:B2');
  ins.getCell('A2').value = 'Complete la hoja «Ventas» desde la fila 3, una línea de producto por fila. La fila gris de ejemplo se ignora al importar. Las líneas con el mismo RUT se agrupan en un solo pedido.';
  ins.getCell('A2').alignment = { wrapText: true, vertical: 'top' };
  ins.getCell('A2').font = { name: 'Calibri', size: 10, color: { argb: 'FF657185' } };
  ins.getRow(2).height = 32;
  const reglas = [
    ['RUT CLIENTE', 'Obligatorio. RUT chileno válido, con dígito verificador (ej. 12.345.678-5).'],
    ['NOMBRE CLIENTE', 'Obligatorio. Hasta 120 caracteres.'],
    ['SKU', 'Obligatorio. Debe existir en el catálogo maestro; no se distingue mayúsculas de minúsculas.'],
    ['NOMBRE PRODUCTO', 'Referencial. Se usa el nombre del catálogo.'],
    ['CANTIDAD', 'Obligatorio. Número entero mayor o igual a 1, y no mayor al stock disponible.'],
    ['PRECIO', 'Obligatorio. Precio unitario de venta, número mayor o igual a 0.'],
    ['MARCA', 'Referencial. Texto libre; no afecta la importación.'],
  ];
  const t = ins.getRow(4);
  t.values = ['Columna', 'Regla'];
  t.eachCell((c) => { c.font = { name: 'Calibri', bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = rellenar('FF0B172A'); c.alignment = { indent: 1, vertical: 'middle' }; });
  reglas.forEach(([c, r], i) => {
    const f = ins.addRow([c, r]);
    f.eachCell((x, n) => {
      x.font = { name: 'Calibri', size: 10, bold: n === 1, color: { argb: 'FF0B172A' } };
      x.alignment = { vertical: 'middle', wrapText: true, indent: 1 };
      x.border = { bottom: FINO };
      if (i % 2) x.fill = rellenar('FFF7FAFC');
    });
    f.height = 20;
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
