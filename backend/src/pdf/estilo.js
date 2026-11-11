import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';

// Identidad Oregón (Figma «Oregón · Fundamentos y Componentes»).
export const C = {
  tinta: '#10201f', tinta2: '#3b4c4b', tinta3: '#5d6f6d', linea: '#e6ebe9', fondo: '#fbf9f6', teal: '#0e3b38',
  naranja: '#ff5c00', naranjaTexto: '#c24400', cian: '#2ebbb2', cianTexto: '#0f7068', blanco: '#ffffff', danger: '#b42318',
};
export const MARCA = 'Tienda Oregón';
export const LOGO = fileURLToPath(new URL('./logo-icono.png', import.meta.url)); // 348×391

const f = (n) => fileURLToPath(new URL(`./fuentes/${n}.woff`, import.meta.url));
// Poppins para títulos, Inter para texto, JetBrains Mono para códigos y cifras (archivos latinos de @fontsource, licencia OFL).
const FUENTES = { Titulo: 'poppins-latin-700-normal', TituloM: 'poppins-latin-600-normal', Texto: 'inter-latin-400-normal', TextoB: 'inter-latin-600-normal', Mono: 'jetbrains-mono-latin-400-normal', MonoB: 'jetbrains-mono-latin-700-normal' };

// Documento con las fuentes de marca embebidas y metadatos propios (pdfkit pone Creator/Producer «PDFKit» por defecto).
export function crearPdf(titulo, opts = {}) {
  const doc = new PDFDocument({ margin: 0, ...opts, info: { Title: titulo, Author: MARCA, Creator: MARCA, Producer: MARCA } });
  for (const [k, v] of Object.entries(FUENTES)) doc.registerFont(k, f(v));
  // El subconjunto latino de JetBrains Mono trae ligaduras sin contorno («::» en una IP rompe fontkit): se desactivan.
  const fk = doc.font('Mono')._font.font, layout = fk.layout.bind(fk);
  fk.layout = (t, f, ...r) => layout(t, f ?? { calt: false, liga: false, clig: false }, ...r);
  doc.font('Texto');
  return doc;
}

// Recoge la salida del documento en un Buffer.
export function aBuffer(doc) {
  const partes = [];
  doc.on('data', (b) => partes.push(b));
  const fin = new Promise((ok) => doc.on('end', () => ok(Buffer.concat(partes))));
  doc.end();
  return fin;
}

// Logo real + «Tienda Oregón» en Poppins; devuelve el ancho usado.
export function marca(doc, x, y, tam, color = C.tinta) {
  const h = tam * 1.5;
  doc.image(LOGO, x, y, { height: h });
  doc.font('Titulo').fontSize(tam).fillColor(color).text(MARCA, x + h * 0.89 + 6, y + h / 2 - tam * 0.62, { lineBreak: false });
  return h * 0.89 + 6 + doc.widthOfString(MARCA);
}

// Etiqueta en mayúsculas espaciada (texto auxiliar de cabeceras).
export const rotulo = (doc, t, x, y, o = {}) => doc.font('TextoB').fontSize(o.tam ?? 6.5).fillColor(o.color ?? C.tinta3).text(t.toUpperCase(), x, y, { characterSpacing: 0.8, lineBreak: false, ...o });

// Recorta con «…» para que el texto (a ese tamaño y fuente) quepa en `ancho`.
export function recortar(doc, t, fuente, tam, ancho, espaciado = 0) {
  doc.font(fuente).fontSize(tam);
  const cabe = (x) => doc.widthOfString(x, { characterSpacing: espaciado }) <= ancho;
  t = String(t);
  if (cabe(t)) return t;
  let r = t;
  while (r.length > 1 && !cabe(r + '…')) r = r.slice(0, -1);
  return r.trimEnd() + '…';
}

// Mayor tamaño (de `max` a `min`) con que el texto cabe en `ancho`; null si ni al mínimo cabe.
export function ajustar(doc, t, fuente, max, min, ancho) {
  for (let s = max; s >= min; s -= 0.5) if (doc.font(fuente).fontSize(s).widthOfString(String(t)) <= ancho) return s;
  return null;
}

const TZ = 'America/Santiago';
export const fechaHora = (d) => new Date(d).toLocaleString('es-CL', { timeZone: TZ, hourCycle: 'h23' }).replace(',', '');
export const fechaCl = (d) => new Date(d).toLocaleDateString('es-CL', { timeZone: TZ });
