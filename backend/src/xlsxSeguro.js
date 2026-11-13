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

// Mide el contenido real de una hoja (no lo que declara <dimension>): mayor número de fila, nº de filas y mayor columna (por la
// referencia de la celda o por su posición). Recorrido lineal con indexOf: cada etiqueta se acota a TAG_MAX para que una hoja
// hostil no provoque retrocesos de expresiones regulares.
const TAG_MAX = 2048;
const ATTR_R = /\sr\s*=\s*["']([A-Za-z]*)(\d*)["']/;
function medir(xml, maxFilas) {
  let filas = 0, mayorFila = 0, columnas = 0, enFila = 0, pos = 0;
  while ((pos = xml.indexOf('<', pos)) >= 0) {
    // El cierre '>' se busca respetando las comillas de los atributos (un '>' dentro de un valor no cierra la etiqueta) y con tope de largo.
    let fin = pos + 1, comilla = '';
    for (; fin < xml.length && fin - pos <= TAG_MAX; fin++) {
      const c = xml[fin];
      if (comilla) { if (c === comilla) comilla = ''; } else if (c === '"' || c === "'") comilla = c; else if (c === '>') break; else if (c === '<') throw NO_VALIDO();
    }
    if (fin >= xml.length || xml[fin] !== '>') throw NO_VALIDO();
    const etiqueta = xml.slice(pos, fin);
    pos = fin;
    const esFila = /^<row(?=[\s/]|$)/.test(etiqueta), esCelda = /^<c(?=[\s/]|$)/.test(etiqueta);
    if (esFila) {
      filas++; enFila = 0;
      const r = ATTR_R.exec(etiqueta);
      if (r?.[2]) mayorFila = Math.max(mayorFila, Number(r[2]));
      if (Math.max(filas, mayorFila) - 1 > maxFilas) return { filas: Math.max(filas, mayorFila), columnas }; // ya excede: no hace falta seguir
    } else if (esCelda) {
      enFila++;
      const r = ATTR_R.exec(etiqueta);
      columnas = Math.max(columnas, enFila, r?.[1] ? colNum(r[1].toUpperCase()) : 0);
    }
  }
  return { filas: Math.max(filas, mayorFila), columnas };
}

// Lanza AppError 400/413 si el archivo excede los límites. `maxFilas` cuenta las filas de datos (sin la cabecera).
// Se infla TODA parte con un tope acumulado sobre lo realmente descomprimido (no sobre lo declarado) y se miden las hojas por su contenido.
export function verificarXlsx(buffer, maxFilas) {
  const lista = entradas(buffer);
  const vistos = new Set();
  let declarado = 0, real = 0, hojas = 0;
  for (const e of lista) {
    if (e.cifrado || (e.metodo !== 0 && e.metodo !== 8) || (e.metodo === 0 && e.comprimido !== e.tamano)) throw NO_VALIDO();
    if (e.nombre.startsWith('/') || e.nombre.includes('\\') || e.nombre.split('/').includes('..') || vistos.has(e.nombre.toLowerCase())) throw NO_VALIDO(); // rutas ambiguas: otro lector podría interpretarlas distinto
    vistos.add(e.nombre.toLowerCase());
    declarado += e.tamano;
    if (declarado > LIMITES.descomprimido) throw rechazo(`El archivo descomprimido supera ${LIMITES.descomprimido / 1024 / 1024} MB`, 413);
  }
  for (const e of lista) {
    if (e.nombre.endsWith('/')) continue; // directorio
    const datos = datosDe(buffer, e, LIMITES.descomprimido - real);
    real += datos.length;
    if (real > LIMITES.descomprimido) throw rechazo(`El archivo descomprimido supera ${LIMITES.descomprimido / 1024 / 1024} MB`, 413);
    if (!/(^|\/)worksheets\/[^/]*\.xml$/i.test(e.nombre)) continue; // mismo criterio laxo que ExcelJS: cualquier .xml bajo «worksheets/»
    if (++hojas > LIMITES.hojas) throw rechazo(`El libro tiene demasiadas hojas (máximo ${LIMITES.hojas})`);
    const { filas, columnas } = medir(datos.toString('utf8'), maxFilas);
    if (filas - 1 > maxFilas) throw rechazo(`La planilla supera ${maxFilas} filas`);
    if (columnas > LIMITES.columnas) throw rechazo(`La planilla supera ${LIMITES.columnas} columnas`);
  }
}
