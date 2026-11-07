import assert from 'node:assert/strict';
import { test } from 'node:test';

import { bytesToBase64, PDFJS_VERSION, viewerHtml } from './receipt-viewer.ts';

test('base64 matches the standard encoding for every padding case', () => {
  for (const length of [0, 1, 2, 3, 4, 5, 255, 1000]) {
    const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + 11) % 256);
    assert.equal(bytesToBase64(bytes), Buffer.from(bytes).toString('base64'), `length ${length}`);
  }
});

test('image viewer shows the image and allows pinch zoom', () => {
  const html = viewerHtml({ kind: 'image', url: 'https://x.supabase.co/sign/a.jpg?token=abc&t=1' });
  assert.match(html, /<img [^>]*src="https:\/\/x\.supabase\.co\/sign\/a\.jpg\?token=abc&amp;t=1"/);
  assert.match(html, /user-scalable=yes/);
});

test('image URLs cannot break out of the attribute', () => {
  const html = viewerHtml({ kind: 'image', url: 'https://x/"><script>alert(1)</script>' });
  assert.doesNotMatch(html, /<script>alert/);
});

test('pdf viewer loads the pinned pdf.js build and embeds the document data', () => {
  const html = viewerHtml({ kind: 'pdf', base64: 'JVBERi0x' });
  assert.ok(html.includes(`/pdf.js/${PDFJS_VERSION}/pdf.min.js`));
  assert.ok(html.includes(`/pdf.js/${PDFJS_VERSION}/pdf.worker.min.js`));
  assert.ok(html.includes('"JVBERi0x"'));
});
