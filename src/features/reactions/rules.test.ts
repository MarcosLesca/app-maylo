import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MAX_EMOJI_LENGTH,
  MAX_MESSAGE_LENGTH,
  REACTION_EMOJIS,
  isFromOtherMember,
  parseReactionRow,
  reactionText,
  validateReaction,
} from './rules.ts';

test('the bar offers six emojis, each within the emoji limit', () => {
  assert.equal(REACTION_EMOJIS.length, 6);
  for (const emoji of REACTION_EMOJIS) assert.ok([...emoji].length <= MAX_EMOJI_LENGTH);
});

test('an emoji alone is a valid reaction', () => {
  assert.deepEqual(validateReaction({ emoji: '🔥' }), { ok: true, value: { emoji: '🔥', message: null } });
});

test('a short message alone is valid and is trimmed', () => {
  assert.deepEqual(validateReaction({ message: '  te extraño  ' }), {
    ok: true,
    value: { emoji: null, message: 'te extraño' },
  });
});

test('a message of exactly 80 characters is accepted, 81 is rejected', () => {
  assert.equal(MAX_MESSAGE_LENGTH, 80);
  assert.deepEqual(validateReaction({ message: 'a'.repeat(80) }), {
    ok: true,
    value: { emoji: null, message: 'a'.repeat(80) },
  });
  assert.deepEqual(validateReaction({ message: 'a'.repeat(81) }), {
    ok: false,
    error: 'El mensaje puede tener hasta 80 caracteres.',
  });
});

test('length counts characters like the database does, not UTF-16 units', () => {
  // 80 emojis are 160 UTF-16 units but 80 characters for Postgres char_length.
  const value = validateReaction({ message: '😀'.repeat(80) });
  assert.equal(value.ok, true);
});

test('an emoji longer than 16 characters is rejected', () => {
  assert.deepEqual(validateReaction({ emoji: 'x'.repeat(17) }), { ok: false, error: 'Elegí un emoji.' });
});

test('nothing, blank text or both kinds at once are rejected', () => {
  const empty = { ok: false, error: 'Elegí un emoji o escribí un mensaje.' };
  assert.deepEqual(validateReaction({}), empty);
  assert.deepEqual(validateReaction({ message: '   ' }), empty);
  assert.deepEqual(validateReaction({ emoji: '', message: '' }), empty);
  assert.deepEqual(validateReaction({ emoji: '🔥', message: 'hola' }), {
    ok: false,
    error: 'Mandá un emoji o un mensaje, no los dos.',
  });
});

test('only reactions from the other member float on my phone', () => {
  const theirs = { id: 'r1', created_by: 'her', emoji: '❤️', message: null, created_at: '2026-11-25T12:00:00Z' };
  const mine = { ...theirs, id: 'r2', created_by: 'me' };
  assert.equal(isFromOtherMember(theirs, 'me'), true);
  assert.equal(isFromOtherMember(mine, 'me'), false);
});

test('without a signed-in user nothing floats', () => {
  const theirs = { id: 'r1', created_by: 'her', emoji: '❤️', message: null, created_at: '2026-11-25T12:00:00Z' };
  assert.equal(isFromOtherMember(theirs, undefined), false);
});

test('realtime rows are read defensively', () => {
  const row = { id: 'r1', created_by: 'her', emoji: null, message: 'hola', created_at: '2026-11-25T12:00:00Z' };
  assert.deepEqual(parseReactionRow(row), row);
  assert.equal(parseReactionRow({ ...row, message: null }), null);
  assert.equal(parseReactionRow({ ...row, emoji: '🔥' }), null);
  assert.equal(parseReactionRow({ ...row, id: 3 }), null);
  assert.equal(parseReactionRow(null), null);
});

test('the shown text is the emoji or the message', () => {
  assert.equal(reactionText({ emoji: '🔥', message: null }), '🔥');
  assert.equal(reactionText({ emoji: null, message: 'hola' }), 'hola');
});
