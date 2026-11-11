import ExcelJS from 'exceljs';
import { readFileSync } from 'node:fs';
import * as repo from '../repositories/auditoria.js';
import { AppError } from '../errors.js';
import { C, LOGO, MARCA, crearPdf, aBuffer, marca, rotulo, recortar, fechaHora } from '../pdf/estilo.js';

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
const hora = fechaHora;
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

const FINO = { style: 'thin', color: { argb: 'FFE6EBE9' } };
const BORDE = { bottom: FINO };
const ARGB = (c) => `FF${c.slice(1).toUpperCase()}`;
// Excel no puede declarar fuentes de respaldo: Poppins solo en títulos (si falta, Excel sustituye sin romper nada); datos en Calibri y Consolas, que vienen con Office.
const F = { titulo: 'Poppins', texto: 'Calibri', mono: 'Consolas' };

async function xlsx(rows, resumen) {
  const wb = new ExcelJS.Workbook();
  wb.creator = MARCA; wb.lastModifiedBy = MARCA; wb.company = MARCA; wb.title = 'Bitácora de auditoría';
  const h = wb.addWorksheet('Bitácora', { views: [{ state: 'frozen', ySplit: 5, showGridLines: false }] });
  h.columns = COLS.map(([, key, width]) => ({ key, width }));
  const unir = (n, texto, font, indent = 0) => { h.mergeCells(n, 1, n, COLS.length); const c = h.getCell(n, 1); c.value = texto; c.font = { color: { argb: ARGB(C.tinta) }, ...font }; c.alignment = { vertical: 'middle', indent }; };
  unir(1, MARCA, { name: F.titulo, size: 13, bold: true, color: { argb: ARGB(C.naranjaTexto) } }, 4);
  unir(2, 'Bitácora de auditoría', { name: F.titulo, size: 18, bold: true });
  unir(3, `Filtros: ${resumen}`, { name: F.texto, size: 10, color: { argb: ARGB(C.tinta3) } });
  unir(4, `Generada el ${hora(new Date())}  ·  ${rows.length} registro(s)  ·  ${NOTA}`, { name: F.texto, size: 10, color: { argb: ARGB(C.tinta3) } });
  h.getRow(1).height = 34; h.getRow(2).height = 28;
  h.addImage(wb.addImage({ buffer: readFileSync(LOGO), extension: 'png' }), { tl: { col: 0.12, row: 0.08 }, ext: { width: 27, height: 30 } });
  const cab = h.getRow(5);
  cab.values = COLS.map(([t]) => t);
  cab.height = 22;
  cab.eachCell((c) => {
    c.font = { name: F.texto, bold: true, size: 9, color: { argb: ARGB(C.tinta2) } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB(C.fondo) } };
    c.border = { bottom: { style: 'medium', color: { argb: ARGB(C.naranja) } } };
    c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  });
  rows.forEach((r, n) => {
    const x = h.addRow({ ...r, fecha: comoLocal(r.fecha) });
    x.eachCell((c, i) => {
      c.border = BORDE;
      c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      c.font = { name: i === 1 || i === 6 ? F.mono : F.texto, size: i === 1 || i === 6 ? 9 : 10, bold: i === 4, color: { argb: ARGB(C.tinta) } };
      if (n % 2) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB(C.fondo) } };
    });
    x.getCell(1).numFmt = 'dd-mm-yyyy hh:mm:ss';
  });
  h.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: COLS.length } };
  h.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '5:5', margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.7, header: 0.3, footer: 0.3 } };
  h.headerFooter = { oddFooter: `&L&9${MARCA} · Bitácora de auditoría&R&9Página &P de &N` };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function pdf(rows, resumen) {
  const M = 36, ancho = [122, 166, 96, 170, 112, 104], W = ancho.reduce((a, b) => a + b, 0), RH = 20;
  const doc = crearPdf('Bitácora de auditoría', { size: 'A4', layout: 'landscape', bufferPages: true });
  const tope = doc.page.height - 58;
  const x = ancho.map((_, i) => M + ancho.slice(0, i).reduce((a, b) => a + b, 0));
  // Cabecera de página: logo y marca a la izquierda, tipo de documento a la derecha, filete de marca (naranja + cian).
  const encabezado = () => {
    marca(doc, M, 26, 12.5);
    rotulo(doc, 'Documento de control interno', M, 34, { width: W, align: 'right' });
    doc.moveTo(M, 56).lineTo(M + W, 56).lineWidth(0.75).strokeColor(C.linea).stroke();
    doc.rect(M, 55, 44, 2).fill(C.naranja);
    doc.rect(M + 44, 55, 22, 2).fill(C.cian);
  };
  // Cabecera de la tabla: se repite en cada página. Rótulos grises y línea inferior, como en la pantalla.
  const cabecera = (y) => {
    COLS.forEach(([t], i) => rotulo(doc, t, x[i] + 8, y + 7, { tam: 7, color: C.tinta2, width: ancho[i] - 12 }));
    doc.moveTo(M, y + 20).lineTo(M + W, y + 20).lineWidth(1.2).strokeColor(C.tinta).stroke();
    return y + 20;
  };
  doc.on('pageAdded', encabezado);
  encabezado();
  doc.font('Titulo').fontSize(21).fillColor(C.tinta).text('Bitácora de auditoría', M, 74, { lineBreak: false });
  doc.font('Texto').fontSize(9).fillColor(C.tinta3).text(recortar(doc, `Filtros: ${resumen}`, 'Texto', 9, W), M, 104, { lineBreak: false });
  doc.text(`Generada el ${hora(new Date())}  ·  ${rows.length} registro(s)`, M, 117, { lineBreak: false });
  let y = cabecera(138);
  if (!rows.length) doc.font('Texto').fontSize(9).fillColor(C.tinta3).text('No hay registros para los filtros indicados.', M + 8, y + 10, { lineBreak: false });
  rows.forEach((r, n) => {
    if (y + RH > tope) { doc.addPage(); y = cabecera(70); }
    if (n % 2) doc.rect(M, y, W, RH).fill(C.fondo); // relleno explícito: no depende de la transparencia del visor
    COLS.forEach(([, k], i) => {
      const mono = k === 'ip' || k === 'fecha', v = k === 'fecha' ? hora(r.fecha) : r[k], f = mono ? 'Mono' : k === 'accion' ? 'TextoB' : 'Texto', t = mono ? 7.8 : 8.5;
      doc.font(f).fontSize(t).fillColor(k === 'rol' ? C.tinta2 : C.tinta).text(recortar(doc, v, f, t, ancho[i] - 14), x[i] + 8, y + (mono ? 6.5 : 6), { lineBreak: false });
    });
    doc.moveTo(M, y + RH).lineTo(M + W, y + RH).lineWidth(0.5).strokeColor(C.linea).stroke();
    y += RH;
  });
  // Pie en todas las páginas: aviso de inmutabilidad, fecha de generación y «Página X de Y».
  const { count, start } = doc.bufferedPageRange(), gen = hora(new Date());
  for (let i = 0; i < count; i++) {
    doc.switchToPage(start + i);
    const py = doc.page.height - 34;
    doc.moveTo(M, py - 9).lineTo(M + W, py - 9).lineWidth(0.75).strokeColor(C.linea).stroke();
    doc.font('Texto').fontSize(8).fillColor(C.tinta3).text(`${NOTA}`, M, py, { lineBreak: false });
    doc.text(`${MARCA}  ·  ${gen}`, M, py, { width: W, align: 'center', lineBreak: false });
    doc.text(`Página ${i + 1} de ${count}`, M, py, { width: W, align: 'right', lineBreak: false });
  }
  return aBuffer(doc);
}
