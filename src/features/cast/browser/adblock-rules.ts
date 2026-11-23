/**
 * Network rules of the big filter lists (EasyList, AdGuard Base, AdGuard Popups)
 * reduced to what the native domain blocker can apply (S9). Only plain
 * `||domain^` rules are kept, optionally with `$third-party`/`$3p`/`$popup`/`$all`;
 * everything else (paths, wildcards, resource types, `$domain=`) needs a full
 * filter engine and is skipped. scripts/update-adblock-list.mjs merges the
 * result with the permissive hosts lists into assets/web-guard/blocklist.txt.
 */
// Self-contained like the other tested modules: Node runs this file directly
// (scripts, node:test) and needs explicit .ts imports, which tsc rejects here.
// Same as adblock.ts DOMAIN; adblock-rules.test.ts checks they agree.
const DOMAIN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

/** A lowercase dotted DNS name (no IP address, no wildcard, no bare TLD), as in adblock.ts. */
export function isDomainName(name: string): boolean {
  return DOMAIN.test(name);
}

const NETWORK_RULE = /^\|\|([^/^$*|]+)\^(?:\$(.*))?$/;
const EXCEPTION_RULE = /^@@\|\|([^/^$*|]+)\^(?:\$(.*))?$/;
const ALLOWED_OPTIONS = new Set(['third-party', '3p', 'popup', 'all']);
// Exceptions with one of these options change cosmetic filtering, CSP, cookies or
// stealth mode, or disable another rule; they do not let requests through.
const NON_NETWORK_OPTIONS = new Set([
  'badfilter',
  'content',
  'cookie',
  'csp',
  'ehide',
  'elemhide',
  'extension',
  'generichide',
  'genericblock',
  'ghide',
  'jsinject',
  'permissions',
  'removeheader',
  'removeparam',
  'shide',
  'specifichide',
  'stealth',
  'urlblock',
]);

export type NetworkRules = {
  /** Domains blocked (with their subdomains) by a plain `||domain^` rule. */
  blocked: Set<string>;
  /** Domains of `@@||domain^` exceptions that apply on every site. */
  exceptions: Set<string>;
  /** Domain → sites of `@@||domain^$domain=site|site` exceptions (only on those sites' pages). */
  siteExceptions: Map<string, Set<string>>;
};

export function createNetworkRules(): NetworkRules {
  return { blocked: new Set(), exceptions: new Set(), siteExceptions: new Map() };
}

/** The positive, valid sites of a `domain=a.com|~b.com` option; empty when there is none. */
function exceptionSites(options: string[]): string[] {
  const sites: string[] = [];
  for (const option of options) {
    if (!option.startsWith('domain=')) continue;
    for (const entry of option.slice('domain='.length).split('|')) {
      if (!entry.startsWith('~') && isDomainName(entry)) sites.push(entry);
    }
  }
  return sites;
}

/**
 * Adds the plain domain rules and the domain exceptions of an Adblock Plus /
 * AdGuard filter list to `rules`. An exception restricted with `$domain=` is kept
 * per site; with only negated or non-domain sites it counts everywhere.
 */
export function parseNetworkRules(text: string, rules: NetworkRules = createNetworkRules()): NetworkRules {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().toLowerCase();
    if (!line || line.startsWith('!') || line.startsWith('[')) continue;
    const exception = EXCEPTION_RULE.exec(line);
    if (exception) {
      const options = exception[2] ? exception[2].split(',') : [];
      if (!isDomainName(exception[1]) || options.some((option) => NON_NETWORK_OPTIONS.has(option))) continue;
      const sites = exceptionSites(options);
      if (sites.length === 0) {
        rules.exceptions.add(exception[1]);
        continue;
      }
      let set = rules.siteExceptions.get(exception[1]);
      if (!set) rules.siteExceptions.set(exception[1], (set = new Set()));
      for (const site of sites) set.add(site);
      continue;
    }
    const rule = NETWORK_RULE.exec(line);
    if (!rule || !isDomainName(rule[1])) continue;
    if (rule[2] !== undefined && !rule[2].split(',').every((option) => ALLOWED_OPTIONS.has(option))) continue;
    rules.blocked.add(rule[1]);
  }
  return rules;
}

