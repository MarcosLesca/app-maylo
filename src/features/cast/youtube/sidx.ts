/**
 * Media segments of a fragmented MP4 from its `sidx` box (ISO/IEC 14496-12
 * §8.16.3), which YouTube's `indexRange` points at (S3). Each reference is one
 * subsegment (a `moof` + `mdat` pair) that becomes one HLS segment.
 * Pure, no imports, so it is tested in Node.
 */

/** Inclusive byte range in the file and its duration in seconds. */
export type MediaSegment = { start: number; end: number; duration: number };

const SIDX = 0x73696478; // 'sidx'

function invalid(reason: string): Error {
  return new Error(`El índice (sidx) del video no es válido: ${reason}.`);
}

/**
 * `bytes` are the file bytes starting at file offset `offset` (the
 * `indexRange.start`); they must contain the whole sidx box.
 */
export function parseSidx(bytes: Uint8Array, offset: number): MediaSegment[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u64 = (at: number) => view.getUint32(at) * 2 ** 32 + view.getUint32(at + 4);

  // Find the sidx among the top-level boxes of the range.
  let box = 0;
  let boxSize = 0;
  let header = 8;
  for (;;) {
    if (box + 8 > bytes.length) throw invalid('no está la caja sidx');
    boxSize = view.getUint32(box);
    header = 8;
    if (boxSize === 1) {
      if (box + 16 > bytes.length) throw invalid('no está la caja sidx');
      boxSize = u64(box + 8);
      header = 16;
    }
    if (boxSize < header) throw invalid('caja con tamaño imposible');
    if (view.getUint32(box + 4) === SIDX) break;
    box += boxSize;
  }
  if (box + boxSize > bytes.length) throw invalid('la caja sidx está incompleta');

  let at = box + header;
  const version = view.getUint8(at);
  at += 4 + 4; // version + flags, reference_ID
  const timescale = view.getUint32(at);
  at += 4;
  if (timescale === 0) throw invalid('timescale 0');
  let firstOffset: number;
  if (version === 0) {
    firstOffset = view.getUint32(at + 4);
    at += 8;
  } else {
    firstOffset = u64(at + 8);
    at += 16;
  }
  const count = view.getUint16(at + 2);
  at += 4;
  if (count === 0) throw invalid('no lista segmentos');
  if (at + count * 12 > box + boxSize) throw invalid('la caja sidx está incompleta');

  // Offsets count from the first byte after the sidx box.
  let start = offset + box + boxSize + firstOffset;
  const segments: MediaSegment[] = [];
  for (let i = 0; i < count; i++, at += 12) {
    const reference = view.getUint32(at);
    if (reference >>> 31 === 1) throw invalid('índice jerárquico (sidx dentro de sidx)');
    const size = reference & 0x7fffffff;
    const duration = view.getUint32(at + 4) / timescale;
    segments.push({ start, end: start + size - 1, duration });
    start += size;
  }
  return segments;
}
