// Lectura del N° de orden del marketplace dentro de un PDF de etiqueta exportado (p. ej. Mercado Libre: «Nº de orden: 3248404545»).
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

// Se prueban en orden; el primero que calce gana. Para soportar otro marketplace basta agregar un patrón (el valor va en el grupo 1).
// El valor puede quedar en la línea siguiente al rótulo, por eso \s* cruza saltos de línea.
export const PATRONES_ORDEN = [
  /N\s*[º°o.]*\s*(?:de\s+)?orden\s*[:#]?\s*([A-Z0-9][A-Z0-9_-]{3,39})(?![\w-])/i,
  /orden\s+de\s+(?:venta|compra)\s*[:#]?\s*([A-Z0-9][A-Z0-9_-]{3,39})(?![\w-])/i,
  /\bpedido\s*[:#]\s*([A-Z0-9][A-Z0-9_-]{3,39})(?![\w-])/i,
];

const MAX_PAGINAS = 5; // una etiqueta es de 1 página; no se procesan PDF enormes

export async function extraerTexto(buffer) {
  const doc = await getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise;
  try {
    const partes = [];
    for (let i = 1; i <= Math.min(doc.numPages, MAX_PAGINAS); i++) {
      const pagina = await doc.getPage(i);
      partes.push((await pagina.getTextContent()).items.map((x) => x.str).join(' '));
    }
    return partes.join('\n');
  } finally { await doc.destroy(); }
}

export function extraerNumeroOrden(texto, patrones = PATRONES_ORDEN) {
  for (const p of patrones) {
    const m = p.exec(texto);
    if (m) return m[1];
  }
  return null;
}

// Misma normalización que `NORM_CODIGO_SQL` del repositorio: sin espacios, mayúsculas, sin «#»/«ORD-» ni ceros iniciales.
export const normalizarCodigo = (s) => String(s).toUpperCase().replace(/\s+/g, '').replace(/^(#|ORD-?)*0*/, '');
