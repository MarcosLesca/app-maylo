export type HeadlessMessage = {
  kind: 'message';
  title: string;
  body: string;
  url: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/**
 * Reads the payload a background notification task receives. Headless pushes
 * arrive as `{ notification: null, data: { dataString: "<json>" } }`; taps on a
 * notification arrive as a response (with `actionIdentifier`) and are ignored here.
 * Anything unexpected resolves to null so the background task never throws.
 */
export function parseHeadlessPayload(payload: unknown): HeadlessMessage | null {
  if (!isRecord(payload) || 'actionIdentifier' in payload || !isRecord(payload.data)) return null;

  let data: unknown = payload.data;
  const { dataString } = payload.data;
  if (typeof dataString === 'string') {
    try {
      data = JSON.parse(dataString);
    } catch {
      return null;
    }
  }

  if (!isRecord(data) || data.kind !== 'message') return null;
  const { title, body, url } = data;
  if (typeof title !== 'string' || typeof body !== 'string' || typeof url !== 'string') return null;
  return { kind: 'message', title, body, url };
}
