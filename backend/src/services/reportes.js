import ExcelJS from 'exceljs';
import { readFileSync } from 'node:fs';
import { AppError } from '../errors.js';
import { C, LOGO, MARCA, crearPdf, aBuffer, marca, rotulo, recortar, fechaHora } from '../pdf/estilo.js';
import * as dash from './dashboard.js';

const NOMBRE_PERIODO = { semana: 'Semana', mes: 'Mes', anio: 'Año' };
const TZ = 'America/Santiago';
const num = (v, d = 0) => Number(v).toLocaleString('es-CL', { minimumFractionDigits: d, maximumFractionDigits: d });
const clp = (v) => `$${num(v)}`;
const pct = (v) => (v == null ? '—' : `${num(v, 1)} %`);
const millones = (v) => num(v / 1e6, 1);
const TOP = 5; // filas de rotación e inmovilizado en el reporte (el detalle completo va en Excel)

// Número del reporte: RG-AAAA (año), RG-AAAA-MM (mes) o RG-AAAAMMDD (semana, por su último día).
const folio = (p, hasta) => `RG-${p === 'anio' ? hasta.slice(0, 4) : p === 'mes' ? hasta.slice(0, 7) : hasta.replaceAll('-', '')}`;

// T41/T42: reporte de gestión del período. Devuelve { buffer, tipo, nombre, formato, periodo }.
export async function exportarGestion(q, usuario, conCostos) {
  const { formato } = q;
  if (formato !== 'xlsx' && formato !== 'pdf') throw new AppError(400, 'formato debe ser xlsx o pdf', 'VALIDACION');
  const periodo = dash.validarPeriodo(q.periodo);
  const { data } = await dash.graficos(conCostos, periodo);
  const ctx = { d: data, costos: conCostos, usuario, ahora: new Date() };
  const nombre = `reporte_gestion_${periodo}_${data.hasta}.${formato}`;
  if (formato === 'xlsx') return { buffer: await xlsx(ctx), tipo: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', nombre, formato, periodo };
  return { buffer: await pdf(ctx), tipo: 'application/pdf', nombre, formato, periodo };
}

// ---------------------------------------------------------------- Excel
const ARGB = (c) => `FF${c.slice(1).toUpperCase()}`;
const FINO = { style: 'thin', color: { argb: ARGB(C.linea) } };
// Excel no puede declarar fuentes de respaldo: Poppins solo en títulos; datos en Calibri y Consolas, que vienen con Office.
const F = { titulo: 'Poppins', texto: 'Calibri', mono: 'Consolas' };
const FMT = { clp: '"$"#,##0', pct: '0.0" %"', x: '0.0"×"', n: '#,##0' };

async function xlsx({ d, costos, ahora }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = MARCA; wb.lastModifiedBy = MARCA; wb.company = MARCA; wb.title = `Reporte de gestión · ${NOMBRE_PERIODO[d.periodo]}`;
  const logo = wb.addImage({ buffer: readFileSync(LOGO), extension: 'png' });
  // cols: [título, clave, ancho, formato?]; la fila 5 es la cabecera de la tabla.
  const hoja = (nombreHoja, titulo, cols, filas, total) => {
    const h = wb.addWorksheet(nombreHoja, { views: [{ state: 'frozen', ySplit: 5, showGridLines: false }] });
    h.columns = cols.map(([, key, width]) => ({ key, width }));
    const unir = (n, texto, font, indent = 0) => { h.mergeCells(n, 1, n, cols.length); const c = h.getCell(n, 1); c.value = texto; c.font = { color: { argb: ARGB(C.tinta) }, ...font }; c.alignment = { vertical: 'middle', indent }; };
    unir(1, MARCA, { name: F.titulo, size: 13, bold: true, color: { argb: ARGB(C.naranjaTexto) } }, 4);
    unir(2, titulo, { name: F.titulo, size: 18, bold: true });
    unir(3, d.etiqueta, { name: F.texto, size: 10, color: { argb: ARGB(C.tinta3) } });
    unir(4, `Generado el ${fechaHora(ahora)}  ·  Documento confidencial de uso interno`, { name: F.texto, size: 10, color: { argb: ARGB(C.tinta3) } });
    h.getRow(1).height = 34; h.getRow(2).height = 28;
    h.addImage(logo, { tl: { col: 0.12, row: 0.08 }, ext: { width: 27, height: 30 } });
    const cab = h.getRow(5);
    cab.values = cols.map(([t]) => t);
    cab.height = 22;
    cab.eachCell((c, i) => {
      c.font = { name: F.texto, bold: true, size: 9, color: { argb: ARGB(C.tinta2) } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB(C.fondo) } };
      c.border = { bottom: { style: 'medium', color: { argb: ARGB(C.naranja) } } };
      c.alignment = { vertical: 'middle', horizontal: cols[i - 1][3] ? 'right' : 'left', indent: 1 };
    });
    const escribir = (r, n, fuerte) => {
      const x = h.addRow(r);
      x.eachCell({ includeEmpty: true }, (c, i) => {
        const [, , , fmt, mono] = cols[i - 1];
        c.border = { bottom: FINO };
        c.alignment = { vertical: 'middle', horizontal: fmt ? 'right' : 'left', indent: 1 };
        c.font = { name: mono ? F.mono : F.texto, size: mono ? 9 : 10, bold: fuerte || i === 1, color: { argb: ARGB(C.tinta) } };
        if (fmt) c.numFmt = FMT[fmt];
        if (fuerte || n % 2) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB(C.fondo) } };
      });
    };
    filas.forEach((r, n) => escribir(r, n));
    if (total) escribir(total, 0, true);
    h.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '5:5', margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.7, header: 0.3, footer: 0.3 } };
    h.headerFooter = { oddFooter: `&L&9${MARCA} · Reporte de gestión&R&9Página &P de &N` };
  };
  hoja('Resumen', `Reporte de gestión · ${NOMBRE_PERIODO[d.periodo]}`,
    [['Canal', 'canal', 22], ['Ventas netas', 'ventas', 18, 'clp'], ['% ventas', 'pv', 12, 'pct'], ...(costos ? [['Margen bruto', 'mb', 18, 'clp'], ['Margen %', 'mp', 12, 'pct']] : [])],
    d.canales.map((c) => ({ canal: c.canal, ventas: c.ventas, pv: c.pct_ventas, ...(costos && { mb: c.margen_bruto, mp: c.margen_pct }) })),
    { canal: 'Total', ventas: d.totales.ventas, pv: d.totales.ventas ? 100 : null, ...(costos && { mb: d.totales.margen_bruto, mp: d.totales.margen_pct }) });
  hoja('Ventas por período', 'Ventas por canal y período',
    [['Período', 'p', 14], ['Detalle', 'det', 16], ['Web', 'web', 16, 'clp'], ['Marketplace', 'mk', 16, 'clp'], ['Mayorista', 'my', 16, 'clp'], ['Total', 't', 16, 'clp'],
      ...(costos ? [['Margen Web %', 'mw', 15, 'pct'], ['Margen Marketplace %', 'mm', 20, 'pct'], ['Margen Mayorista %', 'mmy', 18, 'pct']] : [])],
    d.serie.map((s) => ({ p: s.etiqueta, det: s.parcial ? `${s.detalle} (parcial)` : s.detalle, web: s.web, mk: s.marketplace, my: s.mayorista, t: s.total, ...(costos && { mw: s.margen_web, mm: s.margen_marketplace, mmy: s.margen_mayorista }) })));
  hoja('Rotación', `Rotación de productos · unidades vendidas ÷ stock (alta rotación ≥ ${d.umbral_rotacion}×)`,
    [['SKU', 'sku', 16, null, true], ['Producto', 'prod', 34], ['Unidades vendidas', 'u', 18, 'n'], ['Stock', 's', 12, 'n'], ['Rotación', 'r', 12, 'x'], ['Alta rotación', 'a', 14]],
    d.rotacion.map((r) => ({ sku: r.sku, prod: r.producto, u: r.unidades, s: r.stock, r: r.rotacion, a: r.alta ? 'Sí' : 'No' })));
  hoja('Inmovilizado', 'Inventario inmovilizado · sin movimiento hace más de 60 días',
    [['SKU', 'sku', 16, null, true], ['Producto', 'prod', 34], ['Stock', 's', 12, 'n'], ...(costos ? [['Valor', 'v', 16, 'clp']] : []), ['Días sin movimiento', 'dias', 20, 'n']],
    d.inmovilizado.map((i) => ({ sku: i.sku, prod: i.producto, s: i.stock_fisico, ...(costos && { v: i.valor }), dias: i.dias_sin_movimiento })),
    { sku: 'Total', prod: `${d.inmovilizado_resumen.skus} SKUs`, s: d.inmovilizado.reduce((a, i) => a + i.stock_fisico, 0), ...(costos && { v: d.inmovilizado_resumen.valor }) });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------------------------------------------------------------- PDF (A4 vertical)
