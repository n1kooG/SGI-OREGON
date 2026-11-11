// Etiqueta de despacho 10×15 cm para impresora térmica: solo negro sobre blanco, sin rellenos de color ni imágenes.
// Estructura tomada de las etiquetas de marketplace: barras + remitente + orden/destinatario + ruteo + tarjeta de armado.
import { config } from '../config.js';
import { dibujarCode128 } from './code128.js';
import { crearPdf, aBuffer, recortar, fechaCl } from './estilo.js';

export const PW = 283, PH = 425;
const K = '#000', G = '#333'; // negro puro y gris oscuro (legible al convertirse a puntos)
const X0 = 12, BW = PW - 24, IX = X0 + 10, IW = BW - 20; // caja, margen interior y ancho útil
const modulos = (s) => 11 * (String(s).length + 2) + 13; // Code 128-B: 11 por símbolo + inicio, control y parada (13)

// Reparte alturas en páginas: la primera con `capPrimera`, las demás con `capResto`. Un ítem nunca se parte.
export function paginar(alturas, capPrimera, capResto) {
  const paginas = [[]];
  let cap = capPrimera, usado = 0;
  alturas.forEach((h, i) => {
    if (usado + h > cap && (paginas.at(-1).length || paginas.length === 1)) { paginas.push([]); cap = capResto; usado = 0; }
    paginas.at(-1).push(i); usado += h;
  });
  return paginas;
}

// Parte el código de orden en 1–3 líneas monoespaciadas (carácter = 0,6 em) con el mayor tamaño que quepa; recorta con «…» si aun así no cabe.
export function partirCodigo(codigo, ancho, max = 11, min = 7.5) {
  const s = String(codigo);
  for (const n of [1, 2, 3]) {
    const por = Math.ceil(s.length / n), tam = Math.min(max, ancho / (0.6 * por));
    if (tam >= min || n === 3) {
      const t = Math.max(tam, 7), cab = Math.floor(ancho / (0.6 * t));
      const lineas = Array.from({ length: n }, (_, i) => s.slice(i * por, (i + 1) * por).slice(0, cab)).filter(Boolean);
      if (s.length > cab * n) lineas[lineas.length - 1] = lineas.at(-1).slice(0, -1) + '…';
      return { tam: t, lineas };
    }
  }
}

const linea = (doc, y) => doc.moveTo(X0, y).lineTo(X0 + BW, y).lineWidth(1.4).strokeColor(K).stroke();

function tijera(doc, x, y) {
  doc.lineWidth(0.8).strokeColor(K).circle(x, y - 3, 2).stroke().circle(x, y + 3, 2).stroke()
    .moveTo(x + 1.5, y - 2).lineTo(x + 10, y + 3.5).moveTo(x + 1.5, y + 2).lineTo(x + 10, y - 3.5).stroke();
}

function separador(doc, y) {
  doc.font('Texto').fontSize(6.5).fillColor(G);
  doc.text('Etiqueta para pegar en el paquete', X0, y - 10, { width: BW, align: 'center', lineBreak: false });
  doc.text('Información para el armado del paquete', X0, y + 3, { width: BW, align: 'center', lineBreak: false });
  doc.lineWidth(0.8).strokeColor(K).dash(2, { space: 2 }).moveTo(X0 + 14, y).lineTo(X0 + BW, y).stroke().undash();
  tijera(doc, X0 + 3, y);
}

