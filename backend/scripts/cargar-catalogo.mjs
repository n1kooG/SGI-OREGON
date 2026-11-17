// Carga el catálogo del cliente desde su lista de precios (.xlsx). Sin --aplicar solo simula (no escribe).
//   node --env-file=.env scripts/cargar-catalogo.mjs <archivo.xlsx> [--aplicar]
// Columnas: MARCA, CODIGO, PRODUCTOS, COSTO NETO (sin IVA), PVP (con IVA). Hoja: la primera.
// Precios (neto sin IVA): WEB = PVP/1,19 · MARKETPLACE = PVP×1,15/1,19 · MAYORISTA = costo×1,20.
// Idempotente: crea o actualiza producto y precios; el stock y la ubicación de un SKU existente no se tocan (nuevo: stock 0).
import { readFile } from 'node:fs/promises';
import { conectar, fallar } from './_comun.mjs';
import { leerCatalogo, escribirCatalogo } from '../src/services/catalogoXlsx.js';

const [archivo, ...flags] = process.argv.slice(2);
if (!archivo) fallar('Uso: node --env-file=.env scripts/cargar-catalogo.mjs <archivo.xlsx> [--aplicar]');
const aplicar = flags.includes('--aplicar');

let leido;
try { leido = await leerCatalogo(await readFile(archivo)); } catch (e) { fallar(e.message); }
const { productos, omitidas, bajoCosto } = leido;

console.log(`Productos válidos: ${productos.length} · omitidas: ${omitidas.length}`);
omitidas.forEach((o) => console.log('  omitida →', o.texto));
bajoCosto.forEach((p) => console.log(`  precio ≤ costo (la base lo rechazaría): ${p.sku}`));
if (bajoCosto.length) fallar('Corrige los precios antes de aplicar.');
if (!aplicar) { console.log('Simulación: no se escribió nada. Ejemplo:', JSON.stringify(productos[0])); process.exit(0); }

const c = await conectar();
try {
  await c.query('BEGIN');
  await escribirCatalogo(c, productos);
  await c.query('COMMIT');
  console.log(`Aplicado: ${productos.length} productos con precios WEB, MARKETPLACE y MAYORISTA.`);
} catch (e) { await c.query('ROLLBACK'); fallar(e.message); } finally { await c.end(); }
