import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  hostOf,
  buildDidlLite,
  buildSoapEnvelope,
  mimeTypeFor,
  parseDeviceDescription,
  parseSsdpHeaders,
  rendererLocations,
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

test('device description yields the name and the AVTransport control URL resolved against the location', () => {
  assert.deepEqual(parseDeviceDescription(DESCRIPTION, 'http://192.168.1.50:49152/dev/description.xml'), {
    name: 'Hisense 50A4NV & Co',
    controlUrl: 'http://192.168.1.50:49152/dev/upnp/control/avtransport',
  });
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

test('SOAP envelope wraps the action with escaped arguments in order', () => {
  const body = buildSoapEnvelope('SetAVTransportURI', { InstanceID: '0', CurrentURI: 'http://a?x=1&y=2' });
  assert.match(body, /<u:SetAVTransportURI xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">/);
  assert.match(body, /<InstanceID>0<\/InstanceID><CurrentURI>http:\/\/a\?x=1&amp;y=2<\/CurrentURI>/);
  assert.match(body, /<\/u:SetAVTransportURI><\/s:Body><\/s:Envelope>$/);
});
