import type { Leg, Segment } from './types';
import { haversine } from './geo';
import {
  endCity, endLL, endTimeStr, nights, overlaps, startCity, startLL, startMs, endMs, startTimeStr,
} from './item';
import { bufferMin, LONG_GAP_MIN, REMOTE_KM } from './transport';

/** Compare two segments chronologically, handling equal start times by trace connection. */
export function compareSegments(a: Segment, b: Segment): number {
  const aStart = startMs(a);
  const bStart = startMs(b);
  const diff = aStart - bStart;
  if (!isNaN(diff) && diff !== 0) return diff;

  // Handle NaNs (push invalid/missing dates to the end)
  if (isNaN(aStart) && !isNaN(bStart)) return 1;
  if (!isNaN(aStart) && isNaN(bStart)) return -1;
  if (isNaN(aStart) && isNaN(bStart)) return 0;

  // If start times are equal, check if they connect:
  // e.g. a arrives in the city b departs from, so a should be before b
  const aEndCity = (endCity(a) || '').trim().toLowerCase();
  const bStartCity = (startCity(b) || '').trim().toLowerCase();
  const bEndCity = (endCity(b) || '').trim().toLowerCase();
  const aStartCity = (startCity(a) || '').trim().toLowerCase();

  const aBeforeB = aEndCity && bStartCity && aEndCity === bStartCity;
  const bBeforeA = bEndCity && aStartCity && bEndCity === aStartCity;

  if (aBeforeB && !bBeforeA) return -1;
  if (bBeforeA && !aBeforeB) return 1;

  // If they don't form a direct connection, sort by end time
  const aEnd = endMs(a);
  const bEnd = endMs(b);
  const endDiff = aEnd - bEnd;
  if (!isNaN(endDiff) && endDiff !== 0) return endDiff;

  // Handle endMs NaNs
  if (isNaN(aEnd) && !isNaN(bEnd)) return 1;
  if (!isNaN(aEnd) && isNaN(bEnd)) return -1;

  return 0;
}

/** Plan items (those flagged `inPlan`) ordered chronologically. */
export const planItems = (items: Segment[]): Segment[] =>
  items.filter((r) => r.inPlan).sort(compareSegments);

/** Not-yet-planned items ordered chronologically (the Segments panel). */
export const listItems = (items: Segment[]): Segment[] =>
  items.filter((r) => !r.inPlan).sort(compareSegments);

/** The plan segment a not-yet-planned segment time-overlaps (or `null`). */
export function conflictOf(items: Segment[], r: Segment): Leg | null {
  if (r.kind !== 'leg' || r.inPlan) return null;
  const hit = planItems(items).find((p) => p.kind === 'leg' && overlaps(r, p));
  return (hit as Leg) ?? null;
}

export type GapKind = 'ok' | 'long' | 'bad';
export interface GapInfo {
  kind: GapKind;
  /** Minutes of slack between the two items (may be negative). */
  availMin: number;
  /** Minutes of connection buffer the next leg requires (0 before a hotel). */
  need: number;
}

/** Classify the gap between two consecutive plan items. */
export function classifyGap(prev: Segment, next: Segment): GapInfo {
  const availMin = (startMs(next) - endMs(prev)) / 60000;
  const need = next.kind === 'leg' ? bufferMin(next.transport) : 0;
  if (availMin < need) return { kind: 'bad', availMin, need };
  const hotelSide = prev.kind === 'hotel' || next.kind === 'hotel';
  if (!hotelSide && availMin > LONG_GAP_MIN) return { kind: 'long', availMin, need };
  return { kind: 'ok', availMin, need };
}

/** Calendar-day boundaries the gap crosses (≥ 1 ⇒ it needs a place to sleep). */
export function gapNights(prev: Segment, next: Segment): number {
  const a = new Date(endTimeStr(prev));
  const b = new Date(startTimeStr(next));
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return 0;
  const a0 = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const b0 = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.max(0, Math.round((b0.getTime() - a0.getTime()) / 86400000));
}

/** Are the two ends far enough apart to warrant a connecting segment? */
export function gapRemote(prev: Segment, next: Segment): boolean {
  const d = haversine(endLL(prev), startLL(next));
  if (d != null) return d > REMOTE_KM;
  return (endCity(prev) || '').trim().toLowerCase() !== (startCity(next) || '').trim().toLowerCase();
}

export interface PlanTotals {
  legs: number;
  nightsTotal: number;
  spanMs: number;
  byCurrency: Record<string, number>;
}

/** Aggregate totals for the plan footer. */
export function planTotals(plan: Segment[]): PlanTotals {
  const byCurrency: Record<string, number> = {};
  plan.forEach((r) => {
    byCurrency[r.currency] = (byCurrency[r.currency] || 0) + Number(r.cost);
  });
  const legs = plan.filter((p) => p.kind === 'leg').length;
  const nightsTotal = plan.reduce((s, h) => s + (h.kind === 'hotel' ? nights(h) : 0), 0);
  const spanMs = plan.length ? endMs(plan[plan.length - 1]) - startMs(plan[0]) : 0;
  return { legs, nightsTotal, spanMs, byCurrency };
}
