// A "period" is the first day of a month as an ISO date string: "2026-11-01".

const MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const pad = (n: number) => String(n).padStart(2, '0');

export function currentPeriod(date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-01`;
}

export function shiftPeriod(period: string, months: number): string {
  const [year, month] = period.split('-').map(Number);
  const index = year * 12 + (month - 1) + months;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}-01`;
}

export function formatPeriod(period: string): string {
  const [year, month] = period.split('-').map(Number);
  return `${MONTHS[month - 1]} ${year}`;
}

export function formatMoney(value: number | null | undefined): string {
  if (value == null) return '—';
  return `$ ${Number(value).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}
