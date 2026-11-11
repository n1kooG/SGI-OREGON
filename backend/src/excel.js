// Infraestructura Excel (HU04): lectura de la planilla de ventas y plantilla base descargable.
import { readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { AppError } from './errors.js';
import { C, LOGO, MARCA } from './pdf/estilo.js';

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

const rellenar = (c) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${c.slice(1).toUpperCase()}` } });
const argb = (c) => ({ argb: `FF${c.slice(1).toUpperCase()}` });
const FINO = { style: 'thin', color: argb(C.linea) };
// Excel no admite fuentes de respaldo: Poppins solo en títulos; datos en Calibri (viene con Office).
const F = { titulo: 'Poppins', texto: 'Calibri' };

export async function plantilla() {
  const wb = new ExcelJS.Workbook();
  wb.creator = MARCA; wb.lastModifiedBy = MARCA; wb.company = MARCA; wb.title = 'Plantilla de carga masiva de ventas';
  const hoja = wb.addWorksheet('Ventas', { views: [{ state: 'frozen', ySplit: 1 }], properties: { tabColor: argb(C.naranja) } });
  [18, 28, 16, 34, 12, 14, 16].forEach((w, i) => { hoja.getColumn(i + 1).width = w; });
  const cab = hoja.addRow(COLUMNAS); // la fila 1 debe quedar con los nombres de columna: la lee la importación
  cab.height = 26;
  cab.eachCell((c) => {
    c.font = { name: F.texto, bold: true, size: 11, color: argb(C.blanco) };
    c.fill = rellenar(C.teal);
    c.border = { bottom: { style: 'medium', color: argb(C.naranja) } };
    c.alignment = { vertical: 'middle', indent: 1 };
  });
  const ej = hoja.addRow(FILA_EJEMPLO);
  ej.eachCell((c) => {
    c.font = { name: F.texto, italic: true, size: 11, color: argb(C.tinta3) };
    c.fill = rellenar(C.fondo);
    c.border = { bottom: FINO };
  });
  hoja.getColumn(5).numFmt = '0';
  hoja.getColumn(6).numFmt = '#,##0';
  for (let n = 3; n <= HASTA; n++) {
    hoja.getCell(n, 5).dataValidation = { type: 'whole', operator: 'greaterThanOrEqual', formulae: [1], allowBlank: true, showErrorMessage: true, errorTitle: 'Cantidad no válida', error: 'Ingrese un número entero mayor o igual a 1.' };
    hoja.getCell(n, 6).dataValidation = { type: 'decimal', operator: 'greaterThanOrEqual', formulae: [0], allowBlank: true, showErrorMessage: true, errorTitle: 'Precio no válido', error: 'Ingrese un número mayor o igual a 0.' };
  }

  const ins = wb.addWorksheet('Instrucciones', { views: [{ showGridLines: false }], properties: { tabColor: argb(C.cian) } });
  ins.getColumn(1).width = 22; ins.getColumn(2).width = 80;
  ins.addImage(wb.addImage({ buffer: readFileSync(LOGO), extension: 'png' }), { tl: { col: 0.1, row: 0.1 }, ext: { width: 31, height: 35 } });
  ins.mergeCells('A1:B1');
  ins.getCell('A1').value = MARCA;
  ins.getCell('A1').font = { name: F.titulo, size: 13, bold: true, color: argb(C.naranjaTexto) };
  ins.getCell('A1').alignment = { vertical: 'middle', indent: 4 };
  ins.getRow(1).height = 40;
  ins.mergeCells('A2:B2');
  ins.getCell('A2').value = 'Plantilla de carga masiva de ventas';
  ins.getCell('A2').font = { name: F.titulo, size: 16, bold: true, color: argb(C.tinta) };
  ins.getRow(2).height = 28;
  ins.mergeCells('A3:B3');
  ins.getCell('A3').value = 'Complete la hoja «Ventas» desde la fila 3, una línea de producto por fila. La fila gris de ejemplo se ignora al importar. Las líneas con el mismo RUT se agrupan en un solo pedido.';
  ins.getCell('A3').alignment = { wrapText: true, vertical: 'top' };
  ins.getCell('A3').font = { name: F.texto, size: 10, color: argb(C.tinta3) };
  ins.getRow(3).height = 32;
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
  t.values = ['COLUMNA', 'REGLA'];
  t.height = 22;
  t.eachCell((c) => {
    c.font = { name: F.texto, bold: true, size: 9, color: argb(C.tinta2) };
    c.fill = rellenar(C.fondo);
    c.border = { bottom: { style: 'medium', color: argb(C.naranja) } };
    c.alignment = { indent: 1, vertical: 'middle' };
  });
  reglas.forEach(([c, r], i) => {
    const f = ins.addRow([c, r]);
    f.eachCell((x, n) => {
      x.font = { name: F.texto, size: 10, bold: n === 1, color: argb(n === 1 ? C.naranjaTexto : C.tinta) };
      x.alignment = { vertical: 'middle', wrapText: true, indent: 1 };
      x.border = { bottom: FINO };
      if (i % 2) x.fill = rellenar(C.fondo);
    });
    f.height = 20;
  });
  ins.pageSetup = { paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  ins.headerFooter = { oddFooter: `&L&9${MARCA}&R&9Página &P de &N` };
  return Buffer.from(await wb.xlsx.writeBuffer());
}
