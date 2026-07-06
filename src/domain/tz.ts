/** Time-zone-aware handling of the app's naive `datetime-local` strings.
 *
 * Times are entered and displayed as the wall clock local to the place they
 * refer to (as printed on a ticket). A record may also carry an IANA time zone
 * (e.g. `Europe/Paris`); when it does, the wall clock is resolved to a true UTC
 * instant so durations and gaps between different zones come out right. Without
 * a zone we fall back to the old naive behaviour, so existing data is unchanged.
 */

import type { LatLng } from './types';

/** Normalise the loose date forms the app accepts to `YYYY-MM-DDTHH:MM`. */
function normalize(s: string): string {
  let n = s.trim().replace(' ', 'T');
  const dmy = n.match(/^(\d{2})[-/](\d{2})[-/](\d{4})(?:T(\d{2}):(\d{2}))?$/);
  if (dmy) n = `${dmy[3]}-${dmy[2]}-${dmy[1]}T${dmy[4] || '00'}:${dmy[5] || '00'}`;
  n = n.replace(/\//g, '-');
  if (/^\d{4}-\d{2}-\d{2}$/.test(n)) n += 'T00:00';
  return n;
}

/** Parse a `datetime-local` string as browser-local epoch milliseconds. */
export const toMs = (s: string): number => (s ? new Date(normalize(s)).getTime() : NaN);

/** Whether `tz` is an IANA zone this browser recognises. */
export function isValidTz(tz: string | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Milliseconds `tz` is ahead of UTC at the instant `atUtc`. */
function tzOffsetMs(tz: string, atUtc: number): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(new Date(atUtc)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - atUtc;
}

/** The current UTC offset of `tz`, as signed minutes and a `GMT+HH:MM` label. */
export function tzOffset(tz: string): { minutes: number; label: string } {
  const minutes = isValidTz(tz) ? Math.round(tzOffsetMs(tz, Date.now()) / 60000) : 0;
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  const label = `GMT${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  return { minutes, label };
}

/**
 * Epoch milliseconds for the wall clock `s` interpreted in zone `tz`. Falls back
 * to naive parsing when `tz` is missing or unknown. Two offset passes settle the
 * ambiguity around DST transitions.
 */
export function zonedMs(s: string, tz?: string): number {
  if (!s) return NaN;
  if (!isValidTz(tz)) return toMs(s);
  const m = normalize(s).match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!m) return toMs(s);
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
  let utc = wall - tzOffsetMs(tz, wall);
  const off2 = tzOffsetMs(tz, utc);
  utc = wall - off2;
  return utc;
}

/** IANA zone for a coordinate, or `null`. Loads the lookup table lazily (it's
 * only needed to auto-fill the dialog's time-zone field). */
let lookup: ((lat: number, lon: number) => string) | null = null;
export async function tzForLatLng(ll: LatLng | null): Promise<string | null> {
  if (!ll) return null;
  try {
    if (!lookup) lookup = (await import('tz-lookup')).default;
    return lookup(ll[0], ll[1]) || null;
  } catch {
    return null;
  }
}
