import assert from 'node:assert/strict';
import { test } from 'node:test';

import { paletteFor } from './palette.ts';

const base = {
  text: '#111111',
  accent: '#F26B3A',
  onAccent: '#2B1206',
  accentText: '#A23D14',
  accentSoft: '#FFE3D3',
  success: '#4E9F3D',
  onSuccess: '#FFFFFF',
  onSuccessLabel: '#0E1A0A',
  successText: '#2F6B22',
  successSoft: '#E3F2DC',
};

test('the mustache member keeps the orange accent', () => {
  assert.deepEqual(paletteFor(base, 'mustache'), base);
});

test('no member (signed out) keeps the default palette', () => {
  assert.deepEqual(paletteFor(base, null), base);
});

test('the dumbbell member gets green as accent and orange for done items', () => {
  const p = paletteFor(base, 'dumbbell');
  assert.equal(p.accent, base.success);
  assert.equal(p.accentText, base.successText);
  assert.equal(p.accentSoft, base.successSoft);
  assert.equal(p.success, base.accent);
  assert.equal(p.successText, base.accentText);
  assert.equal(p.successSoft, base.accentSoft);
  assert.equal(p.text, base.text);
});

test('labels on the green accent use the dark readable color, not white', () => {
  const p = paletteFor(base, 'dumbbell');
  assert.equal(p.onAccent, base.onSuccessLabel);
  assert.equal(p.onSuccess, base.onAccent);
});
