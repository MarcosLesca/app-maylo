// Regenerates the ad/tracker data bundled with modules/web-guard (S5, S9, S10):
//   assets/web-guard/blocklist.txt  domains blocked by the native request hook
//   assets/web-guard/cosmetic.json  element-hiding selectors (generic and per host)
// Usage (Node 22.18+ / 24, which strips TypeScript types): node scripts/update-adblock-list.mjs
//
// Sources and licenses: modules/web-guard/THIRD_PARTY_NOTICES.md (update the
// versions listed there after regenerating).
// - Permissive hosts lists (MIT, CC BY). StevenBlack's unified "hosts" file is
//   NOT used as a whole because it also merges non-commercial and share-alike
//   lists (MVPS CC BY-NC-SA, Dan Pollock, yoyo.org, KADhosts CC BY-SA).
// - Filter lists: EasyList (CC BY-SA 3.0 / GPL-3.0) and AdGuard Base and Popups
//   (GPL-3.0). Only plain `||domain^` network rules (adblock-rules.ts) and plain
//   CSS element-hiding rules (cosmetic.ts) are taken from them.
// Domains with an every-site `@@||domain^` exception (on them or a parent) in
// any filter list and shared CDNs/platforms (PROTECTED_DOMAINS) are never
// blocked. Exceptions the domain list cannot express by dropping a domain (a
// subdomain of a blocked domain, or `$domain=` sites) are written as allow
// lines (`@@host`, `@@host site,site`) that the native blocker honors.
// Parsing is done by the same functions the app tests.
import { mkdir, writeFile } from 'node:fs/promises';
import https from 'node:https';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  allowRuleLines,
  applyNetworkExceptions,
  createNetworkRules,
  dropProtectedDomains,
  parseNetworkRules,
} from '../src/features/cast/browser/adblock-rules.ts';
import { compactBlocklist, parseBlocklist } from '../src/features/cast/browser/adblock.ts';
import { buildCosmeticIndex, createCosmeticRules, parseCosmeticRules } from '../src/features/cast/browser/cosmetic.ts';

const HOSTS_SOURCES = [
  {
    name: "Steven Black's ad-hoc list",
    url: 'https://raw.githubusercontent.com/StevenBlack/hosts/master/data/StevenBlack/hosts',
    license: 'MIT',
  },
  { name: 'AdAway', url: 'https://raw.githubusercontent.com/AdAway/adaway.github.io/master/hosts.txt', license: 'CC BY 3.0' },
  {
    name: 'FadeMind add.2o7Net',
    url: 'https://raw.githubusercontent.com/FadeMind/hosts.extras/master/add.2o7Net/hosts',
    license: 'MIT',
  },
  {
    name: 'FadeMind UncheckyAds',
    url: 'https://raw.githubusercontent.com/FadeMind/hosts.extras/master/UncheckyAds/hosts',
    license: 'MIT',
  },
  { name: 'Tiuxo hostlist - ads', url: 'https://raw.githubusercontent.com/tiuxo/hosts/master/ads', license: 'CC BY 4.0' },
];

const FILTER_SOURCES = [
  { name: 'EasyList', url: 'https://easylist.to/easylist/easylist.txt', license: 'CC BY-SA 3.0 / GPL-3.0' },
  {
    name: 'AdGuard Base filter',
    url: 'https://filters.adtidy.org/extension/chromium/filters/2.txt',
    license: 'GPL-3.0',
  },
  {
    name: 'AdGuard Popups filter',
    url: 'https://filters.adtidy.org/extension/chromium/filters/19.txt',
    license: 'GPL-3.0',
  },
];

// Too little means a source changed format or failed silently: keep the old files.
const MIN_DOMAINS = 20_000;
const MIN_GENERIC_SELECTORS = 5_000;
const MIN_COSMETIC_HOSTS = 5_000;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const assets = join(root, 'modules/web-guard/android/src/main/assets/web-guard');
const blocklistFile = join(assets, 'blocklist.txt');
const cosmeticFile = join(assets, 'cosmetic.json');

// node:https instead of fetch: Node 24's fetch (undici) sometimes crashes with an
// internal assertion (`!this.paused`) on these multi-megabyte responses.
function download(source, url = source.url, redirects = 5) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { 'user-agent': 'maylo-update-adblock-list' } }, (response) => {
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400 && response.headers.location && redirects > 0) {
        response.resume();
        resolve(download(source, new URL(response.headers.location, url).href, redirects - 1));
        return;
      }
      if (status !== 200) {
        response.resume();
        reject(new Error(`${source.name}: HTTP ${status}`));
        return;
      }
      response.setEncoding('utf8');
      let text = '';
      response.on('data', (chunk) => (text += chunk));
      response.on('end', () => resolve(text));
      response.on('error', reject);
    });
    request.on('error', reject);
    request.setTimeout(60_000, () => request.destroy(new Error(`${source.name}: timed out`)));
  });
}