/** `name` and its parent domains, longest first, without the bare TLD. */
function domainLevels(name: string): string[] {
  const levels: string[] = [];
  let current = name;
  while (current.includes('.')) {
    levels.push(current);
    current = current.slice(current.indexOf('.') + 1);
  }
  return levels;
}

/** Sorted `domains` without the ones an every-site exception names directly or through a parent domain. */
export function applyNetworkExceptions(domains: Iterable<string>, exceptions: ReadonlySet<string>): string[] {
  const kept: string[] = [];
  for (const name of new Set(domains)) {
    if (!domainLevels(name).some((level) => exceptions.has(level))) kept.push(name);
  }
  return kept.sort();
}

/**
 * The allow lines (`@@host`, `@@host site,site`) the final domain list needs,
 * sorted: every-site exceptions for a subdomain of a blocked domain (the
 * blocked parent stays blocked), and per-site exceptions related to a blocked
 * domain (same, parent or subdomain). The native blocker lets a request
 * through when one of them matches its host (see adblock.ts isAllowedHost).
 */
export function allowRuleLines(blocked: Iterable<string>, rules: NetworkRules): string[] {
  const listed = new Set(blocked);
  const covering = new Set<string>();
  for (const name of listed) for (const level of domainLevels(name)) covering.add(level);
  const underBlocked = (host: string) => domainLevels(host).some((level) => listed.has(level));
  const lines: string[] = [];
  for (const host of rules.exceptions) {
    if (underBlocked(host)) lines.push(`@@${host}`);
  }
  for (const [host, sites] of rules.siteExceptions) {
    if (underBlocked(host) || covering.has(host)) lines.push(`@@${host} ${[...sites].sort().join(',')}`);
  }
  return lines.sort();
}

/**
 * Shared CDNs, hosting and big platforms: blocking one of them (or a parent of
 * one) would break unrelated sites and video players. A specific subdomain under
 * them (e.g. one CloudFront distribution) can still be blocked.
 */
export const PROTECTED_DOMAINS: readonly string[] = [
  // CDNs and object storage
  'akamai.net',
  'akamaiedge.net',
  'akamaihd.net',
  'akamaized.net',
  'amazonaws.com',
  'azureedge.net',
  'azurefd.net',
  'b-cdn.net',
  'bunnycdn.com',
  'cdn77.org',
  'cloudflare.com',
  'cloudflare.net',
  'cloudfront.net',
  'digitaloceanspaces.com',
  'edgecastcdn.net',
  'edgekey.net',
  'edgesuite.net',
  'fastly.net',
  'fastlylb.net',
  'jsdelivr.net',
  'kxcdn.com',
  'llnwd.net',
  'r2.dev',
  'stackpathcdn.com',
  'unpkg.com',
  'windows.net',
  // App hosting
  'appspot.com',
  'firebaseapp.com',
  'github.io',
  'githubusercontent.com',
  'herokuapp.com',
  'netlify.app',
  'pages.dev',
  'vercel.app',
  'web.app',
  'workers.dev',
  // Platforms and their static/media hosts
  'apple.com',
  'blogger.com',
  'blogspot.com',
  'facebook.com',
  'fbcdn.net',
  'github.com',
  'google.com',
  'googleapis.com',
  'googleusercontent.com',
  'googlevideo.com',
  'gstatic.com',
  'instagram.com',
  'cdninstagram.com',
  'jwpcdn.com',
  'microsoft.com',
  'twimg.com',
  'twitter.com',
  'vimeo.com',
  'vimeocdn.com',
  'wordpress.com',
  'wp.com',
  'x.com',
  'youtube.com',
  'ytimg.com',
];

const PROTECTED = new Set(PROTECTED_DOMAINS.flatMap((name) => [name, ...parentNames(name)]));

function parentNames(name: string): string[] {
  const parents: string[] = [];
  let current = name;
  while (current.includes('.')) {
    current = current.slice(current.indexOf('.') + 1);
    parents.push(current);
  }
  return parents;
}

/** True for a protected CDN/platform domain or a parent of one (including its TLD). */
export function isProtectedDomain(name: string): boolean {
  return PROTECTED.has(name);
}

/** Sorted `domains` without protected CDNs/platforms (see PROTECTED_DOMAINS). */
export function dropProtectedDomains(domains: Iterable<string>): string[] {
  return [...new Set(domains)].filter((name) => !isProtectedDomain(name)).sort();
}
