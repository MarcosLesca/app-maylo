import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';

import { ENGINE_HTML, ENGINE_SCRIPT, engineCallScript, parseEngineReply } from './engine-script.ts';
import { NSIG_EXPORT } from './player-script.ts';

/** A fake page: the globals the engine touches in the WebView, and what it posts back. */
function page() {
  const posted: string[] = [];
  const window: Record<string, unknown> = {
    ReactNativeWebView: { postMessage: (data: string) => posted.push(data) },
    TextEncoder,
    Uint8Array,
    atob,
    btoa,
    setTimeout,
    clearTimeout,
    Promise,
    JSON,
    Object,
    Error,
    String,
    encodeURIComponent,
    decodeURIComponent,
  };
  window.window = window;
  const context = vm.createContext(window);
  vm.runInContext(ENGINE_SCRIPT, context);
  let next = 0;
  /** Runs one call exactly as the app injects it and waits for its reply. */
  const call = async (type: string, payload: unknown) => {
    const id = `c${++next}`;
    vm.runInContext(engineCallScript(id, type, payload), context);
    for (let i = 0; i < 50; i++) {
      for (const data of posted) {
        const reply = parseEngineReply(data);
        if (reply?.id === id) return reply;
      }
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    throw new Error(`no reply to ${type}`);
  };
  return { window, context, posted, call };
}

/** BotGuard VM shaped like the real one (see BgUtils BotGuardClient): setup callback, async snapshot, minter in the output. */
const FAKE_INTERPRETER = `window.fakeBg = { a: function (program, setup, flag, element, telemetry, lists) {
  var snapshot = function (done, args) {
    args[2].push(function (integrity) {
      return Promise.resolve(function (identifier) {
        return Promise.resolve(new Uint8Array([integrity.length, identifier.length, 251, 255]));
      });
    });
    done('bg:' + program + ':' + flag + ':' + lists.length);
  };
  setup(snapshot, function () {}, function () {}, function () {});
  return [function () { return 'sync'; }];
} };`;

/** A player whose URL class reverses n, wrapped like base.js and exported the way player-script.ts does. */
const FAKE_PLAYER = [
  'var _yt_player={};(function(g){var window=this;',
  'g.U=function(u){this.u=u;this.seen=0};',
  'g.U.prototype.get=function(k){var m=/[?&]n=([^&]*)/.exec(this.u);return k==="n"&&m?decodeURIComponent(m[1]).split("").reverse().join(""):null};',
  'g.U.prototype.set=function(){};',
  'g.U.prototype.touch=function(){this.seen++};',
  '$w=function(a,b,c){a=new g.U(a,!0);a.set("alr","yes");return a};',
  `;${NSIG_EXPORT}=$w;})(_yt_player);`,
].join('\n');

test('the engine page is a blank document that runs the engine script', () => {
  assert.match(ENGINE_HTML, /^<!DOCTYPE html>/);
  assert.ok(ENGINE_HTML.includes(ENGINE_SCRIPT));
  assert.doesNotMatch(ENGINE_HTML, /<script[^>]+src=/i);
});

test('botguard runs the interpreter and the program, and returns the snapshot (BgUtils flow)', async () => {
  const { call } = page();
  assert.deepEqual(await call('botguard', { interpreter: FAKE_INTERPRETER, program: 'PROG', globalName: 'fakeBg' }), {
    id: 'c1',
    ok: true,
    value: 'bg:PROG:true:2',
  });
});

test('mint turns the integrity token into a minter and mints for the visitor, web-safe base64', async () => {
  const { call } = page();
  await call('botguard', { interpreter: FAKE_INTERPRETER, program: 'P', globalName: 'fakeBg' });
  // Integrity token "AQID" is 3 bytes; the identifier "abcd" is 4.
  const reply = await call('mint', { integrityToken: 'AQID', identifier: 'abcd' });
  assert.deepEqual(reply, { id: 'c2', ok: true, value: Buffer.from([3, 4, 251, 255]).toString('base64').replace(/\+/g, '-').replace(/\//g, '_') });
  assert.equal(reply.value, 'AwT7_w==');
  // A base64url integrity token works too.
  assert.equal((await call('mint', { integrityToken: '-_8', identifier: 'ab' })).value, Buffer.from([2, 2, 251, 255]).toString('base64').replace(/\//g, '_'));
});

test('mint before botguard, a missing VM or an unknown call answer an error', async () => {
  const { call } = page();
  assert.equal((await call('mint', { integrityToken: 'AQID', identifier: 'x' })).ok, false);
  assert.equal((await call('botguard', { interpreter: '', program: 'P', globalName: 'nothing' })).ok, false);
  assert.equal((await call('dance', {})).ok, false);
});

test('the player loads once per id and deciphers n through its URL class (YouTube.js processor)', async () => {
  const { call } = page();
  assert.deepEqual(await call('player', { id: 'p1' }), { id: 'c1', ok: true, value: false });
  assert.equal((await call('n', { values: ['abc'] })).ok, false);
  assert.deepEqual(await call('player', { id: 'p1', script: FAKE_PLAYER }), { id: 'c3', ok: true, value: true });
  assert.deepEqual(await call('player', { id: 'p1' }), { id: 'c4', ok: true, value: true });
  assert.deepEqual(await call('player', { id: 'p2' }), { id: 'c5', ok: true, value: false });
  assert.deepEqual(await call('n', { values: ['abc', 'x-_9'] }), { id: 'c6', ok: true, value: ['cba', '9_-x'] });
});

test('a player script without the export, or an n that does not change, is an error', async () => {
  const { call } = page();
  assert.equal((await call('player', { id: 'p1', script: 'var nothing = 1;' })).ok, false);
  const same = FAKE_PLAYER.replace('.split("").reverse().join("")', '');
  await call('player', { id: 'p2', script: same });
  assert.equal((await call('n', { values: ['abc'] })).ok, false);
});

test('replies are parsed strictly; other WebView messages are ignored', () => {
  assert.deepEqual(parseEngineReply('{"type":"maylo-engine","id":"a","ok":true,"value":[1]}'), { id: 'a', ok: true, value: [1] });
  assert.deepEqual(parseEngineReply('{"type":"maylo-engine","id":"a","ok":false,"error":"boom"}'), { id: 'a', ok: false, error: 'boom' });
  assert.equal(parseEngineReply('{"type":"maylo-video","id":"a"}'), null);
  assert.equal(parseEngineReply('not json'), null);
  assert.equal(parseEngineReply('{"type":"maylo-engine","ok":true}'), null);
});

test('the call script passes its arguments as JSON data', () => {
  const script = engineCallScript('c1', 'n', { values: ['</script>"\' '] });
  assert.match(script, /^window\.__mayloEngine && window\.__mayloEngine\.run\(/);
  assert.ok(script.endsWith('true;'));
  assert.doesNotThrow(() => new Function(script));
});
