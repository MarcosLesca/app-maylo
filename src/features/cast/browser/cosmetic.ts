/**
 * Cosmetic filtering of the cast browser (S10): element-hiding rules of the big
 * filter lists, reduced to plain CSS selectors.
 *
 * scripts/update-adblock-list.mjs parses the lists with parseCosmeticRules and
 * writes buildCosmeticIndex's result to modules/web-guard assets
 * (web-guard/cosmetic.json). On the phone the native WebGuard (Cosmetic.kt)
 * answers the reserved stylesheet URL requested by the injected loader
 * (cosmetic-script.ts) with cosmeticCssForHost for the frame's host. Cosmetic.kt
 * mirrors cosmeticSelectors, cosmeticCss and cosmeticCssForHost; keep them in step.
 */
// Self-contained (see adblock-rules.ts): same DOMAIN and normalizeHost as adblock.ts.
const DOMAIN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

function isDomainName(name: string): boolean {
  return DOMAIN.test(name);
}

/** Lowercase, trimmed, without a trailing dot or IPv6 brackets (adblock.ts normalizeHost). */
function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, '').replace(/^\[(.*)\]$/, '$1');
}

/** Selectors per CSS rule block, so one selector the WebView rejects only drops its own block. */
export const COSMETIC_CHUNK_SIZE = 1000;
const MAX_SELECTOR_LENGTH = 1024;
const HIDE = '{display:none!important}';

export type CosmeticRules = {
  generic: Set<string>;
  genericExceptions: Set<string>;
  /** host → selectors of `host##selector` rules. */
  hosts: Map<string, Set<string>>;
  /** host → selectors of `host#@#selector` exceptions and `~host` negations. */
  exceptions: Map<string, Set<string>>;
  /** Sites of `@@||site^$generichide`: no generic selectors there. */
  genericHide: Set<string>;
  /** Sites of `@@||site^$elemhide` / `$document`: no element hiding at all there. */
  elemHide: Set<string>;
};

/** The bundled asset: sorted generic selectors and per-host rules and exceptions. */
export type CosmeticIndex = {
  generic: string[];
  hosts: Record<string, string[]>;
  exceptions: Record<string, string[]>;
  genericHide: string[];
  elemHide: string[];
};

// Plain CSS pseudo-classes/elements the WebView understands. Anything else (:has-text,
// :-abp-has, :matches-css, :xpath, :contains, :upward, :remove, :style, ...) is an
// extended rule of a filter engine and invalid as CSS.
const PSEUDOS = new Set([
  'active',
  'after',
  'any-link',
  'before',
  'checked',
  'disabled',
  'empty',
  'enabled',
  'first-child',
  'first-letter',
  'first-line',
  'first-of-type',
  'focus',
  'focus-visible',
  'focus-within',
  'has',
  'hover',
  'is',
  'lang',
  'last-child',
  'last-of-type',
  'link',
  'not',
  'nth-child',
  'nth-last-child',
  'nth-last-of-type',
  'nth-of-type',
  'only-child',
  'only-of-type',
  'optional',
  'placeholder',
  'placeholder-shown',
  'read-only',
  'read-write',
  'required',
  'root',
  'target',
  'visited',
  'where',
]);
// Outside attribute brackets: names, escapes, combinators, lists and pseudo-class arguments.
const PLAIN_CHAR = /[A-Za-z0-9_\-#.\s>+~*,:()\u0080-\uFFFF]/;
const COMBINATOR = /^[>+~]|[>+~]$/;

/** A conservative check that `selector` is a plain CSS selector list the WebView accepts. */
export function isSafeSelector(selector: string): boolean {
  const text = selector.trim();
  if (!text || text.length > MAX_SELECTOR_LENGTH) return false;
  let parens = 0;
  let inBracket = false;
  let quote = '';
  let part = '';
  const parts: string[] = [];
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '{' || char === '}' || char === '\n' || char === '\r') return false;
    if (char === '\\') {
      if (i + 1 >= text.length) return false;
      part += char + text[++i];
      continue;
    }
    if (quote) {
      if (char === quote) quote = '';
    } else if (inBracket) {
      if (char === '"' || char === "'") quote = char;
      else if (char === ']') inBracket = false;
      else if (char === '[') return false;
    } else if (char === '[') {
      inBracket = true;
    } else if (!PLAIN_CHAR.test(char)) {
      return false;
    } else if (char === '(') {
      parens++;
    } else if (char === ')') {
      if (--parens < 0) return false;
    } else if (char === ':') {
      let colons = ':';
      if (text[i + 1] === ':') {
        colons = '::';
        i++;
      }
      const name = /^[A-Za-z-]*/.exec(text.slice(i + 1))![0];
      if (!PSEUDOS.has(name.toLowerCase())) return false;
      part += colons + name;
      i += name.length;
      continue;
    } else if (char === ',' && parens === 0) {
      parts.push(part);
      part = '';
      continue;
    }
    part += char;
  }
  if (quote || inBracket || parens !== 0) return false;
  parts.push(part);
  return parts.every((item) => {
    const trimmed = item.trim();
    return trimmed !== '' && !COMBINATOR.test(trimmed);
  });
}

