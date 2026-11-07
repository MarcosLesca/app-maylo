// Body recomposition plan: weekly portions for training and rest days.
// Every day also includes the fixed base below. Potato is weighed right after
// boiling, before freezing.

export type DayType = 'training' | 'rest';
export type AfterWeek4 = 'maintain' | 'continue';

export type Doses = {
  potatoG: number;
  peanutsG: number;
  oilTsp: number;
  breadG: number;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
};

export const FIXED_FOODS = ['300 g de pechuga cocida', 'Lechuga, tomate y sal yodada'];
export const TRAINING_DAYS_PER_WEEK = 5;

const row = (potatoG: number, peanutsG: number, oilTsp: number, kcal: number, protein: number, carbs: number, fat: number): Doses => ({
  potatoG,
  peanutsG,
  oilTsp,
  breadG: 60,
  kcal,
  protein,
  carbs,
  fat,
});

// Index 0 = week 1 ... index 4 = week 5+.
const PLAN: Record<DayType, Doses[]> = {
  training: [
    row(635, 60, 2, 1620, 125, 169, 51),
    row(635, 80, 2, 1735, 130, 172, 61),
    row(750, 80, 3, 1875, 132, 195, 65),
    row(870, 80, 3, 1975, 134, 219, 66),
    row(1000, 80, 3, 2090, 136, 245, 66),
  ],
  rest: [
    row(410, 60, 2, 1430, 121, 124, 51),
    row(410, 80, 2, 1540, 126, 127, 61),
    row(410, 80, 3, 1580, 126, 127, 65),
    row(500, 80, 3, 1660, 128, 145, 65),
    row(600, 80, 3, 1745, 129, 165, 65),
  ],
};

const toUtcDay = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
};

/** Plan week for a day: 0 before the start, then 1..4, and 5 meaning "5+". */
export function planWeek(startDate: string, today: string): number {
  const days = toUtcDay(today) - toUtcDay(startDate);
  if (days < 0) return 0;
  return Math.min(5, Math.floor(days / 7) + 1);
}

/** First day of the plan week that contains `today` (the start date itself before the plan begins). */
export function weekStartOf(startDate: string, today: string): string {
  const start = toUtcDay(startDate);
  const days = Math.max(0, toUtcDay(today) - start);
  const weekStart = new Date((start + Math.floor(days / 7) * 7) * 86_400_000);
  return weekStart.toISOString().slice(0, 10);
}

/** Week whose portions apply: choosing "maintain" at week 4 keeps week 4 values afterwards. */
export function effectiveWeek(week: number, afterWeek4: AfterWeek4 | null): number {
  if (week >= 5 && afterWeek4 === 'maintain') return 4;
  return Math.min(5, week);
}

export function dosesFor(week: number, dayType: DayType): Doses {
  const index = Math.min(4, Math.max(0, week - 1));
  return PLAN[dayType][index];
}

export type WeightPoint = { day: string; kg: number };

/** Lays out weights (oldest first) as an SVG polyline inside width × height with padding. */
export function weightChart(points: WeightPoint[], width: number, height: number, padding: number) {
  const kgs = points.map((p) => p.kg);
  const min = Math.min(...kgs);
  const max = Math.max(...kgs);
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;

  const laid = points.map((p, i) => ({
    ...p,
    x: points.length === 1 ? width / 2 : padding + (innerW * i) / (points.length - 1),
    y: max === min ? height / 2 : padding + (innerH * (max - p.kg)) / (max - min),
  }));

  const path = laid.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ');
  return {
    points: laid.map(({ x, y, day, kg }) => ({ x, y, day, kg })),
    path,
    min,
    max,
  };
}
