// Carga el catálogo del cliente desde su lista de precios (.xlsx). Sin --aplicar solo simula (no escribe).
//   node --env-file=.env scripts/cargar-catalogo.mjs <archivo.xlsx> [--aplicar]
// Columnas: MARCA, CODIGO, PRODUCTOS, COSTO NETO (sin IVA), PVP (con IVA). Hoja: la primera.
// Precios (neto sin IVA): WEB = PVP/1,19 · MARKETPLACE = PVP×1,15/1,19 · MAYORISTA = costo×1,20.
// Idempotente: crea o actualiza producto y precios; el stock y la ubicación de un SKU existente no se tocan (nuevo: stock 0).
import ExcelJS from 'exceljs';
import { conectar, fallar } from './_comun.mjs';

const IVA = 1.19, RECARGO_MARKETPLACE = 1.15, MARGEN_MAYORISTA = 1.2;
const [archivo, ...flags] = process.argv.slice(2);
if (!archivo) fallar('Uso: node --env-file=.env scripts/cargar-catalogo.mjs <archivo.xlsx> [--aplicar]');
const aplicar = flags.includes('--aplicar');

const num = (v) => { const x = typeof v === 'object' && v ? v.result : v; return typeof x === 'number' && Number.isFinite(x) ? x : null; };
const txt = (v) => String(typeof v === 'object' && v ? (v.result ?? v.text ?? '') : (v ?? '')).trim();
const r2 = (n) => Math.round(n * 100) / 100;

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(archivo);
const ws = wb.worksheets[0];
let cab = 0;
ws.eachRow((r, i) => { if (!cab && txt(r.getCell(2).value).toUpperCase() === 'CODIGO') cab = i; });
if (!cab) fallar('No encuentro la fila de encabezados (columna B = CODIGO).');

const productos = new Map();
const omitidas = [];
ws.eachRow((r, i) => {
  if (i <= cab) return;
  const sku = txt(r.getCell(2).value).toUpperCase();
  const nombre = txt(r.getCell(3).value), marca = txt(r.getCell(1).value);
  const costo = num(r.getCell(4).value), pvp = num(r.getCell(5).value);
  if (!sku && !nombre) return; // fila vacía
  if (!sku || !nombre || !marca || !(costo > 0) || !(pvp > 0) || sku.length > 30) { omitidas.push(`fila ${i}: ${sku || '(sin código)'} ${nombre} — datos incompletos`); return; }
  if (productos.has(sku)) { omitidas.push(`fila ${i}: ${sku} repetido`); return; }
  const web = r2(pvp / IVA);
  productos.set(sku, { sku, nombre: nombre.slice(0, 150), marca: marca.slice(0, 60), costo: r2(costo),
    precios: { WEB: web, MARKETPLACE: r2((pvp * RECARGO_MARKETPLACE) / IVA), MAYORISTA: r2(costo * MARGEN_MAYORISTA) } });
});

const bajoCosto = [...productos.values()].filter((p) => Object.values(p.precios).some((x) => x <= p.costo));
console.log(`Productos válidos: ${productos.size} · omitidas: ${omitidas.length}`);
omitidas.forEach((o) => console.log('  omitida →', o));
bajoCosto.forEach((p) => console.log(`  precio ≤ costo (la base lo rechazaría): ${p.sku}`));
if (bajoCosto.length) fallar('Corrige los precios antes de aplicar.');
if (!aplicar) { console.log('Simulación: no se escribió nada. Ejemplo:', JSON.stringify([...productos.values()][0])); process.exit(0); }

const c = await conectar();
try {
  await c.query('BEGIN');
  for (const p of productos.values()) {
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
  await c.query('COMMIT');
  console.log(`Aplicado: ${productos.size} productos con precios WEB, MARKETPLACE y MAYORISTA.`);
} catch (e) { await c.query('ROLLBACK'); fallar(e.message); } finally { await c.end(); }
