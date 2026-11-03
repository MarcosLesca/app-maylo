/** Parses "v1.2.3" or "1.2" into numeric parts. Returns null for anything else. */
export function parseVersion(value: string): number[] | null {
  const match = value.trim().replace(/^v/i, '').match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

/** True when `candidate` is strictly newer than `installed`. Unparseable input is never newer. */
export function isNewerVersion(candidate: string, installed: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(installed);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}
