import { engineCallScript, parseEngineReply } from './engine-script';
import { YOUTUBE_MESSAGES } from './formats';

/**
 * App side of the engine WebView (engine-script.ts): one mounted
 * <YoutubeEngineView /> attaches here; calls are injected into it and resolved
 * by its replies. Every failure is the Spanish token message, since the user
 * can only retry.
 */

export type EngineCall = 'botguard' | 'mint' | 'player' | 'n';

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };

/** How long a call waits for the engine page to be mounted and loaded. */
const ATTACH_WAIT_MS = 10_000;
const CALL_TIMEOUT_MS = 45_000;

let inject: ((script: string) => void) | null = null;
const waiters = new Set<() => void>();
const pending = new Map<string, Pending>();
let nextId = 0;

const failure = () => new Error(YOUTUBE_MESSAGES.token);

function settle(id: string, outcome: { value: unknown } | { error: Error }) {
  const call = pending.get(id);
  if (!call) return;
  pending.delete(id);
  clearTimeout(call.timer);
  if ('error' in outcome) call.reject(outcome.error);
  else call.resolve(outcome.value);
}

/** The loaded engine page registers how to run a script in it; the returned function detaches it. */
export function attachEngine(run: (script: string) => void): () => void {
  inject = run;
  waiters.forEach((wake) => wake());
  waiters.clear();
  return () => {
    if (inject !== run) return;
    inject = null;
    for (const id of [...pending.keys()]) settle(id, { error: failure() });
  };
}

/** Handles a message of the engine WebView; false when it is not an engine reply. */
export function handleEngineMessage(data: string): boolean {
  const reply = parseEngineReply(data);
  if (!reply) return false;
  if (reply.ok) settle(reply.id, { value: reply.value });
  else settle(reply.id, { error: new Error(reply.error) });
  return true;
}

function attached(): Promise<(script: string) => void> {
  if (inject) return Promise.resolve(inject);
  return new Promise((resolve, reject) => {
    const wake = () => {
      clearTimeout(timer);
      if (inject) resolve(inject);
      else reject(failure());
    };
    const timer = setTimeout(() => {
      waiters.delete(wake);
      reject(failure());
    }, ATTACH_WAIT_MS);
    waiters.add(wake);
  });
}

/** Runs one engine call; rejects with the engine's own error text (callers map it to the Spanish message). */
export async function callEngine(type: EngineCall, payload: object): Promise<unknown> {
  const run = await attached();
  const id = `e${++nextId}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => settle(id, { error: new Error(`${type}: timeout`) }), CALL_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    run(engineCallScript(id, type, payload));
  });
}
