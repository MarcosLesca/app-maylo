import assert from 'node:assert/strict';
import { test } from 'node:test';

import { linkMediaSession, mediaStateOf } from './media-link.ts';

type State = Parameters<typeof mediaStateOf>[0];

const base: State = {
  active: true,
  title: 'Capítulo 3',
  targetName: 'Hisense',
  playing: true,
  position: 12,
  duration: 1500,
};

function fakeSession(initial: State) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(patch: Partial<State>) {
      state = { ...state, ...patch };
      for (const listener of listeners) listener();
    },
    listenerCount: () => listeners.size,
  };
}

function fakeConnect() {
  const log: string[] = [];
  const updates: unknown[] = [];
  const connect = () => {
    log.push('connect');
    return {
      update: (s: unknown) => {
        updates.push(s);
      },
      dispose: () => {
        log.push('dispose');
      },
    };
  };
  return { connect, log, updates };
}

test('mediaStateOf shows the sender, else the TV name', () => {
  assert.deepEqual(mediaStateOf({ ...base, sender: 'May' }), {
    title: 'Capítulo 3',
    subtitle: 'Enviado por May',
    playing: true,
    position: 12,
    duration: 1500,
  });
  assert.equal(mediaStateOf(base).subtitle, 'En Hisense');
  assert.equal(mediaStateOf({ ...base, targetName: '' }).subtitle, 'En la tele');
});

test('an active session connects at once and pushes its state', () => {
  const session = fakeSession(base);
  const native = fakeConnect();
  linkMediaSession(session, native.connect);
  assert.deepEqual(native.log, ['connect']);
  assert.equal(native.updates.length, 1);
});

test('an idle session does not connect until it becomes active', () => {
  const session = fakeSession({ ...base, active: false });
  const native = fakeConnect();
  linkMediaSession(session, native.connect);
  assert.deepEqual(native.log, []);
  session.set({ active: true });
  assert.deepEqual(native.log, ['connect']);
  session.set({ position: 20 });
  assert.equal(native.updates.length, 2);
  assert.deepEqual(native.log, ['connect']);
});

test('ending the session disposes the bridge; a new session connects again', () => {
  const session = fakeSession(base);
  const native = fakeConnect();
  linkMediaSession(session, native.connect);
  session.set({ active: false });
  assert.deepEqual(native.log, ['connect', 'dispose']);
  session.set({ position: 30 });
  assert.equal(native.updates.length, 1);
  session.set({ active: true });
  assert.deepEqual(native.log, ['connect', 'dispose', 'connect']);
});

test('unlink stops listening and disposes an open bridge', () => {
  const session = fakeSession(base);
  const native = fakeConnect();
  const unlink = linkMediaSession(session, native.connect);
  unlink();
  assert.deepEqual(native.log, ['connect', 'dispose']);
  assert.equal(session.listenerCount(), 0);
});
