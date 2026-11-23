import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  isMissingTableError,
  isSharedReceiverUrl,
  pagePeers,
  peerStatusText,
  phoneLabel,
  samePeers,
  sharedListText,
  sharedReceivers,
} from './receivers.ts';

const OWN = { userId: 'u-me', url: 'http://192.168.0.20:8765/tv/aB3xY9', name: 'Marcos' };

test('a shared receiver URL is exactly what the table accepts', () => {
  assert.equal(isSharedReceiverUrl('http://192.168.0.20:8765/tv/aB3xY9'), true);
  assert.equal(isSharedReceiverUrl('HTTP://10.0.0.2:8770/tv/000000'), true);
  for (const bad of [
    'https://192.168.0.20:8765/tv/aB3xY9',
    'http://phone.local:8765/tv/aB3xY9',
    'http://192.168.0.20/tv/aB3xY9',
    'http://192.168.0.20:8765/tv/aB3xY',
    'http://192.168.0.20:8765/tv/aB3xY9/',
    'http://192.168.0.20:8765/tv/aB3xY9?x',
    'http://192.168.0.20:8765/tv/aB3-Y9',
    '',
    null,
    42,
  ]) {
    assert.equal(isSharedReceiverUrl(bad), false, String(bad));
  }
});

test('each phone is labelled "MayLo de <nombre>"', () => {
  assert.equal(phoneLabel('Ana'), 'MayLo de Ana');
  assert.equal(phoneLabel('  Marcos  '), 'MayLo de Marcos');
  assert.equal(phoneLabel(''), 'MayLo');
  assert.equal(phoneLabel(null), 'MayLo');
  assert.equal(phoneLabel('x'.repeat(100)), `MayLo de ${'x'.repeat(40)}`);
});

test('this phone comes first with its current address, then the other member', () => {
  const rows = [
    { user_id: 'u-ana', url: 'http://192.168.0.30:8765/tv/Zz9Yy8', member_name: 'Ana' },
    // A stale row of this phone: its live address wins.
    { user_id: 'u-me', url: 'http://192.168.0.99:8765/tv/aB3xY9', member_name: 'Viejo' },
  ];
  assert.deepEqual(sharedReceivers(rows, OWN), [
    { userId: 'u-me', url: 'http://192.168.0.20:8765/tv/aB3xY9', name: 'Marcos', label: 'MayLo de Marcos', isOwn: true },
    { userId: 'u-ana', url: 'http://192.168.0.30:8765/tv/Zz9Yy8', name: 'Ana', label: 'MayLo de Ana', isOwn: false },
  ]);
  // Without any row (table empty or unavailable) only this phone is listed.
  assert.deepEqual(sharedReceivers([], OWN), [
    { userId: 'u-me', url: OWN.url, name: 'Marcos', label: 'MayLo de Marcos', isOwn: true },
  ]);
});

test('other rows with a bad URL or this phone\'s host:port are left out', () => {
  const rows = [
    { user_id: 'u-ana', url: 'http://192.168.0.20:8765/tv/Zz9Yy8', member_name: 'Ana' },
    { user_id: 'u-x', url: 'javascript:alert(1)', member_name: 'X' },
    { user_id: 'u-y', url: 'http://192.168.0.31:8766/tv/Qq1Ww2', member_name: null },
  ];
  assert.deepEqual(
    sharedReceivers(rows, OWN).map((receiver) => [receiver.userId, receiver.label]),
    [
      ['u-me', 'MayLo de Marcos'],
      ['u-y', 'MayLo'],
    ],
  );
});

test('the page gets the other phones only, and a change is detected', () => {
  const list = sharedReceivers(
    [{ user_id: 'u-ana', url: 'http://192.168.0.30:8765/tv/Zz9Yy8', member_name: 'Ana' }],
    OWN,
  );
  const peers = pagePeers(list);
  assert.deepEqual(peers, [{ url: 'http://192.168.0.30:8765/tv/Zz9Yy8', label: 'MayLo de Ana' }]);
  assert.equal(samePeers(peers, [{ url: 'http://192.168.0.30:8765/tv/Zz9Yy8', label: 'MayLo de Ana' }]), true);
  assert.equal(samePeers(peers, [{ url: 'http://192.168.0.31:8765/tv/Zz9Yy8', label: 'MayLo de Ana' }]), false);
  assert.equal(samePeers(peers, [{ url: 'http://192.168.0.30:8765/tv/Zz9Yy8', label: 'MayLo de Anita' }]), false);
  assert.equal(samePeers(peers, []), false);
  assert.equal(samePeers([], []), true);
});

test('a missing cast_receivers table is told apart from other failures', () => {
  assert.equal(isMissingTableError({ code: 'PGRST205', message: "Could not find the table 'public.cast_receivers' in the schema cache" }), true);
  assert.equal(isMissingTableError({ code: '42P01', message: 'relation "public.cast_receivers" does not exist' }), true);
  assert.equal(isMissingTableError({ message: 'relation "public.cast_receivers" does not exist' }), true);
  assert.equal(isMissingTableError({ code: '42501', message: 'permission denied' }), false);
  assert.equal(isMissingTableError(new TypeError('Network request failed')), false);
  assert.equal(isMissingTableError(null), false);
});

test('the connect screen explains when the shared list cannot be used', () => {
  assert.equal(sharedListText('ready'), null);
  assert.equal(sharedListText('loading'), null);
  assert.equal(
    sharedListText('missing'),
    'La lista compartida de teléfonos no está disponible todavía (falta la migración 0015 en Supabase). La tele recibe solo de este teléfono.',
  );
  assert.equal(
    sharedListText('error'),
    'No se pudo cargar la lista compartida de teléfonos. La tele recibe solo de este teléfono por ahora.',
  );
});

test('the other phone\'s status is seen from this phone', () => {
  assert.equal(peerStatusText(null), 'Comprobando…');
  assert.equal(peerStatusText(true), 'Responde desde este teléfono: está en casa con MayLo abierto');
  assert.equal(peerStatusText(false), 'No responde: fuera de casa o con MayLo cerrado');
});
