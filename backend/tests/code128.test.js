import test from 'node:test';
import assert from 'node:assert/strict';
import { code128B } from '../src/pdf/code128.js';

test('Code 128-B: cada símbolo suma 11 módulos y la parada 13', () => {
  const m = code128B('ORD-1024'); // start + 8 datos + checksum + stop
  assert.equal(m.reduce((a, b) => a + b, 0), 11 * 10 + 13);
});

test('Code 128-B: "A" = start B + 111323 + checksum 34 + parada', () => {
  assert.equal(code128B('A').join(''), '211214' + '111323' + '131123' + '2331112');
});

test('Code 128-B rechaza vacío y no ASCII', () => {
  assert.throws(() => code128B(''));
  assert.throws(() => code128B('ñ'));
});
