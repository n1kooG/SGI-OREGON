// Pre-validación de un .xlsx NO confiable antes de entregarlo a ExcelJS, que descomprime y carga todo en memoria: un archivo
// de 1,4 MB puede declarar 1 GB de XML (bomba de descompresión) y tumbar el proceso (hallazgo 3 de la auditoría).
// Se lee el directorio central del ZIP (sin descomprimir nada) y solo se infla cada hoja con un tope de salida, que
// también cubre a los archivos que mienten sobre el tamaño descomprimido en su cabecera.
import { inflateRawSync } from 'node:zlib';
import { AppError } from './errors.js';

export const LIMITES = {
  descomprimido: 40 * 1024 * 1024, // suma de todas las partes; una planilla real de 20.000 filas pesa unos pocos MB
  entradas: 200,
  hojas: 10,
  columnas: 50, // la planilla tiene 7
};
const rechazo = (m, status = 400) => new AppError(status, m, 'ARCHIVO_INVALIDO');
const NO_VALIDO = () => rechazo('El archivo no es un .xlsx válido');

function entradas(buf) {
  const desde = Math.max(0, buf.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = buf.length - 22; i >= desde; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw NO_VALIDO();
  const total = buf.readUInt16LE(eocd + 10), offCd = buf.readUInt32LE(eocd + 16);
  if (total === 0xffff || offCd === 0xffffffff) throw rechazo('El archivo es demasiado grande'); // ZIP64: no corresponde a una planilla de este tamaño
  if (total > LIMITES.entradas) throw rechazo(`El archivo contiene demasiadas partes (máximo ${LIMITES.entradas})`);
  const lista = [];
  let p = offCd;
  for (let n = 0; n < total; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw NO_VALIDO();
    const nombreLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), comLen = buf.readUInt16LE(p + 32);
    if (p + 46 + nombreLen > buf.length) throw NO_VALIDO();
    lista.push({
      nombre: buf.toString('utf8', p + 46, p + 46 + nombreLen), cifrado: (buf.readUInt16LE(p + 8) & 1) === 1, metodo: buf.readUInt16LE(p + 10),
      comprimido: buf.readUInt32LE(p + 20), tamano: buf.readUInt32LE(p + 24), offset: buf.readUInt32LE(p + 42),
    });
    p += 46 + nombreLen + extraLen + comLen;
  }
  return lista;
}

function datosDe(buf, e, maxSalida) {
  const o = e.offset;
  if (o + 30 > buf.length || buf.readUInt32LE(o) !== 0x04034b50) throw NO_VALIDO();
  const ini = o + 30 + buf.readUInt16LE(o + 26) + buf.readUInt16LE(o + 28);
  if (ini + e.comprimido > buf.length) throw NO_VALIDO();
  const crudo = buf.subarray(ini, ini + e.comprimido);
  if (e.metodo === 0) return crudo;
  try { return inflateRawSync(crudo, { maxOutputLength: maxSalida }); } catch (e2) {
    throw e2.code === 'ERR_BUFFER_TOO_LARGE' ? rechazo('El contenido del archivo es demasiado grande', 413) : NO_VALIDO();
  }
}

const colNum = (letras) => [...letras].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);

// Lanza AppError 400/413 si el archivo excede los límites. `maxFilas` cuenta las filas de datos (sin la cabecera).
export function verificarXlsx(buffer, maxFilas) {
  const lista = entradas(buffer);
  let total = 0;
  for (const e of lista) {
    if (e.cifrado || (e.metodo !== 0 && e.metodo !== 8)) throw NO_VALIDO();
    total += e.tamano;
    if (total > LIMITES.descomprimido) throw rechazo(`El archivo descomprimido supera ${LIMITES.descomprimido / 1024 / 1024} MB`, 413);
  }
  const hojas = lista.filter((e) => /^xl\/worksheets\/[^/]+\.xml$/i.test(e.nombre));
  if (hojas.length > LIMITES.hojas) throw rechazo(`El libro tiene demasiadas hojas (máximo ${LIMITES.hojas})`);
  for (const h of hojas) {
    const xml = datosDe(buffer, h, h.tamano + 1024).toString('utf8'); // el tope es lo declarado: si miente, ERR_BUFFER_TOO_LARGE
    const dim = /<dimension\s+ref="([A-Z]+)?(\d+)?(?::([A-Z]+)(\d+))?"/.exec(xml);
    let filas = dim ? Number(dim[4] ?? dim[2] ?? 0) : 0, columnas = dim ? colNum(dim[3] ?? dim[1] ?? '') : 0;
    if (!dim) { // sin <dimension> (opcional): se mide con las filas del XML
      const ult = xml.lastIndexOf('<row ');
      filas = ult < 0 ? 0 : Number(/\sr="(\d+)"/.exec(xml.slice(ult, ult + 200))?.[1] ?? 0);
    }
    if (filas - 1 > maxFilas) throw rechazo(`La planilla supera ${maxFilas} filas`);
    if (columnas > LIMITES.columnas) throw rechazo(`La planilla supera ${LIMITES.columnas} columnas`);
  }
}
