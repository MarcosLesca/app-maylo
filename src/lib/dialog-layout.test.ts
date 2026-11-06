import assert from 'node:assert/strict';
import { test } from 'node:test';

import { layoutDialog } from './dialog-layout.ts';

test('a dialog without buttons gets a single acknowledge button', () => {
  const layout = layoutDialog(undefined);
  assert.equal(layout.direction, 'row');
  assert.deepEqual(layout.buttons.map((b) => b.text), ['Entendido']);
});

test('two buttons sit side by side with cancel first', () => {
  const layout = layoutDialog([
    { text: 'Eliminar', style: 'destructive' },
    { text: 'Cancelar', style: 'cancel' },
  ]);
  assert.equal(layout.direction, 'row');
  assert.deepEqual(layout.buttons.map((b) => b.text), ['Cancelar', 'Eliminar']);
});

test('three or more buttons stack vertically with cancel last', () => {
  const layout = layoutDialog([
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Sacar foto' },
    { text: 'Desde la galería' },
    { text: 'Archivo PDF' },
  ]);
  assert.equal(layout.direction, 'column');
  assert.deepEqual(layout.buttons.map((b) => b.text), ['Sacar foto', 'Desde la galería', 'Archivo PDF', 'Cancelar']);
});

test('tapping outside acts as the cancel button, or just closes when there is none', () => {
  const onCancel = () => undefined;
  assert.equal(layoutDialog([{ text: 'No', style: 'cancel', onPress: onCancel }, { text: 'Sí' }]).dismiss?.onPress, onCancel);
  assert.equal(layoutDialog([{ text: 'Reiniciar' }]).dismiss, null);
});
