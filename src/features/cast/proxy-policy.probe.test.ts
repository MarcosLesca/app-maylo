import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseDeviceDescription, parseMute, parseVolume } from './dlna.ts';
import { base64UrlEncode, rewritePlaylist } from './hls.ts';
import { AllowedTargets, cookieAllowed } from './proxy-policy.ts';
import { clampSeek, formatHms, parseHms, parsePositionInfo } from './time.ts';

test('cookie goes only to the exact page host, never downgraded or without a page', () => {
  const page = 'https://a.com/watch';
  assert.equal(cookieAllowed('https://a.com/v.m3u8', page), true);
  assert.equal(cookieAllowed('https://A.COM/v.m3u8', page), true);
  assert.equal(cookieAllowed('https://cdn.a.com/v.m3u8', page), false);
  assert.equal(cookieAllowed('https://a.com.evil.com/v.m3u8', page), false);
  assert.equal(cookieAllowed('http://a.com/v.m3u8', page), false);
  assert.equal(cookieAllowed('https://a.com/v.m3u8', ''), false);
  assert.equal(cookieAllowed('https://a.com/v.m3u8', 'file:///a.com/x'), false);
});

test('allowed targets match exactly and drop the least recently used first', () => {
  const allowed = new AllowedTargets('https://a.com/master.m3u8', 3);
  assert.equal(allowed.has('https://a.com/master.m3u8'), true);
  assert.equal(allowed.has('https://a.com/master.m3u8?'), false);
  allowed.add('https://a.com/1.ts');
  allowed.add('https://a.com/2.ts');
  allowed.has('https://a.com/master.m3u8'); // touch: master is now the most recent
  allowed.add('https://a.com/3.ts');
  assert.equal(allowed.has('https://a.com/1.ts'), false);
  assert.equal(allowed.has('https://a.com/master.m3u8'), true);
  assert.equal(allowed.size, 3);
});

test('the rewrite reports exactly the URIs it wraps', () => {
  const seen: string[] = [];
  const out = rewritePlaylist(
    '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://abc"\n' +
      '#EXT-X-MAP:URI="data:text/plain;base64,AAA"\n#EXT-X-MAP:URI="../init.mp4"\nlow/index.m3u8\nseg1.ts\n',
    'https://h.com/a/b/master.m3u8',
    'http://p:1/s/t',
    (target) => seen.push(target),
  );
  assert.deepEqual(seen.sort(), [
    'https://h.com/a/b/key.bin',
    'https://h.com/a/b/low/index.m3u8',
    'https://h.com/a/b/seg1.ts',
    'https://h.com/a/init.mp4',
  ]);
  assert.ok(out.includes(base64UrlEncode('https://h.com/a/b/seg1.ts')));
});

test('seek targets stay inside the video and unknown durations read as null', () => {
  assert.equal(clampSeek(-5, 100), 0);
  assert.equal(clampSeek(105, 100), 100);
  assert.equal(formatHms(3725), '1:02:05');
  assert.equal(parseHms('NOT_IMPLEMENTED'), null);
  assert.equal(
    parsePositionInfo('<RelTime>0:00:10</RelTime><TrackDuration>0:00:00</TrackDuration>').duration,
    null,
  );
});

test('volume control stays on the TV host and its values are bounded', () => {
  const description = (renderingPath: string) => `<root><device><friendlyName>TV</friendlyName><serviceList>
    <service><serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType><controlURL>/avt</controlURL></service>
    <service><serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType><controlURL>${renderingPath}</controlURL></service>
  </serviceList></device></root>`;
  const location = 'http://192.168.1.50:49152/description.xml';
  assert.equal(parseDeviceDescription(description('http://10.0.0.9/rc'), location)?.renderingControlUrl, undefined);
  assert.equal(
    parseDeviceDescription(description('rc/ctrl'), location)?.renderingControlUrl,
    'http://192.168.1.50:49152/rc/ctrl',
  );
  assert.equal(parseVolume('<CurrentVolume>150</CurrentVolume>'), 100);
  assert.equal(parseVolume('<CurrentVolume>-1</CurrentVolume>'), null);
  assert.equal(parseMute('<CurrentMute>TRUE</CurrentMute>'), true);
});
