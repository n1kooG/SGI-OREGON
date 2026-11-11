import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { plantilla, leerPlanilla, COLUMNAS } from '../src/excel.js';

test('plantilla: cabecera con estilo, ejemplo gris, validación de cantidad y hoja Instrucciones', async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await plantilla());
  const h = wb.getWorksheet('Ventas');
  assert.deepEqual(h.getRow(1).values.slice(1), COLUMNAS);
  assert.equal(h.getCell('A1').fill.fgColor.argb, 'FF0E3B38');
  assert.equal(h.views[0].ySplit, 1);
  assert.match(String(h.getCell('A2').value), /\(ejemplo\)/);
  assert.equal(h.getCell('E3').dataValidation.type, 'whole');
  assert.deepEqual(h.getCell('E3').dataValidation.formulae, [1]);
  assert.equal(wb.getWorksheet('Instrucciones').getRow(5).getCell(1).value, 'RUT CLIENTE');
});

test('plantilla: la fila de ejemplo no se importa, pero las filas reales sí', async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await plantilla());
  const solo = Buffer.from(await wb.xlsx.writeBuffer());
  await assert.rejects(() => leerPlanilla(solo), /no tiene filas de datos/);
  wb.getWorksheet('Ventas').addRow(['12.345.678-5', 'Ana Pérez', 'TH-4500', 'Hervidor', 3, 22990, 'Thomas']);
  const filas = await leerPlanilla(Buffer.from(await wb.xlsx.writeBuffer()));
  assert.equal(filas.length, 1);
  assert.equal(filas[0].sku, 'TH-4500');
  assert.equal(filas[0].cantidad, 3);
});
