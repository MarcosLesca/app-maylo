import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_HUB_ADDRESS,
  HUB_INVALID_TEXT,
  hubFavoriteText,
  hubProbeText,
  hubRegisterBody,
  hubRegistrationText,
  parseHubAddress,
  parseHubPhones,
} from './hub.ts';

test('the default hub is the ESP32 mDNS name', () => {
  assert.equal(DEFAULT_HUB_ADDRESS, 'http://maylo-tv.local');
  assert.equal(parseHubAddress(DEFAULT_HUB_ADDRESS), 'http://maylo-tv.local');
});

test('a hub address is http://host[:port] and is normalized to its origin', () => {
  assert.equal(parseHubAddress('http://192.168.0.50'), 'http://192.168.0.50');
  assert.equal(parseHubAddress('  http://192.168.0.50/  '), 'http://192.168.0.50');
  assert.equal(parseHubAddress('HTTP://Maylo-TV.Local:8080'), 'http://maylo-tv.local:8080');
  assert.equal(parseHubAddress('http://esp32:80/'), 'http://esp32:80');
  assert.equal(parseHubAddress('http://a.b.c:65535'), 'http://a.b.c:65535');
});

test('anything else is rejected', () => {
  for (const input of [
    '',
    '   ',
    'maylo-tv.local',
    '192.168.0.50',
    'https://maylo-tv.local',
    'ftp://maylo-tv.local',
    'http://',
    'http://maylo-tv.local/phones',
    'http://maylo-tv.local//',
    'http://maylo-tv.local?x=1',
    'http://maylo-tv.local#a',
    'http://user@maylo-tv.local',
    'http://maylo tv.local',
    'http://-bad.local',
    'http://bad-.local',
    'http://a..b',
    'http://maylo-tv.local:0',
    'http://maylo-tv.local:65536',
    'http://maylo-tv.local:',
    'http://maylo-tv.local:80a',
    'javascript:alert(1)',
  ]) {
    assert.equal(parseHubAddress(input), null, JSON.stringify(input));
  }
  assert.equal(parseHubAddress(null as unknown as string), null);
  assert.match(HUB_INVALID_TEXT, /http:\/\/maylo-tv\.local/);
});

test('the register body is {url, name} for a receiver URL the hub accepts', () => {
  assert.equal(
    hubRegisterBody('http://192.168.0.249:8765/tv/aB3dE9', '  Marcos  '),
    '{"url":"http://192.168.0.249:8765/tv/aB3dE9","name":"Marcos"}',
  );
  assert.deepEqual(JSON.parse(hubRegisterBody('http://10.0.0.2:8775/tv/Zz9Yy8', '')!), {
    url: 'http://10.0.0.2:8775/tv/Zz9Yy8',
    name: '',
  });
  // Names are cut to 40 characters, like the hub does.
  const long = 'x'.repeat(60);
  assert.equal(JSON.parse(hubRegisterBody('http://10.0.0.2:8770/tv/Zz9Yy8', long)!).name, 'x'.repeat(40));
});

test('no register body for a URL the hub would refuse', () => {
  for (const url of [
    'http://192.168.0.249:8764/tv/aB3dE9',
    'http://192.168.0.249:8776/tv/aB3dE9',
    'http://192.168.0.249:8765/tv/aB3dE',
    'http://192.168.0.249:8765/tv/aB3dE9/',
    'http://phone.local:8765/tv/aB3dE9',
    'http://192.168.0.300:8765/tv/aB3dE9',
    'https://192.168.0.249:8765/tv/aB3dE9',
    '',
  ]) {
    assert.equal(hubRegisterBody(url, 'Marcos'), null, url);
  }
});

test('the last registration is shown in Spanish', () => {
  assert.equal(hubRegistrationText(null, 1000), null);
  assert.equal(hubRegistrationText({ ok: true, at: 10_000 }, 10_400), 'Registrado en el hub hace 0 s');
  assert.equal(hubRegistrationText({ ok: true, at: 10_000 }, 52_999), 'Registrado en el hub hace 42 s');
  // A clock that went back never shows a negative age.
  assert.equal(hubRegistrationText({ ok: true, at: 10_000 }, 5_000), 'Registrado en el hub hace 0 s');
  assert.equal(hubRegistrationText({ ok: false, at: 10_000 }, 12_000), 'No se pudo registrar en el hub');
});

test('the hub /phones answer is read as a phone count', () => {
  assert.equal(parseHubPhones('{"phones":[]}'), 0);
  assert.equal(parseHubPhones('{"phones":[{"url":"u","name":"n","ageSeconds":3},{"url":"v","name":"","ageSeconds":9}]}'), 2);
  assert.equal(parseHubPhones('{"phones":{}}'), null);
  assert.equal(parseHubPhones('[]'), null);
  assert.equal(parseHubPhones('<html>'), null);
  assert.equal(parseHubPhones(''), null);
});

test('the probe result and the TV favorite are explained in Spanish', () => {
  assert.equal(hubProbeText({ ok: true, phones: 0 }), 'El hub responde (sin teléfonos registrados todavía)');
  assert.equal(hubProbeText({ ok: true, phones: 1 }), 'El hub responde (1 teléfono registrado)');
  assert.equal(hubProbeText({ ok: true, phones: 2 }), 'El hub responde (2 teléfonos registrados)');
  assert.equal(
    hubProbeText({ ok: false }),
    'No se pudo conectar con el hub. Revisá la dirección y que el ESP32 esté prendido y en el mismo Wi-Fi.',
  );
  assert.equal(hubFavoriteText('http://maylo-tv.local'), 'En la tele guardá como favorito: http://maylo-tv.local/');
});

test('the hub name is cut at 40 whole characters, never inside an emoji', () => {
  const body = hubRegisterBody('http://1.2.3.4:8765/tv/Ab12Cd', 'a' + '😀'.repeat(30));
  const name = JSON.parse(body!).name as string;
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(name));
  assert.equal(Array.from(name).length, 31);
  const long = JSON.parse(hubRegisterBody('http://1.2.3.4:8765/tv/Ab12Cd', '😀'.repeat(50))!).name as string;
  assert.equal(Array.from(long).length, 40);
});

test('register URLs only use the receiver ports 8765-8775', () => {
  for (const [port, ok] of [[8764, false], [8765, true], [8775, true], [8776, false]] as const) {
    assert.equal(hubRegisterBody(`http://10.0.0.5:${port}/tv/Ab12Cd`, 'x') !== null, ok);
  }
});
