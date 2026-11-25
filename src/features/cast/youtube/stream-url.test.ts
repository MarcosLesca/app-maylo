import assert from 'node:assert/strict';
import { test } from 'node:test';

import { nParam, rangeUrl, streamUrl } from './stream-url.ts';

const URL_N = 'https://rr1---sn-x.googlevideo.com/videoplayback?expire=1&ei=a&n=AbCdEf-_123&itag=299&c=TVHTML5_SIMPLY';

test('nParam reads the n query value, null when absent', () => {
  assert.equal(nParam(URL_N), 'AbCdEf-_123');
  assert.equal(nParam('https://x.googlevideo.com/videoplayback?n=a%2Bb&x=1'), 'a+b');
  assert.equal(nParam('https://x.googlevideo.com/videoplayback?itag=1&sn=zz'), null);
  assert.equal(nParam('https://x.googlevideo.com/videoplayback'), null);
});

test('streamUrl swaps in the deciphered n and appends the PO token as pot (L7)', () => {
  assert.equal(
    streamUrl(URL_N, 'Xy_9', 'MnAb-_c='),
    'https://rr1---sn-x.googlevideo.com/videoplayback?expire=1&ei=a&n=Xy_9&itag=299&c=TVHTML5_SIMPLY&pot=MnAb-_c%3D',
  );
  // A previous pot is replaced, not repeated; the deciphered n is URL-encoded.
  assert.equal(
    streamUrl('https://x.googlevideo.com/videoplayback?n=a&pot=old&itag=1', 'b/c', 'new'),
    'https://x.googlevideo.com/videoplayback?n=b%2Fc&itag=1&pot=new',
  );
  // No n in the URL: only the token is added.
  assert.equal(streamUrl('https://x.googlevideo.com/videoplayback?itag=1', null, 'tok'), 'https://x.googlevideo.com/videoplayback?itag=1&pot=tok');
});

test('rangeUrl asks googlevideo for a byte range in the query', () => {
  assert.equal(rangeUrl('https://x.googlevideo.com/videoplayback?itag=1', 739, 806), 'https://x.googlevideo.com/videoplayback?itag=1&range=739-806');
});
