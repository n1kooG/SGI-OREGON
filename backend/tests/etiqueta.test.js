import test from 'node:test';
import assert from 'node:assert/strict';
import { dibujarEtiqueta } from '../src/services/pedidos.js';
import { paginar, partirCodigo } from '../src/pdf/etiqueta.js';
import { crearPdf } from '../src/pdf/estilo.js';

const generar = (o, rut) => new Promise((ok) => {
  const doc = crearPdf('Etiqueta de prueba', { size: [283, 425] }), p = [];
  doc.on('data', (b) => p.push(b)).on('end', () => ok(Buffer.concat(p)));
  dibujarEtiqueta(doc, o, rut);
  doc.end();
});

test('etiqueta: código de 30+ caracteres, datos largos y 9 ítems se dibujan sin error y la tarjeta de armado pagina', async () => {
  const items = Array.from({ length: 9 }, (_, i) => ({ sku: `SKU-LARGO-${i}`, nombre: 'Producto con un nombre muy largo para la tabla '.repeat(2), ubicacion_bodega: 'Pasillo Z - Estante 12 - Nivel 3', cantidad: i + 1 }));
  const o = { codigo_externo: 'etq-mercadolibre-importacion-001', canal_origen: 'Venta Directa Web Mayorista', nombre_cliente: 'Comercializadora y Distribuidora Internacional del Sur SpA', direccion_despacho: 'Avenida Libertador Bernardo O’Higgins 12345, Departamento 1204, Torre B', comuna: 'San Pedro de la Paz de los Andes', telefono_contacto: '+56 9 8765 4321', numero_documento_sii: '123456', fecha_orden: new Date(), items };
  const pdf = await generar(o, '12345678-5');
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok((pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length >= 2, 'los 9 ítems no caben en la primera hoja');
  assert.ok(!pdf.toString('latin1').includes('PDFKit'), 'metadatos propios');
  await generar({ ...o, direccion_despacho: null, comuna: null, telefono_contacto: null, items: [] }, null); // sin dirección ni ítems
});

test('etiqueta: un pedido corto cabe en una sola hoja', async () => {
  const o = { codigo_externo: 'ORD-1', canal_origen: 'Paris', nombre_cliente: 'Ana', direccion_despacho: 'Calle 1', comuna: 'Ñuñoa', fecha_orden: new Date(), items: [{ sku: 'A', nombre: 'Uno', cantidad: 1 }] };
  assert.equal(((await generar(o, null)).toString('latin1').match(/\/Type \/Page\b/g) ?? []).length, 1);
});

test('paginar: respeta la capacidad de cada hoja y nunca parte un ítem', () => {
  assert.deepEqual(paginar([30, 30, 30, 30, 30], 70, 100), [[0, 1], [2, 3, 4]]);
  assert.deepEqual(paginar([], 70, 100), [[]]);
  assert.deepEqual(paginar([90], 70, 100), [[], [0]]); // no cabe en la primera: pasa entero a la siguiente
});

test('partirCodigo: usa 1 línea si cabe, divide y recorta con «…» si es muy largo', () => {
  assert.deepEqual(partirCodigo('3248404545', 96).lineas, ['3248404545']);
  const dos = partirCodigo('etq-mercadolibre-importacion-001-extra', 96);
  assert.equal(dos.lineas.length, 2);
  assert.equal(dos.lineas.join(''), 'etq-mercadolibre-importacion-001-extra');
  const largo = partirCodigo('X'.repeat(200), 96);
  assert.equal(largo.lineas.length, 3);
  assert.ok(largo.lineas.at(-1).endsWith('…') && largo.tam >= 7);
});
