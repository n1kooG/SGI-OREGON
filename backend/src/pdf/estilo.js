// Tokens del producto (documentacion/diseno/README.md) y la marca tipográfica para los PDF.
export const C = { tinta: '#0b172a', tinta3: '#657185', linea: '#e4e9f0', lineaFuerte: '#cbd3de', fondo: '#f7fafc', acento: '#ff4400', danger: '#b42318', blanco: '#ffffff' };

// Wordmark "Tienda Oregón": texto + un cuadrado de acento como único detalle de color.
export function marca(doc, x, y, tam, color = C.blanco) {
  doc.rect(x, y + tam * 0.12, tam * 0.5, tam * 0.5).fill(C.acento);
  doc.font('Helvetica-Bold').fontSize(tam).fillColor(color).text('Tienda ', x + tam * 0.75, y, { continued: true, lineBreak: false })
    .font('Helvetica').text('Oregón', { lineBreak: false });
}

// Etiqueta en mayúsculas espaciada (texto auxiliar de cabeceras).
export const rotulo = (doc, t, x, y, o = {}) => doc.font('Helvetica-Bold').fontSize(o.tam ?? 6.5).fillColor(o.color ?? C.tinta3).text(t.toUpperCase(), x, y, { characterSpacing: 0.8, lineBreak: false, ...o });
