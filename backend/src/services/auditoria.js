import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import * as repo from '../repositories/auditoria.js';
import { AppError } from '../errors.js';
import { C, marca, rotulo } from '../pdf/estilo.js';

const MAX_EXPORTAR = 10000; // protege memoria
const bad = (m) => new AppError(400, m, 'VALIDACION');
const esFecha = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s).toISOString().slice(0, 10) === s;

export function filtros(q = {}) {
  const f = {};
  for (const k of ['usuario', 'accion']) {
    const v = typeof q[k] === 'string' ? q[k].trim() : '';
    if (v) f[k] = v.slice(0, 80);
  }
  if (f.accion) f.accion = f.accion.toUpperCase();
  for (const k of ['desde', 'hasta']) {
    if (!q[k]) continue;
    if (typeof q[k] !== 'string' || !esFecha(q[k])) throw bad(`${k} debe tener formato AAAA-MM-DD`);
    f[k] = q[k];
  }
  if (f.desde && f.hasta && f.desde > f.hasta) throw bad('desde no puede ser posterior a hasta');
  return f;
}

// El cuerpo HTTP sigue siendo el arreglo de registros (compatible); el total viaja aparte para la cabecera X-Total-Count.
export async function listar(q = {}) {
  const f = filtros(q);
  const limite = Math.max(1, Math.min(Math.trunc(Number(q.limite)) || 50, 200));
  const pagina = Math.max(1, Math.trunc(Number(q.pagina)) || 1);
  const [items, total] = await Promise.all([repo.listar(f, limite, (pagina - 1) * limite), repo.contar(f)]);
  return { items, total };
}

export const opcionesFiltros = () => repo.opcionesFiltros();

const COLS = [['Fecha y hora', 'fecha', 21], ['Usuario', 'usuario', 28], ['Rol', 'rol', 16], ['Acción', 'accion', 22], ['Módulo', 'modulo', 20], ['IP de origen', 'ip', 17]];
const TZ = 'America/Santiago';
const hora = (d) => new Date(d).toLocaleString('es-CL', { timeZone: TZ, hourCycle: 'h23' }).replace(',', '');
const fila = (r) => ({ fecha: r.fecha_hora, usuario: r.usuario ?? '—', rol: r.rol ?? '—', accion: r.accion, modulo: r.modulo, ip: r.ip_origen });
const fmt = (s) => s.split('-').reverse().join('-');
const NOTA = 'Los registros no se pueden modificar ni borrar.';

// Excel no guarda zona horaria: se escribe la hora de Santiago como si fuera UTC para que la celda muestre la hora local.
const comoLocal = (d) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(new Date(d)).map((x) => [x.type, +x.value]));
  return new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second));
};

// Texto de los filtros aplicados; el usuario llega como id desde la pantalla y se muestra por nombre.
async function resumenFiltros(f) {
  const partes = [];
  if (f.usuario) {
    const u = /^\d+$/.test(f.usuario) ? (await repo.opcionesFiltros()).usuarios.find((x) => String(x.id_usuario) === f.usuario) : null;
    partes.push(`Usuario: ${u?.nombre ?? f.usuario}`);
  }
  if (f.accion) partes.push(`Acción: ${f.accion}`);
  if (f.desde) partes.push(`Desde: ${fmt(f.desde)}`);
  if (f.hasta) partes.push(`Hasta: ${fmt(f.hasta)}`);
  return partes.length ? partes.join('  ·  ') : 'Sin filtros (todos los registros)';
}