function cuerpoEtiqueta(doc, o, rut) {
  const rem = config.remitente, codigo = String(o.codigo_externo);
  doc.lineWidth(1.2).roundedRect(X0, X0, BW, 288, 9).strokeColor(K).stroke();
  // 1. Código de barras con el N° de orden del marketplace
  const mod = Math.min(1.6, (IW - 16) / modulos(codigo));
  dibujarCode128(doc, codigo, X0 + (BW - modulos(codigo) * mod) / 2, 17, 26, mod, K);
  doc.font('Mono').fontSize(8).fillColor(K).text(recortar(doc, codigo, 'Mono', 8, IW, 1.5), X0, 46, { width: BW, align: 'center', characterSpacing: 1.5, lineBreak: false });
  linea(doc, 60);
  // 2. Remitente (los datos de bodega salen de config.remitente; lo que no esté definido se omite)
  doc.font('TextoB').fontSize(8.5).fillColor(K).text('Remitente:', IX, 67, { lineBreak: false });
  doc.text('Tienda Oregón', IX, 67, { width: IW, align: 'right', lineBreak: false });
  let y = 80;
  for (const t of [rem.nombre, rem.rut && `RUT ${rem.rut}`, rem.direccion, rem.comuna].filter(Boolean).slice(0, 3)) {
    doc.font('Texto').fontSize(7.5).fillColor(K).text(recortar(doc, t, 'Texto', 7.5, IW - 50), IX + 50, y, { width: IW - 50, align: 'right', lineBreak: false });
    y += 9.5;
  }
  linea(doc, 100);
  // 3. Orden (izquierda) y destinatario (derecha)
  const LW = 96, RX = IX + LW + 10, RW = IW - LW - 10;
  doc.font('TextoB').fontSize(8.5).fillColor(K).text('N° de orden:', IX, 107, { lineBreak: false });
  const { tam, lineas } = partirCodigo(codigo, LW);
  let ly = 119;
  for (const l of lineas) { doc.font('MonoB').fontSize(tam).text(l, IX, ly, { lineBreak: false }); ly += tam + 2; }
  ly += 5;
  doc.font('TextoB').fontSize(8.5).text('Bultos: 1/1', IX, ly, { lineBreak: false });
  ly += 13;
  const sub = [['Canal', String(o.canal_origen).toUpperCase()], ...(o.numero_documento_sii ? [['Doc. SII', String(o.numero_documento_sii)]] : []), ['Fecha', fechaCl(o.fecha_orden)]];
  for (const [r, v] of sub) {
    doc.font('Texto').fontSize(6).fillColor(G).text(r.toUpperCase(), IX, ly, { characterSpacing: 0.6, lineBreak: false });
    doc.font('TextoB').fontSize(7.5).fillColor(K).text(recortar(doc, v, 'TextoB', 7.5, LW), IX, ly + 7, { lineBreak: false });
    ly += 18;
  }
  doc.font('TextoB').fontSize(8.5).fillColor(K).text('Destinatario:', RX, 107, { lineBreak: false });
  doc.font('TextoB').fontSize(10);
  const lh = doc.currentLineHeight(), nl = Math.min(2, Math.max(1, Math.round(doc.heightOfString(o.nombre_cliente, { width: RW }) / lh)));
  doc.text(o.nombre_cliente, RX, 119, { width: RW, height: nl * lh, align: 'right', ellipsis: true });
  const ay = 119 + nl * lh + 3, dl = doc.font('Texto').fontSize(8).currentLineHeight(); // la dirección usa el espacio hasta la comuna
  doc.text(o.direccion_despacho ?? 'Sin dirección registrada', RX, ay, { width: RW, height: Math.max(1, Math.floor((168 - ay) / dl)) * dl, align: 'right', ellipsis: true });
  doc.font('TextoB').fontSize(9.5).text(recortar(doc, (o.comuna ?? '').toUpperCase(), 'TextoB', 9.5, RW), RX, 172, { width: RW, align: 'right', lineBreak: false });
  let dy = 186;
  for (const t of [o.telefono_contacto && `Tel. ${o.telefono_contacto}`, rut && `RUT ${rut}`].filter(Boolean)) {
    doc.font('Mono').fontSize(8).text(recortar(doc, t, 'Mono', 8, RW), RX, dy, { width: RW, align: 'right', lineBreak: false });
    dy += 11;
  }
  linea(doc, 212);
  // 4. Ruteo: franja negra con comuna y canal, y segundo código de barras (referencia interna) grande
  const ref = o.id_orden != null ? `SGI-${o.id_orden}` : codigo;
  doc.font('Titulo').fontSize(9).fillColor(K).text('DESPACHO TIENDA OREGÓN', IX, 218, { lineBreak: false });
  doc.font('MonoB').fontSize(9).text(ref, IX, 218, { width: IW, align: 'right', lineBreak: false });
  doc.roundedRect(IX, 233, IW, 16, 2).fill(K);
  doc.font('TextoB').fontSize(9).fillColor('#fff').text(recortar(doc, (o.comuna ?? 'SIN COMUNA').toUpperCase(), 'TextoB', 9, IW * 0.58), IX + 6, 236.5, { lineBreak: false });
  doc.font('TextoB').fontSize(8).text(recortar(doc, String(o.canal_origen).toUpperCase(), 'TextoB', 8, IW * 0.36), IX, 237, { width: IW - 6, align: 'right', lineBreak: false });
  const m2 = Math.min(2.2, IW / modulos(ref));
  dibujarCode128(doc, ref, IX + (IW - modulos(ref) * m2) / 2, 254, 34, m2, K);
}

