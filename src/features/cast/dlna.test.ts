import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  hostOf,
  buildDidlLite,
  buildSoapEnvelope,
  mimeTypeFor,
  parseDeviceDescription,
  parseMute,
  parseSsdpHeaders,
  parseVolume,
  RENDERING_CONTROL,
  rendererLocations,
  formatDiscoveryReport,
  normalizeHost,
  parseIpv4,
  summarizeSsdp,
} from './dlna.ts';

const RENDERER_REPLY = [
  'HTTP/1.1 200 OK',
  'CACHE-CONTROL: max-age=1800',
  'Location: http://192.168.1.50:49152/description.xml',
  'ST: urn:schemas-upnp-org:service:AVTransport:1',
  'USN: uuid:abc::urn:schemas-upnp-org:service:AVTransport:1',
  '',
  '',
].join('\r\n');

test('SSDP headers are read case-insensitively and trimmed', () => {
  const headers = parseSsdpHeaders(RENDERER_REPLY);
  assert.equal(headers.location, 'http://192.168.1.50:49152/description.xml');
  assert.equal(headers.st, 'urn:schemas-upnp-org:service:AVTransport:1');
});

test('renderer locations are deduplicated and skip replies without a location', () => {
  const locations = rendererLocations([
    { address: '192.168.1.50', response: RENDERER_REPLY },
    { address: '192.168.1.50', response: RENDERER_REPLY.replace('AVTransport:1', 'MediaRenderer:1') },
    { address: '192.168.1.9', response: 'HTTP/1.1 200 OK\r\nST: upnp:rootdevice\r\n\r\n' },
  ]);
  assert.deepEqual(locations, ['http://192.168.1.50:49152/description.xml']);
});

test('a reply pointing at a host other than its sender is ignored', () => {
  assert.deepEqual(rendererLocations([{ address: '192.168.1.66', response: RENDERER_REPLY }]), []);
});

test('host is read without the URL global, with and without port', () => {
  assert.equal(hostOf('http://192.168.1.50:49152/description.xml'), '192.168.1.50:49152');
  assert.equal(hostOf('http://tv.local/x'), 'tv.local');
  assert.equal(hostOf('not a url'), '');
});

const DESCRIPTION = `<?xml version="1.0"?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
  <device>
    <friendlyName>Hisense 50A4NV &amp; Co</friendlyName>
    <serviceList>
      <service>
        <serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType>
        <controlURL>/upnp/control/rendering</controlURL>
      </service>
      <service>
        <serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType>
        <controlURL>upnp/control/avtransport</controlURL>
      </service>
    </serviceList>
  </device>
</root>`;

test('device description yields the name and the AVTransport and RenderingControl URLs resolved against the location', () => {
  assert.deepEqual(parseDeviceDescription(DESCRIPTION, 'http://192.168.1.50:49152/dev/description.xml'), {
    name: 'Hisense 50A4NV & Co',
    controlUrl: 'http://192.168.1.50:49152/dev/upnp/control/avtransport',
    renderingControlUrl: 'http://192.168.1.50:49152/upnp/control/rendering',
  });
});

test('a TV without RenderingControl is still a renderer, just without volume', () => {
  const xml = DESCRIPTION.replace('service:RenderingControl:1', 'service:ConnectionManager:1');
  assert.deepEqual(parseDeviceDescription(xml, 'http://192.168.1.50:49152/dev/description.xml'), {
    name: 'Hisense 50A4NV & Co',
    controlUrl: 'http://192.168.1.50:49152/dev/upnp/control/avtransport',
  });
});

test('a RenderingControl URL on another host is dropped, keeping the renderer', () => {
  const xml = DESCRIPTION.replace('/upnp/control/rendering', 'http://10.0.0.9/steal');
  const renderer = parseDeviceDescription(xml, 'http://192.168.1.50:49152/description.xml');
  assert.equal(renderer?.controlUrl, 'http://192.168.1.50:49152/upnp/control/avtransport');
  assert.equal(renderer?.renderingControlUrl, undefined);
});

