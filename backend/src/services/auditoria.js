import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import * as repo from '../repositories/auditoria.js';
import { AppError } from '../errors.js';

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

const COLS = [['Fecha', 'fecha', 20], ['Usuario', 'usuario', 26], ['Rol', 'rol', 15], ['Acción', 'accion', 22], ['Módulo', 'modulo', 20], ['IP de origen', 'ip', 16]];
const hora = (d) => new Date(d).toLocaleString('es-CL', { timeZone: 'America/Santiago' });
const fila = (r) => ({ fecha: hora(r.fecha_hora), usuario: r.usuario ?? '—', rol: r.rol ?? '—', accion: r.accion, modulo: r.modulo, ip: r.ip_origen });

// T42/T51: exporta con los mismos filtros que la consulta. Devuelve { buffer, tipo, nombre, filas }.
export async function exportar(q = {}) {
  const formato = q.formato;
  if (formato !== 'xlsx' && formato !== 'pdf') throw bad('formato debe ser xlsx o pdf');
  const f = filtros(q);
  const rows = (await repo.listar(f, MAX_EXPORTAR, 0)).map(fila);
  const nombre = `bitacora_${new Date().toISOString().slice(0, 10)}.${formato}`;
  if (formato === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    const h = wb.addWorksheet('Bitácora');
    h.columns = COLS.map(([header, key, width]) => ({ header, key, width }));
    h.getRow(1).font = { bold: true };
    h.addRows(rows);
    return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), tipo: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', nombre, filas: rows.length };
  }
  const doc = new PDFDocument({ margin: 36, size: 'A4', layout: 'landscape' });
  const partes = [];
  doc.on('data', (c) => partes.push(c));
  const fin = new Promise((ok) => doc.on('end', ok));
  const x = [36, 130, 270, 350, 480, 620], ancho = [92, 138, 78, 128, 138, 90];
  const cabecera = () => {
    doc.font('Helvetica-Bold').fontSize(8);
    const y = doc.y;
    COLS.forEach(([t], i) => doc.text(t, x[i], y, { width: ancho[i] }));
    doc.y = y + 14;
    doc.font('Helvetica');
  };
  doc.font('Helvetica-Bold').fontSize(14).text('Bitácora de auditoría', 36).font('Helvetica').fontSize(8)
    .text(`Generada ${hora(new Date())} · ${rows.length} registro(s)`).moveDown();
  cabecera();
  for (const r of rows) {
    if (doc.y > doc.page.height - 60) { doc.addPage(); cabecera(); }
    const y = doc.y;
    COLS.forEach(([, k], i) => doc.text(r[k], x[i], y, { width: ancho[i], lineBreak: false, ellipsis: true }));
    doc.y = y + 12;
  }
  doc.end();
  await fin;
  return { buffer: Buffer.concat(partes), tipo: 'application/pdf', nombre, filas: rows.length };
}
