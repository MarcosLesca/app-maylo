// Month calendar helpers. Dates are ISO strings ("2027-02-14"), weeks start on Monday.

const pad = (n: number) => String(n).padStart(2, '0');

export function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Builds the visible grid for a month: rows of 7 cells (Monday to Sunday),
 * each an ISO date or null for padding before the 1st and after the last day.
 * @param period first day of the month, e.g. "2026-11-01"
 */
export function monthGrid(period: string): (string | null)[][] {
  const [year, month] = period.split('-').map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  // getDay(): 0 = Sunday. Shift so Monday = 0.
  const leading = (new Date(year, month - 1, 1).getDay() + 6) % 7;

  const cells: (string | null)[] = Array(leading).fill(null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(`${year}-${pad(month)}-${pad(day)}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}
