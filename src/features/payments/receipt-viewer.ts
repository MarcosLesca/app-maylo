// HTML for the in-app receipt viewer (rendered in a WebView, so no browser is needed).
// Images load from their signed URL; PDFs are downloaded by the app and handed to
// pdf.js as data, so the document never goes through a third party and CORS never applies.

export const PDFJS_VERSION = '3.11.174';
const PDFJS_BASE = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}`;

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Standard base64 (with padding), without relying on Buffer or btoa. */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += B64[a >> 2];
    out += B64[((a & 3) << 4) | ((b ?? 0) >> 4)];
    out += b === undefined ? '=' : B64[((b & 15) << 2) | ((c ?? 0) >> 6)];
    out += c === undefined ? '=' : B64[c & 63];
  }
  return out;
}

const escapeAttr = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#39;');

type ViewerSource = { kind: 'image'; url: string } | { kind: 'pdf'; base64: string };

const page = (body: string, background: string) => `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=5, user-scalable=yes">
<style>
  html, body { margin: 0; background: ${background}; }
  body { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 12px 0; min-height: 100vh; box-sizing: border-box; }
  img, canvas { max-width: 100%; height: auto; box-shadow: 0 2px 10px rgba(0,0,0,.25); background: #fff; }
  body.image { justify-content: center; }
</style>
</head>
${body}
</html>`;

export function viewerHtml(source: ViewerSource, background = '#2B2622'): string {
  if (source.kind === 'image') {
    return page(
      `<body class="image">
<img src="${escapeAttr(source.url)}" alt="Comprobante"
  onload="window.ReactNativeWebView && window.ReactNativeWebView.postMessage('ready')"
  onerror="window.ReactNativeWebView && window.ReactNativeWebView.postMessage('error:No se pudo cargar la imagen')">
</body>`,
      background,
    );
  }

  return page(
    `<body>
<script src="${PDFJS_BASE}/pdf.min.js"></script>
<script>
  (async function () {
    const post = (m) => window.ReactNativeWebView && window.ReactNativeWebView.postMessage(m);
    try {
      pdfjsLib.GlobalWorkerOptions.workerSrc = '${PDFJS_BASE}/pdf.worker.min.js';
      const raw = atob(${JSON.stringify(source.base64)});
      const data = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) data[i] = raw.charCodeAt(i);
      const pdf = await pdfjsLib.getDocument({ data }).promise;
      const ratio = window.devicePixelRatio || 1;
      for (let n = 1; n <= pdf.numPages; n++) {
        const pdfPage = await pdf.getPage(n);
        const base = pdfPage.getViewport({ scale: 1 });
        const scale = (document.body.clientWidth - 24) / base.width;
        const viewport = pdfPage.getViewport({ scale: scale * ratio });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = (viewport.width / ratio) + 'px';
        document.body.appendChild(canvas);
        await pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        if (n === 1) post('ready');
      }
    } catch (e) {
      post('error:' + (e && e.message ? e.message : 'No se pudo abrir el PDF'));
    }
  })();
</script>
</body>`,
    background,
  );
}
