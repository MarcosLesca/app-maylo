// Bulk notebook: what to eat on training and rest days, written down by hand.

export type DayType = 'training' | 'rest';

const MAX_AMOUNT = 99_999;

/**
 * Reads a typed amount (grams, kcal, protein...). Accepts "12,5" or "12.5".
 * Returns null for an empty field (clears the value) and undefined when the text is invalid.
 */
export function parseAmount(text: string): number | null | undefined {
  const value = text.trim().replace(',', '.');
  if (value === '') return null;
  if (!/^\d+(\.\d+)?$/.test(value)) return undefined;
  const amount = Number(value);
  return amount <= MAX_AMOUNT ? amount : undefined;
}

/** Inverse of parseAmount, for prefilling an editable field. */
export function formatAmount(amount: number | null): string {
  if (amount == null) return '';
  return String(amount).replace('.', ',');
}
