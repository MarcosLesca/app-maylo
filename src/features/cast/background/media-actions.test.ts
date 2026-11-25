import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createMediaSessionBridge,
  dispatchMediaAction,
  toNativeState,
  VOLUME_STEP,
  type MediaControls,
  type NativeMediaSession,
} from './media-actions.ts';

function recorder() {
  const calls: string[] = [];
  const controls: MediaControls = {
    play: () => void calls.push('play'),
    pause: () => void calls.push('pause'),
    seekBy: (s) => void calls.push(`seekBy ${s}`),
    changeVolume: (d) => void calls.push(`changeVolume ${d}`),
    stop: () => void calls.push('stop'),
  };
  return { calls, controls };
}

test('each native action calls its control once', () => {
  const { calls, controls } = recorder();
  assert.equal(dispatchMediaAction({ action: 'play' }, controls), true);
  assert.equal(dispatchMediaAction({ action: 'pause' }, controls), true);
  assert.equal(dispatchMediaAction({ action: 'seekBy', seconds: -10 }, controls), true);
  assert.equal(dispatchMediaAction({ action: 'seekBy', seconds: 10 }, controls), true);
  assert.equal(dispatchMediaAction({ action: 'stop' }, controls), true);
  assert.deepEqual(calls, ['play', 'pause', 'seekBy -10', 'seekBy 10', 'stop']);
});

test('volume buttons change the TV volume one step per press', () => {
  const { calls, controls } = recorder();
  assert.equal(dispatchMediaAction({ action: 'volume', direction: 1 }, controls), true);
  assert.equal(dispatchMediaAction({ action: 'volume', direction: -1 }, controls), true);
  assert.deepEqual(calls, [`changeVolume ${VOLUME_STEP}`, `changeVolume ${-VOLUME_STEP}`]);
});

test('malformed or unknown actions call nothing', () => {
  const { calls, controls } = recorder();
  for (const bad of [
    null,
    undefined,
    'play',
    {},
    { action: 'next' },
    { action: 'seekBy' },
    { action: 'seekBy', seconds: 0 },
    { action: 'seekBy', seconds: Number.NaN },
    { action: 'seekBy', seconds: '10' },
    { action: 'volume' },
    { action: 'volume', direction: 0 },
    { action: 'volume', direction: 2 },
  ]) {
    assert.equal(dispatchMediaAction(bad, controls), false, JSON.stringify(bad));
  }
  assert.deepEqual(calls, []);
});

test('a rejected control does not escape as an unhandled rejection', async () => {
  const controls: MediaControls = {
    play: () => Promise.reject(new Error('TV gone')),
    pause: () => undefined,
    seekBy: () => undefined,
    changeVolume: () => undefined,
    stop: () => undefined,
  };
  let unhandled = false;
  const onUnhandled = () => {
    unhandled = true;
  };
  process.on('unhandledRejection', onUnhandled);
  assert.equal(dispatchMediaAction({ action: 'play' }, controls), true);
  await new Promise((resolve) => setTimeout(resolve, 10));
  process.off('unhandledRejection', onUnhandled);
  assert.equal(unhandled, false);
});

test('state in seconds becomes the native payload in whole milliseconds', () => {
  assert.deepEqual(
    toNativeState({ title: 'Peli', subtitle: 'Enviado por Lo', playing: true, position: 83.4567, duration: 5400 }),
    { title: 'Peli', subtitle: 'Enviado por Lo', playing: true, positionMs: 83457, durationMs: 5400000 },
  );
});

test('missing or unknown fields are left out of the native payload', () => {
  assert.deepEqual(toNativeState({ playing: false }), { playing: false });
  assert.deepEqual(toNativeState({ position: null, duration: null }), {});
  assert.deepEqual(toNativeState({ position: -3, duration: Number.NaN }), { positionMs: 0 });
  assert.deepEqual(toNativeState({}), {});
});

function fakeNative() {
  const calls: { method: string; payload?: unknown }[] = [];
  let listener: ((event: unknown) => void) | null = null;
  let removed = 0;
  const native: NativeMediaSession = {
    start: async (payload) => void calls.push({ method: 'start', payload }),
    update: async (payload) => void calls.push({ method: 'update', payload }),
    stop: async () => void calls.push({ method: 'stop' }),
    addListener: (fn) => {
      listener = fn;
      return {
        remove: () => {
          removed += 1;
          listener = null;
        },
      };
    },
  };
  return {
    calls,
    native,
    emit: (event: unknown) => listener?.(event),
    removed: () => removed,
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test('the first update starts the session, later ones update it with the full state', async () => {
  const fake = fakeNative();
  const { controls } = recorder();
  const bridge = createMediaSessionBridge(fake.native, controls);
  bridge.update({ title: 'Peli', subtitle: 'Enviado por May', playing: true, position: 1, duration: 60 });
  await flush();
  bridge.update({ playing: false, position: 2 });
  await flush();
  assert.deepEqual(fake.calls, [
    {
      method: 'start',
      payload: { title: 'Peli', subtitle: 'Enviado por May', playing: true, positionMs: 1000, durationMs: 60000 },
    },
    {
      method: 'update',
      payload: { title: 'Peli', subtitle: 'Enviado por May', playing: false, positionMs: 2000, durationMs: 60000 },
    },
  ]);
});

test('native actions reach the controls until dispose, which stops the session once', async () => {
  const fake = fakeNative();
  const { calls, controls } = recorder();
  const bridge = createMediaSessionBridge(fake.native, controls);
  bridge.update({ title: 'Peli', playing: true });
  await flush();
  fake.emit({ action: 'seekBy', seconds: 10 });
  fake.emit({ action: 'volume', direction: -1 });
  bridge.dispose();
  bridge.dispose();
  fake.emit({ action: 'play' });
  bridge.update({ playing: false });
  await flush();
  assert.deepEqual(calls, ['seekBy 10', `changeVolume ${-VOLUME_STEP}`]);
  assert.equal(fake.removed(), 1);
  assert.deepEqual(
    fake.calls.map((c) => c.method),
    ['start', 'stop'],
  );
});

test('a failed start is retried on the next update', async () => {
  const fake = fakeNative();
  let failNext = true;
  const start = fake.native.start;
  fake.native.start = async (payload) => {
    if (failNext) {
      failNext = false;
      throw new Error('ERR_FGS_NOT_ALLOWED');
    }
    return start(payload);
  };
  const bridge = createMediaSessionBridge(fake.native, recorder().controls);
  bridge.update({ title: 'Peli', playing: true });
  await flush();
  bridge.update({ position: 5 });
  await flush();
  assert.deepEqual(fake.calls, [
    { method: 'start', payload: { title: 'Peli', playing: true, positionMs: 5000 } },
  ]);
});

test('without a native session (old APK, iOS) the bridge is a no-op', () => {
  const { calls, controls } = recorder();
  const bridge = createMediaSessionBridge(null, controls);
  bridge.update({ title: 'Peli', playing: true });
  bridge.dispose();
  assert.deepEqual(calls, []);
});
