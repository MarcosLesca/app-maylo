const MB = 1024 * 1024;

/** Downloaded fraction (0..1), or null when the server did not say how big the file is. */
export function progressRatio(written: number, expected: number): number | null {
  if (expected <= 0) return null;
  return Math.min(1, Math.max(0, written / expected));
}

/** "50 % · 17 de 34 MB", or "5 MB" when the total size is unknown. */
export function downloadLabel(written: number, expected: number): string {
  const ratio = progressRatio(written, expected);
  const done = Math.floor(written / MB);
  if (ratio === null) return `${done} MB`;
  return `${Math.round(ratio * 100)} % · ${done} de ${Math.round(expected / MB)} MB`;
}