/** `! Version:` and last-update header lines of a filter list, for the notices. */
function listVersion(text) {
  const head = text.slice(0, 4000);
  const version = /^!\s*Version:\s*(.+)$/m.exec(head)?.[1]?.trim() ?? 'unknown';
  const updated = /^!\s*(?:TimeUpdated|Last modified):\s*(.+)$/m.exec(head)?.[1]?.trim();
  return updated ? `${version} (${updated})` : version;
}

const domains = new Set();
for (const source of HOSTS_SOURCES) {
  const found = parseBlocklist(await download(source));
  console.log(`${source.name}: ${found.size} domains`);
  for (const name of found) domains.add(name);
}

const networkRules = createNetworkRules();
const cosmeticRules = createCosmeticRules();
for (const source of FILTER_SOURCES) {
  const text = await download(source);
  source.version = listVersion(text);
  const network = parseNetworkRules(text);
  parseNetworkRules(text, networkRules);
  for (const name of network.blocked) domains.add(name);
  parseCosmeticRules(text, cosmeticRules);
  console.log(
    `${source.name} ${source.version}: ${network.blocked.size} domain rules, ` +
      `${network.exceptions.size + network.siteExceptions.size} domain exceptions`,
  );
}

const allowed = applyNetworkExceptions(domains, networkRules.exceptions);
const unprotected = dropProtectedDomains(allowed);
const list = compactBlocklist(unprotected);
const allowLines = allowRuleLines(list, networkRules);
console.log(
  `Domains: ${domains.size} merged, ${domains.size - allowed.length} excepted, ` +
    `${allowed.length - unprotected.length} protected, ${list.length} after compaction, ${allowLines.length} allow lines`,
);

const cosmetic = buildCosmeticIndex(cosmeticRules);
const hostCount = Object.keys(cosmetic.hosts).length;
const exceptionHosts = Object.keys(cosmetic.exceptions).length;
const hostSelectors = Object.values(cosmetic.hosts).reduce((sum, selectors) => sum + selectors.length, 0);
console.log(
  `Cosmetic: ${cosmetic.generic.length} generic selectors, ${hostCount} hosts with ${hostSelectors} selectors, ` +
    `${exceptionHosts} hosts with exceptions`,
);

if (list.length < MIN_DOMAINS) throw new Error(`Only ${list.length} domains; nothing was written.`);
if (cosmetic.generic.length < MIN_GENERIC_SELECTORS || hostCount < MIN_COSMETIC_HOSTS) {
  throw new Error(`Only ${cosmetic.generic.length} generic selectors / ${hostCount} hosts; nothing was written.`);
}

const generated = new Date().toISOString().slice(0, 10);
const describe = (source) => `${source.name}${source.version ? ` ${source.version}` : ''} (${source.license}): ${source.url}`;
const header = [
  '# MayLo web-guard ad/tracker domains. Generated by scripts/update-adblock-list.mjs; do not edit.',
  `# Generated: ${generated}. Domains: ${list.length} (subdomains of listed ones removed); allow lines: ${allowLines.length}.`,
  '# A domain blocks its subdomains too. "@@host" lets host (and its subdomains) through everywhere,',
  '# "@@host site,site" only on pages of those sites (filter-list exceptions).',
  '# Sources (licenses in modules/web-guard/THIRD_PARTY_NOTICES.md):',
  ...[...HOSTS_SOURCES, ...FILTER_SOURCES].map((source) => `#   ${describe(source)}`),
];
await mkdir(assets, { recursive: true });
await writeFile(blocklistFile, `${[...header, ...list, ...allowLines].join('\n')}\n`);
console.log(`Wrote ${list.length} domains to ${blocklistFile}`);

const cosmeticJson = {
  comment: 'MayLo web-guard element hiding. Generated by scripts/update-adblock-list.mjs; do not edit.',
  generated,
  sources: FILTER_SOURCES.map(describe),
  ...cosmetic,
};
await writeFile(cosmeticFile, `${JSON.stringify(cosmeticJson)}\n`);
console.log(`Wrote ${cosmetic.generic.length} generic selectors and ${hostCount} hosts to ${cosmeticFile}`);
