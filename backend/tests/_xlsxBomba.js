// Fabrica .xlsx mínimos con ZIP escrito a mano, para probar archivos hostiles sin guardar binarios en el repositorio.
// No es una suite (el patrón de npm test es *.test.js).
import { deflateRawSync } from 'node:zlib';

const TABLA = Uint32Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (c, buf) => { c = ~c; for (let i = 0; i < buf.length; i++) c = TABLA[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return ~c >>> 0; };

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const partes = (hojas) => ({
  '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${hojas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
  '_rels/.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8"?><workbook ${NS} xmlns:r="${REL}"><sheets>${hojas.map((_, i) => `<sheet name="H${i + 1}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
  'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${hojas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`,
});

const letra = (i) => (i >= 26 ? letra(Math.floor(i / 26) - 1) : '') + String.fromCharCode(65 + (i % 26));
const celda = (ref, v) => `<c r="${ref}" t="inlineStr"><is><t>${v}</t></is></c>`;
const CABECERA = ['RUT CLIENTE', 'NOMBRE CLIENTE', 'SKU', 'NOMBRE PRODUCTO', 'CANTIDAD', 'PRECIO', 'MARCA'];
const fila = (n, vals) => `<row r="${n}">${vals.map((v, i) => celda(`${letra(i)}${n}`, v)).join('')}</row>`;

// Genera el XML de una hoja como trozos (iterable): `filas` filas de 7 celdas con texto de `largoCelda` caracteres.
export function* hojaXml({ filas = 1, largoCelda = 5, dimension = null, columnas = 7 } = {}) {
  yield `<?xml version="1.0" encoding="UTF-8"?><worksheet ${NS}>${dimension ? `<dimension ref="${dimension}"/>` : ''}<sheetData>`;
  yield fila(1, CABECERA);
  const texto = 'x'.repeat(largoCelda);
  for (let n = 2; n <= filas + 1; n++) {
    yield columnas === 7 ? fila(n, ['11.111.111-1', texto, 'TH-4500', texto, '1', '5000', texto]) : fila(n, Array.from({ length: columnas }, () => 'a'));
  }
  yield '</sheetData></worksheet>';
}

// Construye el ZIP. `hojas`: iterables de trozos de XML (cada uno es una hoja); `mentirTamano`/`mentirTodo`: declaran 1 KB descomprimido
// (en las hojas / en todas las partes); `renombrar` cambia el nombre de cada parte en el ZIP; `extra`: partes adicionales { nombre: texto }.
export function construirXlsx(hojas, { mentirTamano = false, mentirTodo = false, renombrar = (n) => n, extra = {} } = {}) {
  const todas = { ...partes(hojas), ...extra };
  const out = [], central = [];
  let pos = 0;
  const entradas = [];
  for (const [n, x] of Object.entries(todas)) entradas.push({ nombre: n, c: crc(0, Buffer.from(x)), tam: Buffer.byteLength(x), datos: deflateRawSync(Buffer.from(x)) });
  hojas.forEach((h, i) => {
    let c = 0, tam = 0;
    const trozos = [];
    for (const t of h) { const b = Buffer.from(t); c = crc(c, b); tam += b.length; trozos.push(b); }
    const datos = deflateRawSync(Buffer.concat(trozos), { level: 9 });
    entradas.push({ nombre: `xl/worksheets/sheet${i + 1}.xml`, c, tam, datos });
  });
  for (const e of entradas) {
    const nombre = Buffer.from(renombrar(e.nombre));
    const cab = Buffer.alloc(30);
    cab.writeUInt32LE(0x04034b50, 0); cab.writeUInt16LE(20, 4); cab.writeUInt16LE(8, 8);
    cab.writeUInt32LE(e.c, 14); cab.writeUInt32LE(e.datos.length, 18); cab.writeUInt32LE(e.tam, 22); cab.writeUInt16LE(nombre.length, 26);
    out.push(cab, nombre, e.datos);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(8, 10);
    cen.writeUInt32LE(e.c, 16); cen.writeUInt32LE(e.datos.length, 20);
    cen.writeUInt32LE(mentirTodo || (mentirTamano && e.nombre.includes('worksheets')) ? 1024 : e.tam, 24);
    cen.writeUInt16LE(nombre.length, 28); cen.writeUInt32LE(pos, 42);
    central.push(cen, nombre);
    pos += 30 + nombre.length + e.datos.length;
  }
  const cd = Buffer.concat(central);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(entradas.length, 8); fin.writeUInt16LE(entradas.length, 10);
  fin.writeUInt32LE(cd.length, 12); fin.writeUInt32LE(pos, 16);
  return Buffer.concat([...out, cd, fin]);
}
