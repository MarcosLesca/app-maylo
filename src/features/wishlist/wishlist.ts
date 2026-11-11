// Foods we want to try: tick them off once eaten, and optionally plan a month for each.

export type WishItem = {
  id: string;
  name: string;
  eaten: boolean;
  /** First day of the planned month ("2026-12-01"), or null when not planned yet. */
  planned_month: string | null;
};

export type WishSection = { month: string | null; items: WishItem[] };

/** Pending items grouped by planned month (earliest first, unplanned last), plus the eaten ones. */
export function groupWishlist(items: WishItem[]): { pending: WishSection[]; eaten: WishItem[] } {
  const byMonth = new Map<string | null, WishItem[]>();
  const eaten: WishItem[] = [];
  for (const item of items) {
    if (item.eaten) {
      eaten.push(item);
      continue;
    }
    const list = byMonth.get(item.planned_month) ?? [];
    list.push(item);
    byMonth.set(item.planned_month, list);
  }
  const pending = [...byMonth.entries()]
    .map(([month, list]) => ({ month, items: list }))
    .sort((a, b) => {
      if (a.month === b.month) return 0;
      if (a.month === null) return 1;
      if (b.month === null) return -1;
      return a.month < b.month ? -1 : 1;
    });
  return { pending, eaten };
}