test('URLBase wins over the location when the description declares it', () => {
  const xml = DESCRIPTION.replace('<device>', '<URLBase>http://192.168.1.50:8080/</URLBase><device>');
  assert.equal(
    parseDeviceDescription(xml, 'http://192.168.1.50:49152/description.xml')?.controlUrl,
    'http://192.168.1.50:8080/upnp/control/avtransport',
  );
});

test('a control URL on another host than the description is rejected', () => {
  const absolute = DESCRIPTION.replace('upnp/control/avtransport', 'http://10.0.0.9/steal');
  assert.equal(parseDeviceDescription(absolute, 'http://192.168.1.50:49152/description.xml'), null);
  const rebased = DESCRIPTION.replace('<device>', '<URLBase>http://10.0.0.9/</URLBase><device>');
  assert.equal(parseDeviceDescription(rebased, 'http://192.168.1.50:49152/description.xml'), null);
});

test('an absolute-path control URL keeps the description origin', () => {
  const xml = DESCRIPTION.replace('upnp/control/avtransport', '/AVT/ctrl');
  assert.equal(
    parseDeviceDescription(xml, 'http://192.168.1.50:49152/dev/description.xml?x=1')?.controlUrl,
    'http://192.168.1.50:49152/AVT/ctrl',
  );
});

test('only AVTransport version 1 counts, since the SOAP calls speak version 1', () => {
  const xml = DESCRIPTION.replace('service:AVTransport:1', 'service:AVTransport:2');
  assert.equal(parseDeviceDescription(xml, 'http://192.168.1.50/description.xml'), null);
});

test('a device without AVTransport is not a renderer', () => {
  const xml = DESCRIPTION.replace('service:AVTransport:1', 'service:ContentDirectory:1');
  assert.equal(parseDeviceDescription(xml, 'http://192.168.1.50/description.xml'), null);
});

test('mime type follows the URL path, ignoring the query string', () => {
  assert.equal(mimeTypeFor('https://x.test/movie.MP4?token=1'), 'video/mp4');
  assert.equal(mimeTypeFor('https://x.test/live/index.m3u8'), 'application/vnd.apple.mpegurl');
  assert.equal(mimeTypeFor('https://x.test/clip.webm'), 'video/webm');
  assert.equal(mimeTypeFor('https://x.test/stream'), 'video/mp4');
});

test('DIDL-Lite metadata escapes the title and the URL', () => {
  const didl = buildDidlLite('https://x.test/a.mp4?a=1&b=2', 'Tom & "Jerry"');
  assert.match(didl, /<dc:title>Tom &amp; &quot;Jerry&quot;<\/dc:title>/);
  assert.match(didl, /protocolInfo="http-get:\*:video\/mp4:\*">https:\/\/x\.test\/a\.mp4\?a=1&amp;b=2<\/res>/);
});

test('AVTransport envelopes are byte-for-byte the same with the default and the explicit service', () => {
  const args = { InstanceID: '0', Speed: '1' };
  const expected =
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ' +
    's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body>' +
    '<u:Play xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><InstanceID>0</InstanceID><Speed>1</Speed></u:Play>' +
    '</s:Body></s:Envelope>';
  assert.equal(buildSoapEnvelope('Play', args), expected);
  assert.equal(buildSoapEnvelope('Play', args, 'urn:schemas-upnp-org:service:AVTransport:1'), expected);
});

test('RenderingControl envelopes use their own namespace', () => {
  const body = buildSoapEnvelope('SetVolume', { InstanceID: '0', Channel: 'Master', DesiredVolume: '19' }, RENDERING_CONTROL);
  assert.equal(RENDERING_CONTROL, 'urn:schemas-upnp-org:service:RenderingControl:1');
  assert.match(
    body,
    /<u:SetVolume xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1"><InstanceID>0<\/InstanceID><Channel>Master<\/Channel><DesiredVolume>19<\/DesiredVolume><\/u:SetVolume>/,
  );
});

