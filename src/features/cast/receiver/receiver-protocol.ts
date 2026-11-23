/**
 * Pure rules of the TV browser receiver's HTTP side (S1, S4): ports, key,
 * routes, the command queue and the state limits. The native server
 * (modules/tv-cast/android/.../ReceiverProtocol.kt) mirrors this line for
 * line; these tests pin it.
 */

/** Fixed port first, then the next ones; the screen shows the one that was free. */
export const RECEIVER_PORTS: readonly number[] = Array.from({ length: 11 }, (_, index) => 8765 + index);

/** Commands kept for the TV; older ones are dropped. */
export const MAX_COMMANDS = 50;

/** Largest state body the TV may POST. */
export const MAX_STATE_BYTES = 16 * 1024;

/** How long an idle commands request waits before answering empty. */
export const LONG_POLL_MS = 25_000;

/** Concurrent waiting commands requests; extra ones answer empty at once. */
export const MAX_LONG_POLLS = 2;

/** The receiver is connected while its last state is at most this old. */
export const CONNECTED_WINDOW_MS = 5_000;

const KEY = /^[A-Za-z0-9]{6}$/;
const AFTER = /^\d{1,15}$/;

export function isReceiverKey(key: string): boolean {
  return KEY.test(key);
}

export type ReceiverRoute =
  | { kind: 'page' }
  | { kind: 'hls' }
  | { kind: 'commands'; after: number }
  | { kind: 'state' }
  | { kind: 'not-found' }
  | { kind: 'method-not-allowed' };

/** `after` of a query string; missing or not a plain non-negative integer means 0. */
export function parseAfter(query: string): number {
  for (const pair of query.split('&')) {
    const equals = pair.indexOf('=');
    if (equals < 0 || pair.slice(0, equals) !== 'after') continue;
    const value = pair.slice(equals + 1);
    return AFTER.test(value) ? Number(value) : 0;
  }
  return 0;
}

/**
 * Route of a request for the receiver whose key is `key` ('' when stopped);
 * null when the path is not under `/tv` (the proxy's). A wrong key and an
 * unknown path are both not found.
 */
export function routeReceiver(method: string, target: string, key: string): ReceiverRoute | null {
  const hash = target.indexOf('#');
  const withoutHash = hash < 0 ? target : target.slice(0, hash);
  const question = withoutHash.indexOf('?');
  const path = question < 0 ? withoutHash : withoutHash.slice(0, question);
  const query = question < 0 ? '' : withoutHash.slice(question + 1);
  if (path !== '/tv' && !path.startsWith('/tv/')) return null;
  const segments = path.split('/'); // "", "tv", key, rest...
  if (segments.length < 3 || key === '' || !isReceiverKey(segments[2]) || segments[2] !== key) {
    return { kind: 'not-found' };
  }
  const rest = segments.length === 3 ? '' : segments.length === 4 ? segments[3] : null;
  const read = method === 'GET' || method === 'HEAD';
  switch (rest) {
    case '':
      return read ? { kind: 'page' } : { kind: 'method-not-allowed' };
    case 'hls.js':
      return read ? { kind: 'hls' } : { kind: 'method-not-allowed' };
    case 'commands':
      return method === 'GET' ? { kind: 'commands', after: parseAfter(query) } : { kind: 'method-not-allowed' };
    case 'state':
      return method === 'POST' ? { kind: 'state' } : { kind: 'method-not-allowed' };
    default:
      return { kind: 'not-found' };
  }
}

/** A JSON object text, or null for anything else (arrays, scalars, trailing garbage). */
function parseObject(json: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(json);
    return value != null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * The last MAX_COMMANDS commands, each serialized as `{"id":n, ...command}`
 * with ids increasing from `firstId` for the whole run (clear() keeps counting).
 */
export class CommandQueue {
  private nextId: number;
  private readonly items: { id: number; json: string }[] = [];

  constructor(firstId: number) {
    this.nextId = firstId;
  }

  /** Highest id issued this run (firstId - 1 when none). */
  get lastId(): number {
    return this.nextId - 1;
  }

  /** Appends `command` (a JSON object text) and returns its id; throws for anything else. */
  push(command: string): number {
    const parsed = parseObject(command);
    if (parsed == null) throw new Error('The command must be a JSON object.');
    const id = this.nextId;
    this.nextId += 1;
    const ordered: Record<string, unknown> = { id };
    for (const [name, value] of Object.entries(parsed)) if (name !== 'id') ordered[name] = value;
    this.items.push({ id, json: JSON.stringify(ordered) });
    if (this.items.length > MAX_COMMANDS) this.items.splice(0, this.items.length - MAX_COMMANDS);
    return id;
  }

  /**
   * Commands with an id above `after`, oldest first. A cursor above the
   * highest id this run issued comes from a previous run: it means 0.
   */
  since(after: number): string[] {
    const cursor = after > this.lastId ? 0 : after;
    return this.items.filter((item) => item.id > cursor).map((item) => item.json);
  }

  clear(): void {
    this.items.length = 0;
  }
}

export function commandsBody(commands: readonly string[]): string {
  return `{"commands":[${commands.join(',')}]}`;
}

/** Why a state POST with this Content-Length is refused (411/413), or null to read it. */
export function stateBodyError(contentLength: string | undefined): 411 | 413 | null {
  if (contentLength == null || !/^\d+$/.test(contentLength)) return 411;
  if (contentLength.length > 9 || Number(contentLength) > MAX_STATE_BYTES) return 413;
  return null;
}

export function isConnected(lastSeenMs: number, nowMs: number): boolean {
  return lastSeenMs > 0 && nowMs - lastSeenMs <= CONNECTED_WINDOW_MS;
}
