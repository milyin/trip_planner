import type { Segment } from './types';
import { currencySymbol } from './transport';

/** Parse a `datetime-local` string to epoch milliseconds. */
export const toMs = (s: string): number => new Date(s).getTime();

/** Format a duration (ms) as a compact `1d 2h 30m` string; negatives keep a `-`. */
export function fmtDur(ms: number): string {
  let m = Math.round(ms / 60000);
  const neg = m < 0;
  m = Math.abs(m);
  const d = Math.floor(m / 1440);
  m -= d * 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const out: string[] = [];
  if (d) out.push(d + 'd');
  if (h) out.push(h + 'h');
  if (mm || !out.length) out.push(mm + 'm');
  return (neg ? '-' : '') + out.join(' ');
}

/** Format a `datetime-local` string as e.g. `May 1 12:00`. */
export function fmtTime(s: string): string {
  const d = new Date(s);
  return (
    d.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  );
}

/** Format a record's cost with its currency symbol (whole units). */
export function money(r: { cost: number; currency: string }): string {
  return currencySymbol(r.currency) + Number(r.cost).toFixed(0);
}

/** Travel duration of a segment (departure → arrival). */
export function tripDur(r: Segment): string {
  return fmtDur(toMs(r.arr.time) - toMs(r.dep.time));
}

/** Escape a value for safe interpolation into an HTML attribute / text node. */
export const esc = (s: unknown): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
