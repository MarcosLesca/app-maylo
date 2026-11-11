import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatAmount, parseAmount, parseNote } from './notebook.ts';

test('parses amounts with comma or dot decimals', () => {
  assert.equal(parseAmount('635'), 635);
  assert.equal(parseAmount(' 12,5 '), 12.5);
  assert.equal(parseAmount('0.5'), 0.5);
  assert.equal(parseAmount('0'), 0);
});

test('an empty field clears the amount', () => {
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('   '), null);
});

test('rejects text, negatives and absurd values', () => {
  assert.equal(parseAmount('abc'), undefined);
  assert.equal(parseAmount('-5'), undefined);
  assert.equal(parseAmount('12g'), undefined);
  assert.equal(parseAmount('100000'), undefined);
});

test('formats amounts back for editing', () => {
  assert.equal(formatAmount(null), '');
  assert.equal(formatAmount(635), '635');
  assert.equal(formatAmount(12.5), '12,5');
});

test('dots grouping thousands are read as thousands', () => {
  assert.equal(parseAmount('1.000'), 1000);
  assert.equal(parseAmount('12.500'), 12500);
  assert.equal(parseAmount('1.000,5'), 1000.5);
});

test('meal notes are trimmed and an empty note clears it', () => {
  assert.equal(parseNote('  2 huevos y tostadas \n'), '2 huevos y tostadas');
  assert.equal(parseNote('avena\ncon banana'), 'avena\ncon banana');
  assert.equal(parseNote(''), null);
  assert.equal(parseNote('  \n '), null);
});