const M = 36, W = 523, TOPE = 842 - 56;
const COLOR_CANAL = { web: C.cian, mayorista: C.naranja };

// Marketplace se dibuja con trama diagonal para distinguirlo sin depender del color (impresión en blanco y negro).
function trama(doc, x, y, w, h) {
  doc.save().rect(x, y, w, h).clip();
  doc.rect(x, y, w, h).fill(C.blanco);
  for (let k = -h; k < w; k += 3.4) doc.moveTo(x + k, y + h).lineTo(x + k + h, y).lineWidth(0.9).strokeColor(C.tinta2).stroke();
  doc.restore();
}
const muestra = (doc, k, x, y, s = 9) => (k === 'marketplace' ? (trama(doc, x, y, s, s), doc.rect(x, y, s, s).lineWidth(0.5).strokeColor(C.tinta2).stroke()) : doc.roundedRect(x, y, s, s, 1.5).fill(COLOR_CANAL[k]));

// Escala del eje Y: paso «redondo» (1, 2, 2.5, 5 × 10^n) con a lo sumo 4 divisiones.
function escala(max) {
  const bruto = Math.max(max, 1) / 4, p = 10 ** Math.floor(Math.log10(bruto));
  const paso = [1, 2, 2.5, 5, 10].map((f) => f * p).find((s) => s >= bruto);
  return { paso, tope: Math.ceil(max / paso) * paso || paso };
}
const eje = (v) => (v === 0 ? '0' : v >= 1e6 ? `$${num(v / 1e6, v % 1e6 ? 1 : 0)} M` : `$${num(v / 1e3)} mil`);

