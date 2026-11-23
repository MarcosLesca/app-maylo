/**
 * Ad/tracker host matching of the cast browser (S5). Pure and free of the URL
 * global so it runs the same in Node tests. The native side
 * (modules/web-guard, Blocklist.kt) mirrors isBlockedHost, parseAllowRules,
 * isAllowedHost and shouldBlockRequest; scripts/update-adblock-list.mjs uses
 * parseBlocklist and compactBlocklist to build the bundled list (allow lines
 * come from adblock-rules.ts). Keep them in step.
 */

// A dotted DNS name of letter/digit/hyphen labels whose last label starts with a letter.
const DOMAIN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
const LOCAL_NAMES = new Set(['localhost', 'localhost.localdomain', 'local', 'broadcasthost', '0.0.0.0']);
const HTTP_HOST = /^(https?|wss?):\/\/(?:[^@/?#]*@)?(\[[^\]]*\]|[^:/?#]*)/i;

/** Lowercase, trimmed, without a trailing dot or IPv6 brackets. */
export function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, '').replace(/^\[(.*)\]$/, '$1');
}

/** A lowercase dotted DNS name (no IP address, no wildcard, no bare TLD). */
export function isDomainName(name: string): boolean {
  return DOMAIN.test(name);
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
export function shouldBlockRequest(
  request: InterceptedRequest,
  blocked: ReadonlySet<string>,
  enabled: boolean,
  allow: AllowRules = NO_ALLOW_RULES,
): boolean {
  if (!enabled || request.isMainFrame) return false;
  const match = HTTP_HOST.exec(request.url);
  if (!match) return false;
  const host = normalizeHost(match[2]);
  if (!host || host === normalizeHost(request.topHost)) return false;
  return isBlockedHost(host, blocked) && !isAllowedHost(host, request.topHost, allow);
}

/**
 * Filter-list exceptions the domain list still needs (`@@host` and
 * `@@host site,site` lines of the bundled list): a host allowed everywhere
 * although a parent domain is blocked, and hosts allowed only on pages of some sites.
 */
export type AllowRules = {
  hosts: ReadonlySet<string>;
  sites: ReadonlyMap<string, ReadonlySet<string>>;
};

const NO_ALLOW_RULES: AllowRules = { hosts: new Set(), sites: new Map() };

/** The `@@host` and `@@host site,site` lines of a bundled list; other lines are skipped. */
export function parseAllowRules(text: string): AllowRules {
  const hosts = new Set<string>();
  const sites = new Map<string, Set<string>>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith('@@')) continue;
    const fields = line.slice(2).split(/\s+/);
    const host = normalizeHost(fields[0]);
    if (!DOMAIN.test(host) || fields.length > 2) continue;
    if (fields.length === 1) {
      hosts.add(host);
      continue;
    }
    const names = fields[1].split(',').map(normalizeHost).filter((name) => DOMAIN.test(name));
    if (names.length === 0) continue;
    let set = sites.get(host);
    if (!set) sites.set(host, (set = new Set()));
    for (const name of names) set.add(name);
  }
  return { hosts, sites };
}

/** True when an allow rule of `host` or a parent domain applies on a page of `topHost`. */
export function isAllowedHost(host: string, topHost: string, allow: AllowRules): boolean {
  if (allow.hosts.size === 0 && allow.sites.size === 0) return false;
  let name = normalizeHost(host);
  while (name.includes('.')) {
    if (allow.hosts.has(name)) return true;
    const sites = allow.sites.get(name);
    if (sites && isBlockedHost(topHost, sites)) return true;
    name = name.slice(name.indexOf('.') + 1);
  }
  return false;
}

/** Domains of a hosts file (`0.0.0.0 name`) or a plain list (`name`); comments, local names and IPs are skipped. */
export function parseBlocklist(text: string): Set<string> {
  const domains = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line || line.startsWith('@@')) continue;
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
