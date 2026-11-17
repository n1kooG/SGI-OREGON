// Lista de precios del cliente (.xlsx): leer/validar y escribir con un cliente pg. Sin acceso a la base ni a la config,
// para que lo use también scripts/cargar-catalogo.mjs. La API (simular/aplicar) está en catalogoImportacion.js.
// Columnas (hoja 1): MARCA, CODIGO, PRODUCTOS, COSTO NETO (sin IVA), PVP (con IVA). Máximo MAX_FILAS filas (20.000).
// Precios (neto sin IVA): WEB = PVP/1,19 · MARKETPLACE = PVP×1,15/1,19 · MAYORISTA = costo×1,20.
import ExcelJS from 'exceljs';
import { AppError } from '../errors.js';
import { MAX_FILAS } from '../excel.js';
import { verificarXlsx } from '../xlsxSeguro.js';

const IVA = 1.19, RECARGO_MARKETPLACE = 1.15, MARGEN_MAYORISTA = 1.2;
export const invalido = (m) => new AppError(400, m, 'ARCHIVO_INVALIDO');
const num = (v) => { const x = typeof v === 'object' && v ? v.result : v; return typeof x === 'number' && Number.isFinite(x) ? x : null; };
const txt = (v) => String(typeof v === 'object' && v ? (v.result ?? v.text ?? '') : (v ?? '')).trim();
const r2 = (n) => Math.round(n * 100) / 100;

// Lee y valida sin escribir. Devuelve { filas, productos: [...], omitidas: [{fila, sku, motivo, texto}], bajoCosto: [...] }.
export async function leerCatalogo(buffer) {
  if (buffer.length < 4 || buffer.subarray(0, 2).toString() !== 'PK') throw invalido('El archivo no es un .xlsx válido');
  verificarXlsx(buffer, MAX_FILAS);
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch { throw invalido('El archivo no es un .xlsx válido'); }
  const ws = wb.worksheets[0];
  if (!ws) throw invalido('El libro no tiene hojas');
  let cab = 0;
  ws.eachRow((r, i) => { if (!cab && txt(r.getCell(2).value).toUpperCase() === 'CODIGO') cab = i; });
  if (!cab) throw invalido('No encuentro la fila de encabezados (columna B = CODIGO).');

  const productos = new Map();
  const omitidas = [];
  let filas = 0;
  ws.eachRow((r, i) => {
    if (i <= cab) return;
    const sku = txt(r.getCell(2).value).toUpperCase();
    const nombre = txt(r.getCell(3).value), marca = txt(r.getCell(1).value);
    const costo = num(r.getCell(4).value), pvp = num(r.getCell(5).value);
    if (!sku && !nombre) return; // fila vacía
    filas++;
    if (!sku || !nombre || !marca || !(costo > 0) || !(pvp > 0) || sku.length > 30) {
      omitidas.push({ fila: i, sku, motivo: sku.length > 30 ? 'código de más de 30 caracteres' : 'datos incompletos', texto: `fila ${i}: ${sku || '(sin código)'} ${nombre} — datos incompletos` });
      return;
    }
    if (productos.has(sku)) { omitidas.push({ fila: i, sku, motivo: 'repetido', texto: `fila ${i}: ${sku} repetido` }); return; }
    productos.set(sku, { sku, nombre: nombre.slice(0, 150), marca: marca.slice(0, 60), costo: r2(costo),
      precios: { WEB: r2(pvp / IVA), MARKETPLACE: r2((pvp * RECARGO_MARKETPLACE) / IVA), MAYORISTA: r2(costo * MARGEN_MAYORISTA) } });
  });
  if (!filas) throw invalido('La planilla no tiene filas de datos');
  const lista = [...productos.values()];
  return { filas, productos: lista, omitidas, bajoCosto: lista.filter((p) => Object.values(p.precios).some((x) => x <= p.costo)) };
}

// Upsert de producto, inventario (solo si falta) y precios dentro de la transacción ya abierta en `c`.
export async function escribirCatalogo(c, productos) {
  for (const p of productos) {
    await c.query(
      `INSERT INTO producto (sku, modelo, nombre, marca, costo_adquisicion_neto, estado) VALUES ($1,$1,$2,$3,$4,'ACTIVO')
       ON CONFLICT (sku) DO UPDATE SET nombre = EXCLUDED.nombre, marca = EXCLUDED.marca, costo_adquisicion_neto = EXCLUDED.costo_adquisicion_neto
`, [p.sku, p.nombre, p.marca, p.costo]);
    await c.query(`INSERT INTO inventario (sku, stock_fisico) VALUES ($1, 0) ON CONFLICT (sku) DO NOTHING`, [p.sku]);
    for (const [canal, precio] of Object.entries(p.precios)) {
      await c.query(`INSERT INTO lista_precio (sku, canal_venta, precio_venta_neto) VALUES ($1,$2,$3)
        ON CONFLICT (sku, canal_venta) DO UPDATE SET precio_venta_neto = EXCLUDED.precio_venta_neto`, [p.sku, canal, precio]);
    }
  }
}
