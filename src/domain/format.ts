import type { Leg } from './types';
import { currencySymbol } from './transport';
import { zonedMs } from './tz';

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

/** Split a `datetime-local` string into its display date and time parts, e.g.
 * `{ date: 'May 1', time: '12:00' }`. The stored wall clock is shown as entered
 * (local to the place); the browser's own zone only affects rendering style. */
export function fmtTimeParts(s: string): { date: string; time: string } {
  const d = new Date(s);
  return {
    date: d.toLocaleDateString([], { month: 'short', day: 'numeric' }),
    time: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  };
}

/** Format a `datetime-local` string as e.g. `May 1 12:00`. */
export function fmtTime(s: string): string {
  const { date, time } = fmtTimeParts(s);
  return `${date} ${time}`;
}

/** Format a record's cost with its currency symbol (whole units). */
export function money(r: { cost: number; currency: string }): string {
  return currencySymbol(r.currency) + Number(r.cost).toFixed(0);
}

/** Travel duration of a segment (departure → arrival), across time zones. */
export function tripDur(r: Leg): string {
  return fmtDur(zonedMs(r.arr.time, r.arr.tz) - zonedMs(r.dep.time, r.dep.tz));
}

/** Escape a value for safe interpolation into an HTML attribute / text node. */
export const esc = (s: unknown): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
