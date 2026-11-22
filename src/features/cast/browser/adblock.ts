/**
 * Ad/tracker host matching of the cast browser (S5). Pure and free of the URL
 * global so it runs the same in Node tests. The native side
 * (modules/web-guard, Blocklist.kt) mirrors isBlockedHost and shouldBlockRequest;
 * scripts/update-adblock-list.mjs uses parseBlocklist and compactBlocklist to
 * build the bundled list. Keep the three in step.
 */

// A dotted DNS name of letter/digit/hyphen labels whose last label starts with a letter.
const DOMAIN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
const LOCAL_NAMES = new Set(['localhost', 'localhost.localdomain', 'local', 'broadcasthost', '0.0.0.0']);
const HTTP_HOST = /^(https?|wss?):\/\/(?:[^@/?#]*@)?(\[[^\]]*\]|[^:/?#]*)/i;

/** Lowercase, trimmed, without a trailing dot or IPv6 brackets. */
export function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, '').replace(/^\[(.*)\]$/, '$1');
}

/** True when `host` or one of its parent domains (never a bare TLD) is listed. */
export function isBlockedHost(host: string, blocked: ReadonlySet<string>): boolean {
  let name = normalizeHost(host);
  while (name.includes('.')) {
    if (blocked.has(name)) return true;
    name = name.slice(name.indexOf('.') + 1);
  }
  return false;
}

export type InterceptedRequest = {
  url: string;
  /** The top-level document request: never blocked. */
  isMainFrame: boolean;
  /** Host of the current top page; requests to it are first-party and pass. */
  topHost: string;
};

/** Whether the native hook answers `request` with an empty response. */
export function shouldBlockRequest(request: InterceptedRequest, blocked: ReadonlySet<string>, enabled: boolean): boolean {
  if (!enabled || request.isMainFrame) return false;
  const match = HTTP_HOST.exec(request.url);
  if (!match) return false;
  const host = normalizeHost(match[2]);
  if (!host || host === normalizeHost(request.topHost)) return false;
  return isBlockedHost(host, blocked);
}

/** Domains of a hosts file (`0.0.0.0 name`) or a plain list (`name`); comments, local names and IPs are skipped. */
export function parseBlocklist(text: string): Set<string> {
  const domains = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const fields = line.split(/\s+/);
    const name = normalizeHost(fields.length > 1 ? fields[1] : fields[0]);
    if (LOCAL_NAMES.has(name) || !DOMAIN.test(name)) continue;
    domains.add(name);
  }
  return domains;
}

/** Sorted domains without the ones a listed parent already covers. */
export function compactBlocklist(domains: Iterable<string>): string[] {
  const all = new Set(domains);
  const kept: string[] = [];
  for (const name of all) {
    let parent = name.slice(name.indexOf('.') + 1);
    let covered = false;
    while (parent.includes('.')) {
      if (all.has(parent)) {
        covered = true;
        break;
      }
      parent = parent.slice(parent.indexOf('.') + 1);
    }
    if (!covered) kept.push(name);
  }
  return kept.sort();
}

/** Accessibility label of the shield button. */
export function blockerLabel(count: number, enabled: boolean): string {
  return enabled ? `Anuncios bloqueados: ${count}; tocá para desactivar` : 'Bloqueo de anuncios desactivado; tocá para activar';
}
