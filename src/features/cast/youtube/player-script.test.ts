import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  NSIG_EXPORT,
  exportNsigScript,
  findNsigFunction,
  playerIdFromIframeApi,
  playerScriptUrl,
  signatureTimestamp,
} from './player-script.ts';

/** Shaped like base.js (player b485e332): the URL-constructor wrapper YouTube.js's nsigMatcher looks for. */
const PLAYER = [
  'var _yt_player={};(function(g){var window=this;',
  "'use strict';var ca=\"length{split\".split(\"{\");",
  'Gka=function(a,b,c,d,e){return a instanceof Wo?Cka(a,d,e,b,c):Cka(a,d,e,new Lo,0)};',
  '$o=function(a,b,c){b=b===void 0?"":b;c=c===void 0?"":c;a=new g.Xo(a,!0);a.set("alr","yes");c&&(c=Yo(2,7910,Zo(18,237,c)),a[ca[20]](b,se(8,5744,c)));return a};',
  'ap=function(a){g.Q.call(this);this.options=a};',
  'var x={signatureTimestamp:20779,foo:1};',
  'g.k.scrollTo=function(a){};new g.Ro;new g.Ro;})(_yt_player);',
  '',
].join('\n');

test('the player id comes from the iframe API script (escaped slashes)', () => {
  const api = "var scriptUrl = 'https:\\/\\/www.youtube.com\\/s\\/player\\/b485e332\\/www-widgetapi.vflset\\/www-widgetapi.js';";
  assert.equal(playerIdFromIframeApi(api), 'b485e332');
  assert.equal(playerIdFromIframeApi("'https://www.youtube.com/s/player/0004de42/www-widgetapi.vflset/x.js'"), '0004de42');
  assert.equal(playerIdFromIframeApi('nothing here'), null);
  assert.equal(playerScriptUrl('b485e332'), 'https://www.youtube.com/s/player/b485e332/player_ias.vflset/en_US/base.js');
});

test('the signature timestamp is read from base.js', () => {
  assert.equal(signatureTimestamp(PLAYER), 20779);
  assert.equal(signatureTimestamp('a={sts:"x"}'), null);
});

test('the n/sig URL wrapper is found the way YouTube.js matches it: new URL object, then set("alr","yes")', () => {
  assert.equal(findNsigFunction(PLAYER), '$o');
  // Default parameters written as such (YouTube.js's AST form) and a dotted name.
  assert.equal(findNsigFunction('g.Qz=function(u,s="",v=""){u=new g.Url(u,!0);u.set("alr","yes");return u};'), 'g.Qz');
  // set("alr","yes") on something that is not the freshly built first parameter does not count.
  assert.equal(findNsigFunction('Kq=function(a,b,c){var d=new g.Xo(a,!0);d.set("alr","yes");return d};'), null);
  assert.equal(findNsigFunction('Kq=function(a){a=new g.Xo(a,!0);a.set("alr","yes");return a};'), null);
  assert.equal(findNsigFunction('nothing to see'), null);
});

test('the player script is exported inside its own scope, right before it closes', () => {
  const script = exportNsigScript(PLAYER, '$o');
  assert.ok(script);
  assert.ok(script.endsWith(`;${NSIG_EXPORT}=$o;})(_yt_player);\n`), script.slice(-80));
  assert.equal(script.replace(`;${NSIG_EXPORT}=$o;`, ''), PLAYER);
  assert.equal(NSIG_EXPORT, 'window.__mayloNsig');
  assert.equal(exportNsigScript('(function(){})();', '$o'), null);
  assert.equal(exportNsigScript(PLAYER, 'a;alert(1)'), null);
});