async function pdf({ d, costos, usuario, ahora }) {
  const doc = crearPdf(`Reporte de gestión · ${NOMBRE_PERIODO[d.periodo]}`, { size: 'A4', layout: 'portrait', bufferPages: true });
  const encabezado = () => {
    marca(doc, M, 26, 12.5);
    rotulo(doc, 'Reporte de gestión', M, 27, { width: W, align: 'right' });
    doc.font('Mono').fontSize(8).fillColor(C.tinta).text(`N.º ${folio(d.periodo, d.hasta)}`, M, 39, { width: W, align: 'right', lineBreak: false });
    doc.rect(M, 56, W * 0.7, 3).fill(C.naranja);
    doc.rect(M + W * 0.7, 56, W * 0.3, 3).fill(C.cian);
  };
  doc.on('pageAdded', encabezado);
  encabezado();
  doc.font('Titulo').fontSize(23).fillColor(C.tinta).text(`Reporte de gestión · ${NOMBRE_PERIODO[d.periodo]}`, M, 76, { lineBreak: false });
  doc.font('Texto').fontSize(9).fillColor(C.tinta3).text(`${d.etiqueta} · Todos los canales (Web, Marketplace, Mayorista)`, M, 108, { lineBreak: false });
  let y = 126;
  const asegurar = (alto) => { if (y + alto > TOPE) { doc.addPage(); y = 76; } };
  // `alto` = lo que ocupa la sección completa, para que el título nunca quede solo al pie de una página.
  const seccion = (titulo, nota, alto = 120) => {
    asegurar(alto);
    doc.rect(M, y + 1, 2.5, 12).fill(C.naranja);
    doc.font('TextoB').fontSize(10.5).fillColor(C.tinta).text(titulo, M + 9, y + 1, { lineBreak: false });
    if (nota) { const x = M + 17 + doc.font('TextoB').fontSize(10.5).widthOfString(titulo); doc.font('Texto').fontSize(8).fillColor(C.tinta3).text(nota, x, y + 3.5, { lineBreak: false }); }
    y += 20;
  };
  // cols: { t: título, w: ancho, a: 'r' (derecha), f: fuente, k: muestra de canal }; la última fila puede ser total.
  const tabla = (cols, filas, total) => {
    const x = cols.reduce((a, c, i) => [...a, a[i] + c.w], [M]), RH = 23, alto = 22 + RH * (filas.length + (total ? 1 : 0));
    asegurar(alto);
    doc.roundedRect(M, y, W, alto, 5).lineWidth(0.6).strokeColor(C.linea).stroke();
    doc.save().roundedRect(M, y, W, alto, 5).clip();
    doc.rect(M, y, W, 22).fill(C.fondo);
    cols.forEach((c, i) => rotulo(doc, c.t, x[i] + 8, y + 8, { tam: 6.5, color: C.tinta3, width: c.w - 16, align: c.a === 'r' ? 'right' : 'left' }));
    const fila = (celdas, yy, fuerte) => cols.forEach((c, i) => {
      const f = fuerte ? (c.f === 'Mono' ? 'MonoB' : 'TextoB') : c.f ?? 'Texto', t = c.f === 'Mono' || fuerte && c.a === 'r' ? 8.5 : 9;
      const dx = c.k && !fuerte ? 16 : 0;
      if (c.k && !fuerte) muestra(doc, celdas[i].k, x[i] + 8, yy + 7);
      const v = c.k && !fuerte ? celdas[i].t : celdas[i];
      if (v?.span) return void doc.font('TextoB').fontSize(9).fillColor(C.tinta).text(v.t, x[i] + 8, yy + 7.5, { lineBreak: false }); // total que ocupa varias columnas
      doc.font(f).fontSize(t).fillColor(C.tinta).text(recortar(doc, v, f, t, c.w - 16 - dx), x[i] + 8 + dx, yy + 7.5, { width: c.w - 16 - dx, align: c.a === 'r' ? 'right' : 'left', lineBreak: false });
    });
    filas.forEach((r, n) => { const yy = y + 22 + n * RH; fila(r, yy); doc.moveTo(M, yy + RH).lineTo(M + W, yy + RH).lineWidth(0.4).strokeColor(C.linea).stroke(); });
    if (total) { const yy = y + 22 + filas.length * RH; doc.rect(M, yy, W, RH).fill(C.fondo); doc.moveTo(M, yy).lineTo(M + W, yy).lineWidth(1).strokeColor(C.linea).stroke(); fila(total, yy, true); }
    doc.restore();
    y += alto + 14;
  };

  const CAN = ['web', 'marketplace', 'mayorista'], NOM = { web: 'Web', marketplace: 'Marketplace', mayorista: 'Mayorista' };
  seccion('Resumen de ventas y margen por canal');
  tabla([{ t: 'Canal', w: costos ? 150 : 280, k: 1 }, { t: 'Ventas netas', w: costos ? 110 : 130, a: 'r', f: 'Mono' }, { t: '% ventas', w: costos ? 85 : 113, a: 'r', f: 'Mono' }, ...(costos ? [{ t: 'Margen bruto', w: 100, a: 'r', f: 'Mono' }, { t: 'Margen %', w: 78, a: 'r', f: 'Mono' }] : [])],
    CAN.map((k, i) => { const c = d.canales[i]; return [{ k, t: NOM[k] }, clp(c.ventas), pct(c.pct_ventas), ...(costos ? [clp(c.margen_bruto), pct(c.margen_pct)] : [])]; }),
    ['Total', clp(d.totales.ventas), d.totales.ventas ? '100 %' : '—', ...(costos ? [clp(d.totales.margen_bruto), pct(d.totales.margen_pct)] : [])]);

  // Gráfico de barras apiladas por tramo (CLP, eje en millones).
  seccion('Ventas por canal y período', 'CLP millones', 190);
  const gx = M + 40, gw = 330, gh = 92, gy = y + 14, { paso, tope } = escala(Math.max(...d.serie.map((s) => s.total), 0));
  for (let v = 0; v <= tope; v += paso) {
    const yy = gy + gh - gh * v / tope;
    doc.moveTo(gx, yy).lineTo(gx + gw, yy).lineWidth(v ? 0.4 : 0.8).strokeColor(v ? C.linea : '#cfd9d6').stroke();
    doc.font('Mono').fontSize(6.5).fillColor(C.tinta3).text(eje(v), M, yy - 3, { width: 36, align: 'right', lineBreak: false });
  }
  const slot = gw / d.serie.length, bw = Math.min(slot * 0.56, 44);
  d.serie.forEach((s, i) => {
    const bx = gx + slot * i + (slot - bw) / 2;
    let base = gy + gh;
    for (const k of ['mayorista', 'marketplace', 'web']) {
      const hh = gh * s[k] / tope;
      if (!hh) continue;
      base -= hh;
      if (k === 'marketplace') trama(doc, bx, base, bw, hh); else doc.rect(bx, base, bw, hh).fill(COLOR_CANAL[k]);
      doc.rect(bx, base, bw, hh).lineWidth(0.6).strokeColor(C.blanco).stroke();
      if (hh >= 9 && bw >= 15) {
        if (k === 'marketplace') doc.rect(bx + bw / 2 - 8, base + hh / 2 - 4, 16, 8).fill(C.tinta2);
        doc.font('Mono').fontSize(6).fillColor(k === 'marketplace' ? C.blanco : C.tinta).text(millones(s[k]), bx, base + hh / 2 - 2.5, { width: bw, align: 'center', lineBreak: false });
      }
    }
    if (s.total) doc.font('MonoB').fontSize(6.8).fillColor(C.tinta).text(millones(s.total), bx - 6, base - 9, { width: bw + 12, align: 'center', lineBreak: false });
    doc.font('TextoB').fontSize(7).fillColor(C.tinta2).text(s.etiqueta, gx + slot * i, gy + gh + 5, { width: slot, align: 'center', lineBreak: false });
    doc.font('Texto').fontSize(6).fillColor(C.tinta3).text(s.detalle, gx + slot * i, gy + gh + 14, { width: slot, align: 'center', lineBreak: false });
  });
  // Leyenda con el total de cada canal.
  ['mayorista', 'marketplace', 'web'].forEach((k, i) => {
    const ly = gy + 8 + i * 20, lx = gx + gw + 24;
    muestra(doc, k, lx, ly, 10);
    doc.font('Texto').fontSize(8).fillColor(C.tinta2).text(NOM[k], lx + 16, ly + 1.5, { lineBreak: false });
    doc.font('MonoB').fontSize(8).fillColor(C.tinta).text(`$${millones(d.canales[CAN.indexOf(k)].ventas)} M`, lx + 16 + 62, ly + 1.5, { lineBreak: false });
  });
  doc.font('Texto').fontSize(7).fillColor(C.tinta3).text('Marketplace lleva trama diagonal para leerse en blanco y negro.', gx + gw + 24, gy + 70, { width: 128 });
  const parcial = d.serie.find((s) => s.parcial);
  if (parcial) doc.font('Texto').fontSize(7).fillColor(C.tinta3).text(`* ${parcial.etiqueta.replace('*', '')} parcial${d.periodo === 'anio' ? ' (mes en curso)' : ` (${parcial.detalle})`}.`, M, gy + gh + 26, { lineBreak: false });
  y = gy + gh + 38;

  seccion('Rotación de productos', `Unidades vendidas ÷ stock · top ${TOP}`, 44 + 23 * Math.max(1, Math.min(TOP, d.rotacion.length)));
  tabla([{ t: 'SKU', w: 100, f: 'Mono' }, { t: 'Producto', w: 198 }, { t: 'Unid. vendidas', w: 95, a: 'r', f: 'Mono' }, { t: 'Stock', w: 60, a: 'r', f: 'Mono' }, { t: 'Rotación', w: 70, a: 'r', f: 'MonoB' }],
    d.rotacion.slice(0, TOP).map((r) => [r.sku, r.producto, num(r.unidades), num(r.stock), `${num(r.rotacion, 1)}×`]));
  if (!d.rotacion.length) { y -= 12; doc.font('Texto').fontSize(8).fillColor(C.tinta3).text('Sin ventas en el período: no hay rotación que calcular.', M + 8, y - 12, { lineBreak: false }); y += 16; }

  seccion('Inventario inmovilizado', `Sin movimiento hace más de 60 días${costos ? ` · top ${TOP} por valor` : ''}`, 67 + 23 * Math.min(TOP, d.inmovilizado.length));
  tabla([{ t: 'SKU', w: 100, f: 'Mono' }, { t: 'Producto', w: costos ? 193 : 283 }, { t: 'Stock', w: 60, a: 'r', f: 'Mono' }, ...(costos ? [{ t: 'Valor', w: 90, a: 'r', f: 'Mono' }] : []), { t: 'Días sin mov.', w: 80, a: 'r', f: 'Mono' }],
    d.inmovilizado.slice(0, TOP).map((i) => [i.sku, i.producto, num(i.stock_fisico), ...(costos ? [clp(i.valor)] : []), i.dias_sin_movimiento == null ? '—' : num(i.dias_sin_movimiento)]),
    [{ t: `Total inmovilizado · ${d.inmovilizado_resumen.skus} SKUs`, span: 3 }, '', '', ...(costos ? [clp(d.inmovilizado_resumen.valor)] : []), '']);

  // Pie en todas las páginas.
  const { count, start } = doc.bufferedPageRange();
  for (let i = 0; i < count; i++) {
    doc.switchToPage(start + i);
    const py = doc.page.height - 34;
    doc.moveTo(M, py - 9).lineTo(M + W, py - 9).lineWidth(0.75).strokeColor(C.linea).stroke();
    doc.font('Texto').fontSize(7.5).fillColor(C.tinta3).text(`Emitido el ${fechaHora(ahora)} · ${usuario} · Documento confidencial de uso interno`, M, py, { lineBreak: false });
    doc.font('Mono').fontSize(7.5).fillColor(C.tinta).text(`Página ${i + 1} de ${count}`, M, py, { width: W, align: 'right', lineBreak: false });
  }
  return aBuffer(doc);
}