const NW = IW - 16 - 62; // ancho del nombre en la tarjeta de armado
const LH = 10.5;

function medirItems(doc, items) {
  doc.font('TextoB').fontSize(8.5);
  return items.map((i) => {
    const lineas = Math.min(2, Math.max(1, Math.round(doc.heightOfString(i.nombre ?? i.sku, { width: NW }) / doc.currentLineHeight())));
    return { i, lineas, h: lineas * LH + 16 };
  });
}

function tarjeta(doc, y, ms, total) {
  const h = ms.reduce((a, m) => a + m.h, 0) + 12 + (total ? 14 : 0);
  doc.lineWidth(1.2).roundedRect(X0, y, BW, h, 9).strokeColor(K).stroke();
  let cy = y + 8;
  for (const { i, lineas, h: ih } of ms) {
    doc.circle(IX + 3, cy + 5, 2).fill(K);
    doc.font('TextoB').fontSize(8.5).fillColor(K).text(i.nombre ?? i.sku, IX + 12, cy, { width: NW, height: lineas * LH, ellipsis: true });
    doc.font('MonoB').fontSize(9).text(recortar(doc, `Cant: ${i.cantidad}`, 'MonoB', 9, 62), IX + IW - 62, cy, { width: 62, align: 'right', lineBreak: false });
    doc.font('Mono').fontSize(6.5).fillColor(G).text(recortar(doc, `${i.sku}${i.ubicacion_bodega ? `  ·  ${i.ubicacion_bodega}` : ''}`, 'Mono', 6.5, IW - 12), IX + 12, cy + lineas * LH + 1, { lineBreak: false });
    cy += ih;
  }
  if (total) doc.font('TextoB').fontSize(8).fillColor(K).text(total, IX + 12, cy + 1, { width: IW - 12, lineBreak: false });
}

// Etiqueta (página 1) + tarjeta de armado; si los ítems no caben, la tarjeta sigue en páginas siguientes con el N° de orden.
export function dibujarEtiqueta(doc, o, rut) {
  const unidades = o.items.reduce((a, i) => a + i.cantidad, 0);
  const total = `Total: ${unidades} ${unidades === 1 ? 'unidad' : 'unidades'} · ${o.items.length} ${o.items.length === 1 ? 'ítem' : 'ítems'}`;
  cuerpoEtiqueta(doc, o, rut);
  separador(doc, 316);
  const ms = medirItems(doc, o.items);
  const paginas = paginar([...ms.map((m) => m.h), 14], PH - 12 - 328 - 12, PH - 12 - 34 - 12); // la línea de total cuenta como un ítem más
  paginas.forEach((idx, p) => {
    if (p > 0) {
      doc.addPage();
      doc.font('TextoB').fontSize(7).fillColor(G).text(recortar(doc, `ARMADO · ORDEN ${o.codigo_externo} · ${p + 1}/${paginas.length}`, 'TextoB', 7, BW, 0.4), X0, 16, { characterSpacing: 0.4, lineBreak: false });
    }
    const esTotal = idx.includes(ms.length), chunk = idx.filter((n) => n < ms.length).map((n) => ms[n]);
    if (chunk.length || esTotal) tarjeta(doc, p === 0 ? 328 : 34, chunk, esTotal ? total : null);
  });
  return paginas.length;
}

export function pdfEtiqueta(o, rut) {
  const doc = crearPdf(`Etiqueta ${o.codigo_externo}`, { size: [PW, PH] });
  dibujarEtiqueta(doc, o, rut);
  return aBuffer(doc);
}