// T42/T51: exporta con los mismos filtros que la consulta. Devuelve { buffer, tipo, nombre, filas }.
export async function exportar(q = {}) {
  const formato = q.formato;
  if (formato !== 'xlsx' && formato !== 'pdf') throw bad('formato debe ser xlsx o pdf');
  const f = filtros(q);
  const rows = (await repo.listar(f, MAX_EXPORTAR, 0)).map(fila);
  const resumen = await resumenFiltros(f);
  const nombre = `bitacora_${new Date().toISOString().slice(0, 10)}.${formato}`;
  if (formato === 'xlsx') return { buffer: await xlsx(rows, resumen), tipo: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', nombre, filas: rows.length };
  return { buffer: await pdf(rows, resumen), tipo: 'application/pdf', nombre, filas: rows.length };
}

const FINO = { style: 'thin', color: { argb: 'FFE4E9F0' } };
const BORDE = { top: FINO, bottom: FINO, left: FINO, right: FINO };

async function xlsx(rows, resumen) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Tienda Oregón';
  const h = wb.addWorksheet('Bitácora', { views: [{ state: 'frozen', ySplit: 5, showGridLines: false }] });
  h.columns = COLS.map(([, key, width]) => ({ key, width }));
  const unir = (n, texto, font) => { h.mergeCells(n, 1, n, COLS.length); const c = h.getCell(n, 1); c.value = texto; c.font = font; c.alignment = { vertical: 'middle' }; };
  unir(1, 'Tienda Oregón', { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFF4400' } });
  unir(2, 'Bitácora de auditoría', { name: 'Calibri', size: 18, bold: true, color: { argb: 'FF0B172A' } });
  unir(3, `Filtros: ${resumen}`, { name: 'Calibri', size: 10, color: { argb: 'FF657185' } });
  unir(4, `Generada el ${hora(new Date())}  ·  ${rows.length} registro(s)  ·  ${NOTA}`, { name: 'Calibri', size: 10, color: { argb: 'FF657185' } });
  h.getRow(2).height = 26;
  const cab = h.getRow(5);
  cab.values = COLS.map(([t]) => t);
  cab.height = 22;
  cab.eachCell((c) => {
    c.font = { name: 'Calibri', bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B172A' } };
    c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  });
  rows.forEach((r, n) => {
    const x = h.addRow({ ...r, fecha: comoLocal(r.fecha) });
    x.eachCell((c, i) => {
      c.border = BORDE;
      c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      c.font = { name: i === 6 ? 'Consolas' : 'Calibri', size: 10, color: { argb: 'FF0B172A' } };
      if (n % 2) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7FAFC' } };
    });
    x.getCell(1).numFmt = 'dd-mm-yyyy hh:mm:ss';
  });
  h.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: COLS.length } };
  h.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '5:5' };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function pdf(rows, resumen) {
  const M = 36, ancho = [112, 170, 92, 140, 130, 126], W = ancho.reduce((a, b) => a + b, 0), RH = 19;
  const doc = new PDFDocument({ margin: M, size: 'A4', layout: 'landscape', bufferPages: true, info: { Title: 'Bitácora de auditoría', Author: 'Tienda Oregón' } });
  const partes = [];
  doc.on('data', (c) => partes.push(c));
  const fin = new Promise((ok) => doc.on('end', ok));
  const tope = doc.page.height - 56;
  const x = ancho.map((_, i) => M + ancho.slice(0, i).reduce((a, b) => a + b, 0));
  const cabecera = (y) => {
    doc.rect(M, y, W, 20).fill(C.tinta);
    COLS.forEach(([t], i) => doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.blanco).text(t.toUpperCase(), x[i] + 8, y + 6.5, { width: ancho[i] - 12, characterSpacing: 0.6, lineBreak: false }));
    return y + 20;
  };
  const fondo = () => doc.rect(0, 0, doc.page.width, doc.page.height).fill(C.blanco);
  doc.on('pageAdded', fondo);
  fondo();
  // Encabezado de marca
  marca(doc, M, M - 4, 13, C.tinta);
  rotulo(doc, 'Documento de control interno', M, M, { width: W, align: 'right' });
  doc.moveTo(M, M + 20).lineTo(M + W, M + 20).lineWidth(0.75).strokeColor(C.linea).stroke();
  doc.font('Helvetica-Bold').fontSize(21).fillColor(C.tinta).text('Bitácora de auditoría', M, M + 32, { lineBreak: false });
  doc.font('Helvetica').fontSize(9).fillColor(C.tinta3).text(`Filtros: ${resumen}`, M, M + 62, { width: W, lineBreak: false, ellipsis: true })
    .text(`Generada el ${hora(new Date())}  ·  ${rows.length} registro(s)`, M, M + 75, { lineBreak: false });
  let y = cabecera(M + 98);
  if (!rows.length) doc.font('Helvetica-Oblique').fontSize(9).fillColor(C.tinta3).text('No hay registros para los filtros indicados.', M + 8, y + 8, { lineBreak: false });
  rows.forEach((r, n) => {
    if (y + RH > tope) { doc.addPage(); y = cabecera(M); }
    doc.rect(M, y, W, RH).fill(n % 2 ? C.fondo : C.blanco); // relleno explícito: no depende de la transparencia del visor
    COLS.forEach(([, k], i) => {
      const mono = k === 'ip', v = k === 'fecha' ? hora(r.fecha) : r[k];
      doc.font(mono ? 'Courier' : k === 'accion' ? 'Helvetica-Bold' : 'Helvetica').fontSize(mono ? 8 : 8.5).fillColor(C.tinta)
        .text(v, x[i] + 8, y + 5.5, { width: ancho[i] - 12, lineBreak: false, ellipsis: true });
    });
    doc.moveTo(M, y + RH).lineTo(M + W, y + RH).lineWidth(0.4).strokeColor(C.linea).stroke();
    y += RH;
  });
  // Pie en todas las páginas: aviso de inmutabilidad y «Página X de Y».
  const { count, start } = doc.bufferedPageRange();
  for (let i = 0; i < count; i++) {
    doc.switchToPage(start + i);
    doc.page.margins.bottom = 0; // sin esto escribir en el pie crearía una página nueva
    const py = doc.page.height - 36;
    doc.moveTo(M, py - 8).lineTo(M + W, py - 8).lineWidth(0.75).strokeColor(C.linea).stroke();
    doc.font('Helvetica').fontSize(8).fillColor(C.tinta3).text(NOTA, M, py, { lineBreak: false });
    doc.text(`Página ${i + 1} de ${count}`, M, py, { width: W, align: 'right', lineBreak: false });
  }
  doc.end();
  await fin;
  return Buffer.concat(partes);
}