export function createCosmeticRules(): CosmeticRules {
  return {
    generic: new Set(),
    genericExceptions: new Set(),
    hosts: new Map(),
    exceptions: new Map(),
    genericHide: new Set(),
    elemHide: new Set(),
  };
}

const SITE_EXCEPTION = /^@@\|\|([^/^$*|]+)\^\$(.+)$/;

/** `@@||site^$generichide` / `$elemhide` / `$document` without `$domain=`: whole-site cosmetic exceptions. */
function parseSiteException(line: string, rules: CosmeticRules) {
  const match = SITE_EXCEPTION.exec(line.toLowerCase());
  if (!match || !isDomainName(match[1])) return;
  const options = match[2].split(',');
  if (options.some((option) => option.startsWith('domain='))) return;
  if (options.some((option) => option === 'elemhide' || option === 'ehide' || option === 'document')) {
    rules.elemHide.add(match[1]);
  } else if (options.some((option) => option === 'generichide' || option === 'ghide')) {
    rules.genericHide.add(match[1]);
  }
}

function addTo(map: Map<string, Set<string>>, host: string, selector: string) {
  let set = map.get(host);
  if (!set) map.set(host, (set = new Set()));
  set.add(selector);
}

const DOMAIN_LIST = /^[a-z0-9.,~*_-]*$/;

/**
 * Adds the element-hiding rules of an Adblock Plus / AdGuard / uBlock list to
 * `rules`: `##sel`, `domains##sel` and `#@#` exceptions with plain selectors.
 * Scriptlets (`##+js`), HTML filters (`##^`), procedural/extended/CSS/JS rules
 * (`#?#`, `#$#`, `#%#` and their exceptions), entity domains (`google.*`) and
 * selectors failing isSafeSelector are skipped. `~host` in a domain list becomes
 * an exception for that host.
 */
export function parseCosmeticRules(text: string, rules: CosmeticRules = createCosmeticRules()): CosmeticRules {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('!') || line.startsWith('[')) continue;
    if (line.startsWith('@@')) {
      parseSiteException(line, rules);
      continue;
    }
    const at = line.indexOf('#');
    if (at < 0) continue;
    const domainList = line.slice(0, at).toLowerCase();
    if (!DOMAIN_LIST.test(domainList)) continue;
    const rest = line.slice(at);
    let exception: boolean;
    let selector: string;
    if (rest.startsWith('##')) {
      exception = false;
      selector = rest.slice(2);
    } else if (rest.startsWith('#@#')) {
      exception = true;
      selector = rest.slice(3);
    } else {
      continue;
    }
    if (selector.startsWith('+js(') || selector.startsWith('^')) continue;
    selector = selector.trim();
    if (!isSafeSelector(selector)) continue;

    const included: string[] = [];
    const excluded: string[] = [];
    let skipped = false;
    for (const entry of domainList ? domainList.split(',') : []) {
      const negated = entry.startsWith('~');
      const name = normalizeHost(negated ? entry.slice(1) : entry);
      if (!isDomainName(name)) {
        skipped = true;
        continue;
      }
      (negated ? excluded : included).push(name);
    }
    // Every domain was an entity (google.*) or invalid: the rule is not generic either.
    if (skipped && included.length === 0 && excluded.length === 0) continue;

    if (exception) {
      if (included.length === 0 && excluded.length === 0) rules.genericExceptions.add(selector);
      for (const host of included) addTo(rules.exceptions, host, selector);
      continue;
    }
    if (included.length === 0) {
      rules.generic.add(selector);
    } else {
      for (const host of included) addTo(rules.hosts, host, selector);
    }
    for (const host of excluded) addTo(rules.exceptions, host, selector);
  }
  return rules;
}

