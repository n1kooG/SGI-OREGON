import test from 'node:test';
import assert from 'node:assert/strict';
import PDFDocument from 'pdfkit';
import { dibujarEtiqueta } from '../src/services/pedidos.js';

const generar = (o, rut) => new Promise((ok) => {
  const doc = new PDFDocument({ size: [283, 425], margin: 0 }), p = [];
  doc.on('data', (b) => p.push(b)).on('end', () => ok(Buffer.concat(p)));
  dibujarEtiqueta(doc, o, rut);
  doc.end();
});

test('etiqueta: código de 30+ caracteres, datos largos y 9 ítems se dibujan sin error y en una página', async () => {
  const items = Array.from({ length: 9 }, (_, i) => ({ sku: `SKU-LARGO-${i}`, nombre: 'Producto con un nombre muy largo para la tabla '.repeat(2), ubicacion_bodega: 'Pasillo Z - Estante 12 - Nivel 3', cantidad: i + 1 }));
  const o = { codigo_externo: 'etq-mercadolibre-importacion-001', canal_origen: 'Venta Directa Web Mayorista', nombre_cliente: 'Comercializadora y Distribuidora Internacional del Sur SpA', direccion_despacho: 'Avenida Libertador Bernardo O’Higgins 12345, Departamento 1204, Torre B', comuna: 'San Pedro de la Paz de los Andes', telefono_contacto: '+56 9 8765 4321', numero_documento_sii: '123456', fecha_orden: new Date(), items };
  const pdf = await generar(o, '12345678-5');
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length, 1);
  await generar({ ...o, direccion_despacho: null, comuna: null, telefono_contacto: null, items: [] }, null); // sin dirección ni ítems
});