test('GetVolume response yields the level, clamped to 0-100', () => {
  const reply = (value: string) =>
    `<s:Envelope><s:Body><u:GetVolumeResponse xmlns:u="${RENDERING_CONTROL}"><CurrentVolume>${value}</CurrentVolume></u:GetVolumeResponse></s:Body></s:Envelope>`;
  assert.equal(parseVolume(reply('18')), 18);
  assert.equal(parseVolume(reply('0')), 0);
  assert.equal(parseVolume(reply('150')), 100);
  assert.equal(parseVolume(reply('abc')), null);
  assert.equal(parseVolume('<x/>'), null);
});

test('GetMute response yields true, false or null', () => {
  const reply = (value: string) =>
    `<s:Envelope><s:Body><u:GetMuteResponse xmlns:u="${RENDERING_CONTROL}"><CurrentMute>${value}</CurrentMute></u:GetMuteResponse></s:Body></s:Envelope>`;
  assert.equal(parseMute(reply('1')), true);
  assert.equal(parseMute(reply('true')), true);
  assert.equal(parseMute(reply('0')), false);
  assert.equal(parseMute(reply('False')), false);
  assert.equal(parseMute(reply('maybe')), null);
  assert.equal(parseMute('<x/>'), null);
});

test('SOAP envelope wraps the action with escaped arguments in order', () => {
  const body = buildSoapEnvelope('SetAVTransportURI', { InstanceID: '0', CurrentURI: 'http://a?x=1&y=2' });
  assert.match(body, /<u:SetAVTransportURI xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">/);
  assert.match(body, /<InstanceID>0<\/InstanceID><CurrentURI>http:\/\/a\?x=1&amp;y=2<\/CurrentURI>/);
  assert.match(body, /<\/u:SetAVTransportURI><\/s:Body><\/s:Envelope>$/);
});

// --- S1-S3: robust discovery, diagnostics and manual IP ---

const NOTIFY_ALIVE = [
  'NOTIFY * HTTP/1.1',
  'HOST: 239.255.255.250:1900',
  'LOCATION: http://192.168.1.50:49152/description.xml',
  'NT: urn:schemas-upnp-org:service:AVTransport:1',
  'NTS: ssdp:alive',
  '',
  '',
].join('\r\n');

test('a NOTIFY ssdp:alive gives its LOCATION like a search reply; byebye and M-SEARCH do not', () => {
  assert.deepEqual(rendererLocations([{ address: '192.168.1.50', response: NOTIFY_ALIVE, kind: 'notify' }]), [
    'http://192.168.1.50:49152/description.xml',
  ]);
  const byebye = NOTIFY_ALIVE.replace('ssdp:alive', 'ssdp:byebye');
  const search = NOTIFY_ALIVE.replace('NOTIFY * HTTP/1.1', 'M-SEARCH * HTTP/1.1');
  assert.deepEqual(
    rendererLocations([
      { address: '192.168.1.50', response: byebye, kind: 'notify' },
      { address: '192.168.1.50', response: search, kind: 'notify' },
    ]),
    [],
  );
});

test('hosts compare normalized: case, IPv6 brackets, IPv4-mapped and zone ids', () => {
  assert.equal(normalizeHost('[FE80::1%wlan0]'), 'fe80::1');
  assert.equal(normalizeHost('::ffff:192.168.1.50'), '192.168.1.50');
  assert.equal(normalizeHost('::FFFF:192.168.1.50'), '192.168.1.50');
  assert.equal(normalizeHost('TV.Local'), 'tv.local');
  assert.deepEqual(rendererLocations([{ address: '::ffff:192.168.1.50', response: RENDERER_REPLY }]), [
    'http://192.168.1.50:49152/description.xml',
  ]);
  const v6 = RENDERER_REPLY.replace('192.168.1.50:49152', '[FE80::1]:49152');
  assert.deepEqual(rendererLocations([{ address: 'fe80::1%wlan0', response: v6 }]), [
    'http://[FE80::1]:49152/description.xml',
  ]);
  const upper = RENDERER_REPLY.replace('192.168.1.50', 'TV.LAN');
  assert.deepEqual(rendererLocations([{ address: 'tv.lan', response: upper }]), ['http://TV.LAN:49152/description.xml']);
  assert.deepEqual(rendererLocations([{ address: '::ffff:192.168.1.66', response: RENDERER_REPLY }]), []);
});

test('location candidates keep every distinct Location with its sender and whether it may be used', () => {
  const summary = summarizeSsdp([
    { address: '192.168.1.50', response: RENDERER_REPLY, kind: 'response' },
    { address: '192.168.1.50', response: NOTIFY_ALIVE, kind: 'notify' },
    { address: '192.168.1.66', response: RENDERER_REPLY.replace('192.168.1.50', '192.168.1.70'), kind: 'response' },
    { address: '192.168.1.9', response: 'HTTP/1.1 200 OK\r\nST: upnp:rootdevice\r\n\r\n', kind: 'response' },
    { address: '192.168.1.50', response: NOTIFY_ALIVE.replace('ssdp:alive', 'ssdp:byebye'), kind: 'notify' },
  ]);
  assert.equal(summary.responses, 3);
  assert.equal(summary.notifies, 2);
  assert.deepEqual(summary.candidates, [
    { location: 'http://192.168.1.50:49152/description.xml', sender: '192.168.1.50', hostMatches: true },
    { location: 'http://192.168.1.70:49152/description.xml', sender: '192.168.1.66', hostMatches: false },
  ]);
});

test('packet kind falls back to the start line when the native side does not tag it', () => {
  const summary = summarizeSsdp([
    { address: '192.168.1.50', response: RENDERER_REPLY },
    { address: '192.168.1.50', response: NOTIFY_ALIVE },
  ]);
  assert.equal(summary.responses, 1);
  assert.equal(summary.notifies, 1);
});

const REAL_WORLD_DESCRIPTION = `<?xml version="1.0" encoding="UTF-8"?>
<root xmlns="urn:schemas-upnp-org:device-1-0" xmlns:dlna="urn:schemas-dlna-org:device-1-0">
  <URLBase xml:space="preserve"> http://192.168.1.50:38400/ </URLBase>
  <device>
    <friendlyName lang="es">Hisense&#32;50A4NV &#x26; Sala&#233;</friendlyName>
    <serviceList>
      <service xmlns="urn:schemas-upnp-org:device-1-0">
        <u:serviceType xmlns:u="urn:x">
          URN:schemas-upnp-org:service:RenderingControl:1
        </u:serviceType>
        <u:controlURL xmlns:u="urn:x">/RCS/control</u:controlURL>
      </service>
      <service xmlns="urn:schemas-upnp-org:device-1-0">
        <u:serviceType xmlns:u="urn:x">
          urn:schemas-upnp-org:service:AVTransport:1
        </u:serviceType>
        <u:controlURL xmlns:u="urn:x">AVT/control</u:controlURL>
      </service>
    </serviceList>
  </device>
</root>`;

test('real-world descriptions: attributes, namespace prefixes, whitespace/case in serviceType, URLBase, numeric entities', () => {
  assert.deepEqual(parseDeviceDescription(REAL_WORLD_DESCRIPTION, 'http://192.168.1.50:38400/description.xml'), {
    name: 'Hisense 50A4NV & Salaé',
    controlUrl: 'http://192.168.1.50:38400/AVT/control',
    renderingControlUrl: 'http://192.168.1.50:38400/RCS/control',
  });
});

test('serviceType must still be exactly AVTransport:1 after whitespace normalization', () => {
  for (const other of ['service:AVTransport:10', 'service:AVTransport:1x', 'service:AVTransport:1 extra']) {
    const xml = REAL_WORLD_DESCRIPTION.replace('service:AVTransport:1', other);
    assert.equal(parseDeviceDescription(xml, 'http://192.168.1.50:38400/description.xml'), null, other);
  }
});

test('control URLs compare the description host normalized (case, IPv6 brackets)', () => {
  const xml = DESCRIPTION.replace('upnp/control/avtransport', 'http://TV.LAN:49152/avt');
  assert.equal(parseDeviceDescription(xml, 'http://tv.lan:49152/description.xml')?.controlUrl, 'http://tv.lan:49152/avt');
  const v6 = DESCRIPTION.replace('upnp/control/avtransport', 'http://[FE80::1]:49152/avt');
  assert.equal(parseDeviceDescription(v6, 'http://[fe80::1]:49152/description.xml')?.controlUrl, 'http://[fe80::1]:49152/avt');
});

test('a typed IP is accepted only as a unicast IPv4', () => {
  assert.equal(parseIpv4(' 192.168.1.50 '), '192.168.1.50');
  assert.equal(parseIpv4('10.0.0.7'), '10.0.0.7');
  for (const bad of ['', '192.168.1', '192.168.1.256', '192.168.01.5', 'tv.local', '1.2.3.4.5', '0.0.0.0', '127.0.0.1', '239.255.255.250', '255.255.255.255', '192.168.1.50:1900']) {
    assert.equal(parseIpv4(bad), null, bad);
  }
});

test('the report explains every Location and why it was dropped', () => {
  const lines = formatDiscoveryReport({
    mode: 'multicast',
    responses: 3,
    notifies: 1,
    network: { interfaceName: 'wlan0', localAddress: '192.168.1.20', listening: false },
    locations: [
      { location: 'http://192.168.1.50/d.xml', sender: '192.168.1.50', outcome: { kind: 'ok', name: 'Hisense' } },
      { location: 'http://192.168.1.70/d.xml', sender: '192.168.1.66', outcome: { kind: 'host-mismatch' } },
      { location: 'http://192.168.1.80/d.xml', sender: '192.168.1.80', outcome: { kind: 'fetch-failed', status: 404 } },
      { location: 'http://192.168.1.81/d.xml', sender: '192.168.1.81', outcome: { kind: 'fetch-failed', error: 'timeout' } },
      { location: 'http://192.168.1.9/d.xml', sender: '192.168.1.9', outcome: { kind: 'not-a-renderer' } },
    ],
  });
  assert.deepEqual(lines, [
    'Búsqueda por multicast: 3 respuestas, 1 NOTIFY',
    'Red: wlan0 192.168.1.20 · escucha de NOTIFY: no (puerto 1900 ocupado)',
    'http://192.168.1.50/d.xml (de 192.168.1.50): TV lista — Hisense',
    'http://192.168.1.70/d.xml (de 192.168.1.66): descartada, la dirección no es la de quien respondió',
    'http://192.168.1.80/d.xml (de 192.168.1.80): no se pudo leer la descripción (HTTP 404)',
    'http://192.168.1.81/d.xml (de 192.168.1.81): no se pudo leer la descripción (timeout)',
    'http://192.168.1.9/d.xml (de 192.168.1.9): no es una TV (sin AVTransport:1)',
  ]);
});

test('the report shows a failed M-SEARCH send and a missing Wi-Fi', () => {
  assert.deepEqual(
    formatDiscoveryReport({
      mode: 'multicast',
      responses: 0,
      notifies: 0,
      network: { interfaceName: '', localAddress: '', listening: true, error: 'ENETUNREACH' },
      locations: [],
    }),
    [
      'Búsqueda por multicast: 0 respuestas, 0 NOTIFY',
      'Red: Wi-Fi no encontrado · escucha de NOTIFY: sí',
      'No se pudo enviar la búsqueda: ENETUNREACH',
      'Ningún aparato respondió a la búsqueda.',
    ],
  );
});

test('the report says plainly when nothing answered, including a unicast search', () => {
  assert.deepEqual(formatDiscoveryReport({ mode: 'unicast', target: '192.168.1.50', responses: 0, notifies: 0, locations: [] }), [
    'Búsqueda directa a 192.168.1.50: 0 respuestas, 0 NOTIFY',
    'Ningún aparato respondió a la búsqueda.',
  ]);
  assert.deepEqual(
    formatDiscoveryReport({ mode: 'multicast', legacy: true, responses: 2, notifies: 0, locations: [] }),
    [
      'Búsqueda por multicast: 2 respuestas, 0 NOTIFY',
      'Esta versión de la app busca sin elegir la red Wi-Fi; instalá la última versión.',
      'Respondieron aparatos, pero ninguno indicó una dirección de descripción.',
    ],
  );
});