/**
 * The asset form of `rules`: generic exceptions removed everywhere, site
 * selectors that are already generic or excepted on the same host dropped, and
 * only exceptions that can remove a listed selector kept.
 */
export function buildCosmeticIndex(rules: CosmeticRules): CosmeticIndex {
  const generic = new Set([...rules.generic].filter((selector) => !rules.genericExceptions.has(selector)));
  const hosts: Record<string, string[]> = {};
  const listed = new Set(generic);
  for (const host of [...rules.hosts.keys()].sort()) {
    const own = rules.exceptions.get(host);
    const selectors = [...rules.hosts.get(host)!]
      .filter((selector) => !generic.has(selector) && !rules.genericExceptions.has(selector) && !own?.has(selector))
      .sort();
    if (selectors.length === 0) continue;
    hosts[host] = selectors;
    for (const selector of selectors) listed.add(selector);
  }
  const exceptions: Record<string, string[]> = {};
  for (const host of [...rules.exceptions.keys()].sort()) {
    const selectors = [...rules.exceptions.get(host)!].filter((selector) => listed.has(selector)).sort();
    if (selectors.length > 0) exceptions[host] = selectors;
  }
  return {
    generic: [...generic].sort(),
    hosts,
    exceptions,
    genericHide: [...rules.genericHide].sort(),
    elemHide: [...rules.elemHide].sort(),
  };
}

/**
 * Selectors that apply to `host`: rules and exceptions of the host and of each
 * parent domain (never a bare TLD). Generic ones keep the index order; site ones
 * go host first, without repeats. A site with `$elemhide` gets none, one with
 * `$generichide` no generic ones.
 */
export function cosmeticSelectors(index: CosmeticIndex, host: string): { generic: string[]; specific: string[] } {
  const levels: string[] = [];
  let name = normalizeHost(host);
  while (name.includes('.')) {
    levels.push(name);
    name = name.slice(name.indexOf('.') + 1);
  }
  if (levels.some((level) => index.elemHide.includes(level))) return { generic: [], specific: [] };
  const noGeneric = levels.some((level) => index.genericHide.includes(level));
  const excluded = new Set<string>();
  for (const level of levels) for (const selector of own(index.exceptions, level)) excluded.add(selector);
  const specific = new Set<string>();
  for (const level of levels) {
    for (const selector of own(index.hosts, level)) if (!excluded.has(selector)) specific.add(selector);
  }
  const generic = noGeneric
    ? []
    : excluded.size === 0
      ? index.generic
      : index.generic.filter((selector) => !excluded.has(selector));
  return { generic, specific: [...specific] };
}

function own(map: Record<string, string[]>, key: string): string[] {
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : [];
}

/**
 * `sel,sel{display:none!important}` blocks of at most `chunkSize` selectors, one
 * per line. Selectors using :has() go in their own blocks, so an older WebView
 * that rejects :has() still applies the rest.
 */
export function cosmeticCss(selectors: readonly string[], chunkSize = COSMETIC_CHUNK_SIZE): string {
  const plain: string[] = [];
  const has: string[] = [];
  for (const selector of selectors) (selector.includes(':has(') ? has : plain).push(selector);
  let css = '';
  for (const group of [plain, has]) {
    for (let start = 0; start < group.length; start += chunkSize) {
      css += `${group.slice(start, start + chunkSize).join(',')}${HIDE}\n`;
    }
  }
  return css;
}

/** The stylesheet the reserved URL answers for a frame on `host`; empty while blocking is off. */
export function cosmeticCssForHost(index: CosmeticIndex, host: string, enabled: boolean): string {
  if (!enabled) return '';
  const { generic, specific } = cosmeticSelectors(index, host);
  return cosmeticCss(generic) + cosmeticCss(specific);
}
