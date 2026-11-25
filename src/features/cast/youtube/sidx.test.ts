import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseSidx } from './sidx.ts';

const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n: number) => [(n >>> 8) & 255, n & 255];
const u64 = (n: number) => [...u32(Math.floor(n / 2 ** 32)), ...u32(n % 2 ** 32)];
const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

type Ref = { size: number; duration: number; type?: 0 | 1 };

/** A sidx box as YouTube writes it: references to media subsegments, starting with a SAP. */
function sidx(version: 0 | 1, timescale: number, firstOffset: number, refs: Ref[]): number[] {
  const times = version === 0 ? [...u32(0), ...u32(firstOffset)] : [...u64(0), ...u64(firstOffset)];
  const body = [
    version, 0, 0, 0,
    ...u32(1), // reference_ID
    ...u32(timescale),
    ...times,
    ...u16(0), // reserved
    ...u16(refs.length),
    ...refs.flatMap((ref) => [...u32(((ref.type ?? 0) << 31) | ref.size), ...u32(ref.duration), ...u32(0x90000000)]),
  ];
  return [...u32(8 + body.length), ...ascii('sidx'), ...body];
}

test('parseSidx (version 0) lists byte ranges right after the box, with durations in seconds', () => {
  const box = sidx(0, 1000, 0, [
    { size: 1000, duration: 5005 },
    { size: 2000, duration: 5005 },
    { size: 500, duration: 2500 },
  ]);
  // The box sits at file offset 739 (indexRange.start); the media starts right after it.
  const after = 739 + box.length;
  assert.deepEqual(parseSidx(Uint8Array.from(box), 739), [
    { start: after, end: after + 999, duration: 5.005 },
    { start: after + 1000, end: after + 2999, duration: 5.005 },
    { start: after + 3000, end: after + 3499, duration: 2.5 },
  ]);
});

test('parseSidx (version 1) reads 64-bit times and honours first_offset', () => {
  const box = sidx(1, 44100, 16, [
    { size: 4096, duration: 441000 },
    { size: 100, duration: 22050 },
  ]);
  const first = 632 + box.length + 16;
  assert.deepEqual(parseSidx(Uint8Array.from(box), 632), [
    { start: first, end: first + 4095, duration: 10 },
    { start: first + 4096, end: first + 4195, duration: 0.5 },
  ]);
});

test('parseSidx finds the sidx after other boxes in the range', () => {
  const free = [...u32(12), ...ascii('free'), 1, 2, 3, 4];
  const box = sidx(0, 90000, 0, [{ size: 10, duration: 90000 }]);
  const start = 100 + free.length + box.length;
  assert.deepEqual(parseSidx(Uint8Array.from([...free, ...box]), 100), [{ start, end: start + 9, duration: 1 }]);
});

test('parseSidx rejects missing, truncated and hierarchical indexes', () => {
  assert.throws(() => parseSidx(Uint8Array.from([...u32(8), ...ascii('free')]), 0), /sidx/);
  assert.throws(() => parseSidx(new Uint8Array(0), 0), /sidx/);
  const box = sidx(0, 1000, 0, [{ size: 1, duration: 1 }, { size: 1, duration: 1 }]);
  assert.throws(() => parseSidx(Uint8Array.from(box.slice(0, box.length - 4)), 0), /sidx/);
  assert.throws(() => parseSidx(Uint8Array.from(sidx(0, 1000, 0, [{ size: 1, duration: 1, type: 1 }])), 0), /sidx/);
  assert.throws(() => parseSidx(Uint8Array.from(sidx(0, 0, 0, [{ size: 1, duration: 1 }])), 0), /sidx/);
  assert.throws(() => parseSidx(Uint8Array.from(sidx(0, 1000, 0, [])), 0), /sidx/);
});
