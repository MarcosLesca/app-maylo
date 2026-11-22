import assert from 'node:assert/strict';
import { test } from 'node:test';

import { clampSeek, formatClock, formatHms, parseHms, parsePositionInfo, spokenTime } from './time.ts';

test('H:MM:SS from the TV becomes whole seconds', () => {
  assert.equal(parseHms('0:12:04'), 724);
  assert.equal(parseHms('01:36:00'), 5760);
  assert.equal(parseHms('0:00:00'), 0);
  assert.equal(parseHms('0:12:04.750'), 724);
  assert.equal(parseHms(' 0:12:04 '), 724);
});

test('unknown or malformed times are null', () => {
  assert.equal(parseHms('NOT_IMPLEMENTED'), null);
  assert.equal(parseHms(''), null);
  assert.equal(parseHms(undefined), null);
  assert.equal(parseHms('12:04'), null);
  assert.equal(parseHms('0:61:00'), null);
  assert.equal(parseHms('-0:00:10'), null);
});

test('seconds become the H:MM:SS target Seek expects', () => {
  assert.equal(formatHms(724), '0:12:04');
  assert.equal(formatHms(5760), '1:36:00');
  assert.equal(formatHms(0), '0:00:00');
  assert.equal(formatHms(59.9), '0:00:59');
  assert.equal(formatHms(-5), '0:00:00');
});

test('parse and format round-trip', () => {
  for (const seconds of [0, 1, 59, 60, 724, 3599, 3600, 5760, 36000]) {
    assert.equal(parseHms(formatHms(seconds)), seconds);
  }
});

test('the clock under the bar drops the hour when there is none', () => {
  assert.equal(formatClock(724), '12:04');
  assert.equal(formatClock(5760), '1:36:00');
  assert.equal(formatClock(5), '0:05');
  assert.equal(formatClock(null), '--:--');
});

test('spoken time for screen readers', () => {
  assert.equal(spokenTime(724), '12 minutos 4 segundos');
  assert.equal(spokenTime(5760), '1 hora 36 minutos');
  assert.equal(spokenTime(7201), '2 horas 1 segundo');
  assert.equal(spokenTime(0), '0 segundos');
});

test('seek target stays inside the video', () => {
  assert.equal(clampSeek(724 - 10, 5760), 714);
  assert.equal(clampSeek(5 - 10, 5760), 0);
  assert.equal(clampSeek(5755 + 10, 5760), 5760);
  assert.equal(clampSeek(12.6, 5760), 13);
  assert.equal(clampSeek(-3, null), 0);
  assert.equal(clampSeek(9000, null), 9000);
});

const POSITION_INFO = `<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>
<u:GetPositionInfoResponse xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
<Track>1</Track><TrackDuration>1:36:00</TrackDuration><TrackMetaData></TrackMetaData>
<TrackURI>http://x</TrackURI><RelTime>0:12:04</RelTime><AbsTime>NOT_IMPLEMENTED</AbsTime>
</u:GetPositionInfoResponse></s:Body></s:Envelope>`;

test('GetPositionInfo yields position and duration in seconds', () => {
  assert.deepEqual(parsePositionInfo(POSITION_INFO), { position: 724, duration: 5760 });
});

test('GetPositionInfo without a usable duration or position reports null', () => {
  const unknown = POSITION_INFO.replace('<TrackDuration>1:36:00', '<TrackDuration>0:00:00').replace(
    '<RelTime>0:12:04',
    '<RelTime>NOT_IMPLEMENTED',
  );
  assert.deepEqual(parsePositionInfo(unknown), { position: null, duration: null });
  assert.deepEqual(parsePositionInfo('<x/>'), { position: null, duration: null });
});
