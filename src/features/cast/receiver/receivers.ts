/**
 * Pure rules of the shared receiver list (cast_receivers, one row per member):
 * which addresses the receiver page polls, how each phone is named and what the
 * connect screen says. No imports, so it is tested in Node; the Supabase calls
 * live in receivers-api.ts.
 */

/** Same rule as the table's check (0015_cast_receivers.sql). */
const RECEIVER_URL = /^http:\/\/[0-9.]+:[0-9]+\/tv\/[A-Za-z0-9]{6}$/i;

/** Longest member name shown in a label. */
const MAX_NAME = 40;

/** A row of public.cast_receivers as the app selects it. */
export type ReceiverRow = { user_id: string; url: string; member_name: string | null };

/** One phone of the list; `isOwn` is this phone. */
export type SharedReceiver = { userId: string; url: string; name: string; label: string; isOwn: boolean };

/** Another phone the receiver page also polls. */
export type PagePeer = { url: string; label: string };

/** loading: first sync pending; missing: table not created yet (migration not run); error: any other failure. */
export type SharedStatus = 'loading' | 'ready' | 'missing' | 'error';

export function isSharedReceiverUrl(url: unknown): url is string {
  return typeof url === 'string' && RECEIVER_URL.test(url);
}

/** "MayLo de <nombre>", or "MayLo" when the name is unknown. */
export function phoneLabel(name: string | null | undefined): string {
  const clean = (name ?? '').trim().slice(0, MAX_NAME);
  return clean ? `MayLo de ${clean}` : 'MayLo';
}

const hostPort = (url: string) => /^http:\/\/([^/]+)/i.exec(url)?.[1].toLowerCase() ?? '';

/**
 * This phone first, with its live address (its row may be stale), then the
 * other members' phones with a valid URL that is not this phone's host:port
 * (an old row of someone whose IP this phone now has), by label.
 */
export function sharedReceivers(
  rows: readonly ReceiverRow[],
  own: { userId: string; url: string; name: string },
): SharedReceiver[] {
  const ownHost = hostPort(own.url);
  const others = rows
    .filter((row) => row.user_id !== own.userId && isSharedReceiverUrl(row.url) && hostPort(row.url) !== ownHost)
    .map((row) => {
      const name = (row.member_name ?? '').trim();
      return { userId: row.user_id, url: row.url, name, label: phoneLabel(name), isOwn: false };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
  return [{ userId: own.userId, url: own.url, name: own.name.trim(), label: phoneLabel(own.name), isOwn: true }, ...others];
}

/** The phones besides this one, as the receiver page embeds them. */
export function pagePeers(list: readonly SharedReceiver[]): PagePeer[] {
  return list.filter((receiver) => !receiver.isOwn).map(({ url, label }) => ({ url, label }));
}

export function samePeers(a: readonly PagePeer[], b: readonly PagePeer[]): boolean {
  return a.length === b.length && a.every((peer, index) => peer.url === b[index].url && peer.label === b[index].label);
}

/** The cast_receivers table does not exist yet (PostgREST schema cache or Postgres "undefined table"). */
export function isMissingTableError(error: unknown): boolean {
  if (typeof error !== 'object' || error == null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (code === 'PGRST205' || code === '42P01') return true;
  return typeof message === 'string' && /cast_receivers/.test(message) && /does not exist|schema cache/i.test(message);
}

/** Why the connect screen lists only this phone, or null when the shared list works (or is loading). */
export function sharedListText(status: SharedStatus): string | null {
  switch (status) {
    case 'missing':
      return 'La lista compartida de teléfonos no está disponible todavía (falta la migración 0015 en Supabase). La tele recibe solo de este teléfono.';
    case 'error':
      return 'No se pudo cargar la lista compartida de teléfonos. La tele recibe solo de este teléfono por ahora.';
    default:
      return null;
  }
}

/** The other phone as this phone sees it: its receiver answers (null while checking). */
export function peerStatusText(reachable: boolean | null): string {
  if (reachable == null) return 'Comprobando…';
  return reachable
    ? 'Responde desde este teléfono: está en casa con MayLo abierto'
    : 'No responde: fuera de casa o con MayLo cerrado';
}
