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
  describeDevice,
  followUpHosts,
  withoutOwnSenders,
  suggestsBrowserReceiver,
  dlnaPlayback,
  parseTransportState,
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

test('AVTransport versions 1-3 count (the SOAP calls keep speaking version 1); version 4 does not', () => {
  for (const version of ['2', '3']) {
    const xml = DESCRIPTION.replace('service:AVTransport:1', `service:AVTransport:${version}`).replace(
      'service:RenderingControl:1',
      `service:RenderingControl:${version}`,
    );
    assert.deepEqual(parseDeviceDescription(xml, 'http://192.168.1.50:49152/dev/description.xml'), {
      name: 'Hisense 50A4NV & Co',
      controlUrl: 'http://192.168.1.50:49152/dev/upnp/control/avtransport',
      renderingControlUrl: 'http://192.168.1.50:49152/upnp/control/rendering',
    }, version);
  }
  const v4 = DESCRIPTION.replace('service:AVTransport:1', 'service:AVTransport:4');
  assert.equal(parseDeviceDescription(v4, 'http://192.168.1.50/description.xml'), null);
  const rc4 = DESCRIPTION.replace('service:RenderingControl:1', 'service:RenderingControl:4');
  assert.equal(parseDeviceDescription(rc4, 'http://192.168.1.50/description.xml')?.renderingControlUrl, undefined);
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

test('serviceType must still be exactly AVTransport:1-3 after whitespace normalization', () => {
  for (const other of ['service:AVTransport:10', 'service:AVTransport:1x', 'service:AVTransport:1 extra', 'service:AVTransport:4', 'service:AVTransport:0', 'service:AVTransport:']) {
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
  // Without sender summaries (older callers) every Location keeps its own line.
  assert.deepEqual(lines, [
    'Búsqueda por multicast: 3 respuestas, 1 NOTIFY',
    'Red: wlan0 192.168.1.20 · escucha de NOTIFY: no (puerto 1900 ocupado)',
    'http://192.168.1.50/d.xml (de 192.168.1.50): TV lista — Hisense',
    'http://192.168.1.70/d.xml (de 192.168.1.66): descartada, la dirección no es la de quien respondió',
    'http://192.168.1.80/d.xml (de 192.168.1.80): no se pudo leer la descripción (HTTP 404)',
    'http://192.168.1.81/d.xml (de 192.168.1.81): no se pudo leer la descripción (timeout)',
    'http://192.168.1.9/d.xml (de 192.168.1.9): no es una TV (sin AVTransport)',
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

// --- S8: find the Hisense (DIAL, AVTransport 1-3, embedded devices, per-sender report) ---

const ssdp = (startLine: string, headers: Record<string, string>) =>
  [startLine, ...Object.entries(headers).map(([key, value]) => `${key}: ${value}`), '', ''].join('\r\n');

const ROUTER_SERVER = 'Linux/3.10 UPnP/1.1 MiniUPnPd/2.1';
const ROUTER_USN = 'uuid:3ddcd1d3-2380-45f5-b069-c5b5d9f2f0a1';
const ROUTER_LOCATION = 'http://192.168.0.1:1900/vnpho/rootDesc.xml';
const routerReply = (st: string) =>
  ssdp('HTTP/1.1 200 OK', { LOCATION: ROUTER_LOCATION, SERVER: ROUTER_SERVER, ST: st, USN: `${ROUTER_USN}::${st}` });
const routerNotify = (nt: string) =>
  ssdp('NOTIFY * HTTP/1.1', { HOST: '239.255.255.250:1900', LOCATION: ROUTER_LOCATION, NT: nt, NTS: 'ssdp:alive', SERVER: ROUTER_SERVER, USN: `${ROUTER_USN}::${nt}` });

const DIAL = 'urn:dial-multiscreen-org:service:dial:1';
const HISENSE_SERVER = 'Linux/4.9 UPnP/1.0 VIDAA/2.0';
const HISENSE_USN = 'uuid:9f8e7d6c-1111-2222-3333-444455556666';
const HISENSE_LOCATION = 'http://192.168.0.23:56790/dd.xml';
const hisenseReply = (st: string, location: string | null = HISENSE_LOCATION) =>
  ssdp('HTTP/1.1 200 OK', {
    ...(location ? { LOCATION: location } : {}),
    SERVER: HISENSE_SERVER,
    ST: st,
    USN: `${HISENSE_USN}::${st}`,
  });

const USER_CASE_PACKETS = [
  { address: '192.168.0.1', response: routerReply('upnp:rootdevice'), kind: 'response' as const },
  { address: '192.168.0.1', response: routerReply('urn:schemas-upnp-org:device:InternetGatewayDevice:1'), kind: 'response' as const },
  { address: '192.168.0.1', response: routerReply('urn:schemas-upnp-org:service:WANIPConnection:1'), kind: 'response' as const },
  { address: '192.168.0.1', response: routerNotify('upnp:rootdevice'), kind: 'notify' as const },
  { address: '192.168.0.1', response: routerNotify('urn:schemas-upnp-org:service:WANIPConnection:1'), kind: 'notify' as const },
  { address: '192.168.0.23', response: hisenseReply(DIAL), kind: 'response' as const },
  { address: '::ffff:192.168.0.23', response: hisenseReply('upnp:rootdevice'), kind: 'response' as const },
];

const ROUTER_DESCRIPTION = `<?xml version="1.0"?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
  <device>
    <deviceType>urn:schemas-upnp-org:device:InternetGatewayDevice:1</deviceType>
    <friendlyName>Archer C6</friendlyName>
    <manufacturer>TP-Link</manufacturer>
    <modelName>Archer C6</modelName>
    <deviceList>
      <device>
        <deviceType>urn:schemas-upnp-org:device:WANDevice:1</deviceType>
        <friendlyName>WANDevice</friendlyName>
        <serviceList><service><serviceType>urn:schemas-upnp-org:service:WANIPConnection:1</serviceType><controlURL>/ctl/IPConn</controlURL></service></serviceList>
      </device>
    </deviceList>
  </device>
</root>`;

const DIAL_DESCRIPTION = `<?xml version="1.0"?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
  <device>
    <deviceType>urn:dial-multiscreen-org:device:dial:1</deviceType>
    <friendlyName>Sala</friendlyName>
    <manufacturer>Hisense</manufacturer>
    <modelName>50A4NV</modelName>
  </device>
</root>`;

test('device descriptions yield friendlyName, manufacturer, model and whether it is a router', () => {
  assert.deepEqual(describeDevice(ROUTER_DESCRIPTION), {
    friendlyName: 'Archer C6',
    manufacturer: 'TP-Link',
    modelName: 'Archer C6',
    router: true,
  });
  assert.deepEqual(describeDevice(DIAL_DESCRIPTION), {
    friendlyName: 'Sala',
    manufacturer: 'Hisense',
    modelName: '50A4NV',
    router: false,
  });
  assert.equal(parseDeviceDescription(DIAL_DESCRIPTION, HISENSE_LOCATION), null);
  assert.equal(parseDeviceDescription(ROUTER_DESCRIPTION, ROUTER_LOCATION), null);
});

test('a renderer inside an embedded device (deviceList) is found, with the volume of that same device', () => {
  const xml = `<root>
    <device>
      <friendlyName>Hisense TV</friendlyName>
      <serviceList><service><serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType><controlURL>/root-rc</controlURL></service></serviceList>
      <deviceList>
        <device>
          <deviceType>urn:schemas-upnp-org:device:MediaRenderer:2</deviceType>
          <friendlyName>Hisense Renderer</friendlyName>
          <serviceList>
            <service><serviceType>urn:schemas-upnp-org:service:AVTransport:2</serviceType><controlURL>/emb-avt</controlURL></service>
            <service><serviceType>urn:schemas-upnp-org:service:RenderingControl:2</serviceType><controlURL>/emb-rc</controlURL></service>
          </serviceList>
        </device>
      </deviceList>
    </device>
  </root>`;
  assert.deepEqual(parseDeviceDescription(xml, 'http://192.168.0.23:9000/d.xml'), {
    name: 'Hisense Renderer',
    controlUrl: 'http://192.168.0.23:9000/emb-avt',
    renderingControlUrl: 'http://192.168.0.23:9000/emb-rc',
  });
  // An embedded control URL on another host is still rejected.
  const stolen = xml.replace('/emb-avt', 'http://10.0.0.9/steal');
  assert.equal(parseDeviceDescription(stolen, 'http://192.168.0.23:9000/d.xml'), null);
});

test('every sender is summarized, also without Location: kinds, short ST/NT, SERVER, USN prefix, DIAL and router', () => {
  const summary = summarizeSsdp([
    ...USER_CASE_PACKETS,
    { address: '192.168.0.77', response: 'M-SEARCH * HTTP/1.1\r\nST: ssdp:all\r\n\r\n', kind: 'notify' },
  ]);
  assert.equal(summary.responses, 5);
  assert.equal(summary.notifies, 2);
  assert.deepEqual(summary.senders, [
    {
      address: '192.168.0.1',
      responses: 3,
      notifies: 2,
      others: 0,
      targets: ['rootdevice', 'InternetGatewayDevice:1', 'WANIPConnection:1'],
      server: ROUTER_SERVER,
      usn: 'uuid:3ddcd1d3…',
      dial: false,
      router: true,
    },
    {
      address: '192.168.0.23',
      responses: 2,
      notifies: 0,
      others: 0,
      targets: ['dial:1', 'rootdevice'],
      server: HISENSE_SERVER,
      usn: 'uuid:9f8e7d6c…',
      dial: true,
      router: false,
    },
    { address: '192.168.0.77', responses: 0, notifies: 0, others: 1, targets: [], dial: false, router: false },
  ]);
});

const USER_CASE_REPORT = () => {
  const summary = summarizeSsdp(USER_CASE_PACKETS);
  return {
    mode: 'multicast' as const,
    responses: summary.responses,
    notifies: summary.notifies,
    network: { interfaceName: 'wlan0', localAddress: '192.168.0.249', listening: true },
    senders: summary.senders,
    locations: [
      {
        location: ROUTER_LOCATION,
        sender: '192.168.0.1',
        outcome: { kind: 'not-a-renderer' as const, info: describeDevice(ROUTER_DESCRIPTION) },
      },
      {
        location: HISENSE_LOCATION,
        sender: '192.168.0.23',
        outcome: { kind: 'not-a-renderer' as const, info: describeDevice(DIAL_DESCRIPTION) },
      },
    ],
    followUps: [{ host: '192.168.0.23', responses: 2 }],
  };
};

test('the report names the likely TV and lists every sender on one short line (user case: router + DIAL-only Hisense)', () => {
  assert.deepEqual(formatDiscoveryReport(USER_CASE_REPORT()), [
    'Búsqueda por multicast: 5 respuestas, 2 NOTIFY',
    'Red: wlan0 192.168.0.249 · escucha de NOTIFY: sí',
    '192.168.0.23 (Hisense 50A4NV) respondió por DIAL pero no ofrece reproductor DLNA (AVTransport)',
    'La tele está en la red pero no acepta videos por DLNA: revisá “Compartir contenido” o usá Duplicar pantalla.',
    'Aparatos que respondieron: 2',
    `192.168.0.1 (router): 3 respuestas, 2 NOTIFY · rootdevice, InternetGatewayDevice:1, WANIPConnection:1 · ${ROUTER_SERVER} · uuid:3ddcd1d3…`,
    `  ${ROUTER_LOCATION}: router, no es una TV · Archer C6 — TP-Link Archer C6`,
    `192.168.0.23 (Hisense 50A4NV): 2 respuestas · dial:1, rootdevice · ${HISENSE_SERVER} · uuid:9f8e7d6c…`,
    `  ${HISENSE_LOCATION}: no es una TV (sin AVTransport) · Sala — Hisense 50A4NV`,
    'Búsqueda directa a 192.168.0.23: 2 respuestas',
  ]);
});

test('a DIAL sender without Location is named from its SERVER and marked "sin Location"', () => {
  const packets = [
    { address: '192.168.0.1', response: routerReply('urn:schemas-upnp-org:device:InternetGatewayDevice:1'), kind: 'response' as const },
    { address: '192.168.0.23', response: hisenseReply(DIAL, null), kind: 'response' as const },
  ];
  const summary = summarizeSsdp(packets);
  assert.deepEqual(
    formatDiscoveryReport({
      mode: 'multicast',
      responses: summary.responses,
      notifies: summary.notifies,
      senders: summary.senders,
      locations: [{ location: ROUTER_LOCATION, sender: '192.168.0.1', outcome: { kind: 'not-a-renderer' } }],
      followUps: [{ host: '192.168.0.23', responses: 0, error: 'timeout' }],
    }),
    [
      'Búsqueda por multicast: 2 respuestas, 0 NOTIFY',
      '192.168.0.23 (VIDAA) respondió por DIAL pero no ofrece reproductor DLNA (AVTransport)',
      'La tele está en la red pero no acepta videos por DLNA: revisá “Compartir contenido” o usá Duplicar pantalla.',
      'Aparatos que respondieron: 2',
      `192.168.0.1 (router): 1 respuestas · InternetGatewayDevice:1 · ${ROUTER_SERVER} · uuid:3ddcd1d3…`,
      `  ${ROUTER_LOCATION}: no es una TV (sin AVTransport)`,
      `192.168.0.23 (VIDAA): 1 respuestas · dial:1 · ${HISENSE_SERVER} · uuid:9f8e7d6c… · sin Location`,
      'Búsqueda directa a 192.168.0.23: falló (timeout)',
    ],
  );
});

test('the headline says when only the router answered, and when a likely TV description could not be read', () => {
  const onlyRouter = summarizeSsdp([{ address: '192.168.0.1', response: routerReply('urn:schemas-upnp-org:service:WANIPConnection:1'), kind: 'response' }]);
  assert.equal(
    formatDiscoveryReport({ mode: 'multicast', responses: 1, notifies: 0, senders: onlyRouter.senders, locations: [] })[1],
    'Solo respondió el router (192.168.0.1): la TV no contestó a ninguna búsqueda.',
  );
  const tv = summarizeSsdp([{ address: '192.168.0.23', response: hisenseReply('upnp:rootdevice'), kind: 'response' }]);
  assert.equal(
    formatDiscoveryReport({
      mode: 'multicast',
      responses: 1,
      notifies: 0,
      senders: tv.senders,
      locations: [{ location: HISENSE_LOCATION, sender: '192.168.0.23', outcome: { kind: 'fetch-failed', status: 404 } }],
    })[1],
    '192.168.0.23 (VIDAA) respondió pero no se pudo leer su descripción (HTTP 404)',
  );
  const printer = summarizeSsdp([
    { address: '192.168.0.40', response: ssdp('HTTP/1.1 200 OK', { ST: 'upnp:rootdevice', SERVER: 'HP-Printer/1.0' }), kind: 'response' },
  ]);
  assert.equal(
    formatDiscoveryReport({ mode: 'multicast', responses: 1, notifies: 0, senders: printer.senders, locations: [] })[1],
    'Ningún aparato parece una TV: ninguno ofrece reproductor DLNA (AVTransport).',
  );
});

test('a sender with more than four ST/NT values is shortened', () => {
  const sts = ['a:1', 'b:1', 'c:1', 'd:1', 'e:1', 'f:1'].map((name) => `urn:x-org:service:${name}`);
  const summary = summarizeSsdp(
    sts.map((st) => ({ address: '192.168.0.9', response: ssdp('HTTP/1.1 200 OK', { ST: st }), kind: 'response' as const })),
  );
  assert.deepEqual(
    formatDiscoveryReport({ mode: 'multicast', responses: 6, notifies: 0, senders: summary.senders, locations: [] }).slice(2),
    ['Aparatos que respondieron: 1', '192.168.0.9: 6 respuestas · a:1, b:1, c:1, d:1 +2 · sin Location'],
  );
});

test('unicast follow-ups go to senders without a renderer that are not the router or the phone, likely TVs first, at most 8', () => {
  const summary = summarizeSsdp([
    ...USER_CASE_PACKETS,
    { address: '192.168.0.40', response: ssdp('HTTP/1.1 200 OK', { ST: 'upnp:rootdevice', LOCATION: 'http://192.168.0.40/p.xml' }), kind: 'response' },
    { address: '192.168.0.50', response: RENDERER_REPLY.replace('192.168.1.50', '192.168.0.50'), kind: 'response' },
    { address: '192.168.0.2', response: ssdp('HTTP/1.1 200 OK', { ST: 'upnp:rootdevice', LOCATION: 'http://192.168.0.2/r.xml' }), kind: 'response' },
    { address: '192.168.0.249', response: 'M-SEARCH * HTTP/1.1\r\nST: ssdp:all\r\n\r\n', kind: 'notify' },
  ]);
  const hosts = followUpHosts(
    summary.senders,
    [
      { location: 'http://192.168.0.40/p.xml', sender: '192.168.0.40', outcome: { kind: 'not-a-renderer' } },
      { location: 'http://192.168.0.50:49152/description.xml', sender: '192.168.0.50', outcome: { kind: 'ok', name: 'TV' } },
      { location: 'http://192.168.0.2/r.xml', sender: '192.168.0.2', outcome: { kind: 'not-a-renderer', info: { router: true } } },
    ],
    ['192.168.0.249'],
  );
  assert.deepEqual(hosts, ['192.168.0.23', '192.168.0.40']);
  // A likely TV seen after another device still goes first.
  const printerFirst = summarizeSsdp([
    { address: '192.168.0.40', response: ssdp('HTTP/1.1 200 OK', { ST: 'upnp:rootdevice' }), kind: 'response' },
    USER_CASE_PACKETS[5],
  ]);
  assert.deepEqual(followUpHosts(printerFirst.senders, [], []), ['192.168.0.23', '192.168.0.40']);
  const many = summarizeSsdp(
    Array.from({ length: 12 }, (_, index) => ({
      address: `192.168.0.${100 + index}`,
      response: ssdp('HTTP/1.1 200 OK', { ST: 'upnp:rootdevice' }),
      kind: 'response' as const,
    })),
  );
  assert.equal(followUpHosts(many.senders, [], []).length, 8);
});

// --- TV browser receiver S6: report clean-up ---

test("the phone's own M-SEARCH packets are not listed as a device (sender = the phone's Wi-Fi address)", () => {
  const summary = summarizeSsdp([
    ...USER_CASE_PACKETS,
    { address: '192.168.0.249', response: 'M-SEARCH * HTTP/1.1\r\nST: ssdp:all\r\n\r\n', kind: 'notify' },
    { address: '::ffff:192.168.0.249', response: 'M-SEARCH * HTTP/1.1\r\nST: ssdp:all\r\n\r\n', kind: 'notify' },
  ]);
  assert.deepEqual(
    withoutOwnSenders(summary.senders, '192.168.0.249').map((sender) => sender.address),
    ['192.168.0.1', '192.168.0.23'],
  );
  // Unknown phone address: nothing is dropped.
  assert.equal(withoutOwnSenders(summary.senders, '').length, 3);
  const lines = formatDiscoveryReport({ ...USER_CASE_REPORT(), senders: withoutOwnSenders(summary.senders, '192.168.0.249') });
  assert.ok(lines.includes('Aparatos que respondieron: 2'));
  assert.ok(!lines.some((line) => line.startsWith('192.168.0.249')));
});

test('the sheet suggests the TV browser when the only TV-like device answers DIAL only', () => {
  // User case: router + DIAL-only Hisense, no renderer.
  assert.equal(suggestsBrowserReceiver(USER_CASE_REPORT()), true);
  // A DLNA renderer was found: no suggestion.
  assert.equal(
    suggestsBrowserReceiver({
      ...USER_CASE_REPORT(),
      locations: [
        ...USER_CASE_REPORT().locations,
        { location: 'http://192.168.0.50:49152/description.xml', sender: '192.168.0.50', outcome: { kind: 'ok' as const, name: 'TV' } },
      ],
    }),
    false,
  );
  // Only the router answered.
  const onlyRouter = summarizeSsdp([{ address: '192.168.0.1', response: routerReply('urn:schemas-upnp-org:service:WANIPConnection:1'), kind: 'response' }]);
  assert.equal(suggestsBrowserReceiver({ mode: 'multicast', responses: 1, notifies: 0, senders: onlyRouter.senders, locations: [] }), false);
  // A TV brand that does not answer DIAL is not "DIAL only".
  const vidaaNoDial = summarizeSsdp([{ address: '192.168.0.23', response: hisenseReply('upnp:rootdevice'), kind: 'response' }]);
  assert.equal(suggestsBrowserReceiver({ mode: 'multicast', responses: 1, notifies: 0, senders: vidaaNoDial.senders, locations: [] }), false);
  // Nothing answered / no report.
  assert.equal(suggestsBrowserReceiver({ mode: 'multicast', responses: 0, notifies: 0, locations: [] }), false);
  assert.equal(suggestsBrowserReceiver(null), false);
});

test('GetTransportInfo yields the transport state, or DESCONOCIDO', () => {
  const xml =
    '<s:Envelope><s:Body><u:GetTransportInfoResponse xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">' +
    '<CurrentTransportState>PAUSED_PLAYBACK</CurrentTransportState><CurrentTransportStatus>OK</CurrentTransportStatus>' +
    '</u:GetTransportInfoResponse></s:Body></s:Envelope>';
  assert.equal(parseTransportState(xml), 'PAUSED_PLAYBACK');
  assert.equal(parseTransportState('<x/>'), 'DESCONOCIDO');
});

test('a DLNA cast ended when the TV stopped after having played, or reached the last 2 s', () => {
  // Loading: STOPPED/TRANSITIONING before it ever played is not the end.
  assert.deepEqual(dlnaPlayback({ state: 'STOPPED', position: 0, duration: null, played: false }), {
    ended: false,
    played: false,
    paused: undefined,
  });
  assert.deepEqual(dlnaPlayback({ state: 'TRANSITIONING', position: null, duration: null, played: false }), {
    ended: false,
    played: false,
    paused: undefined,
  });
  assert.deepEqual(dlnaPlayback({ state: 'PLAYING', position: 5, duration: 600, played: false }), {
    ended: false,
    played: true,
    paused: false,
  });
  assert.deepEqual(dlnaPlayback({ state: 'PAUSED_PLAYBACK', position: 50, duration: 600, played: true }), {
    ended: false,
    played: true,
    paused: true,
  });
  assert.equal(dlnaPlayback({ state: 'STOPPED', position: 0, duration: null, played: true }).ended, true);
  assert.equal(dlnaPlayback({ state: 'NO_MEDIA_PRESENT', position: null, duration: null, played: true }).ended, true);
  assert.equal(dlnaPlayback({ state: 'PLAYING', position: 598, duration: 600, played: true }).ended, true);
  assert.equal(dlnaPlayback({ state: 'PLAYING', position: 597, duration: 600, played: true }).ended, false);
  // The last 2 s only count once it has played (a stale position from the previous video does not).
  assert.equal(dlnaPlayback({ state: 'TRANSITIONING', position: 600, duration: 600, played: false }).ended, false);
});
