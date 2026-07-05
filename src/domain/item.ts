import type { Hotel, LatLng, Leg, Segment } from './types';
import { zonedMs } from './tz';

/**
 * Uniform accessors that work across both record types, so plan/gap/map code can
 * treat a segment and a hotel as a generic "item" with a start and an end. Times
 * resolve through each place's time zone when it has one (else browser-local).
 */
export const startMs = (x: Segment): number =>
  x.kind === 'hotel' ? zonedMs(x.checkIn, x.tz) : zonedMs(x.dep.time, x.dep.tz);
export const endMs = (x: Segment): number =>
  x.kind === 'hotel' ? zonedMs(x.checkOut, x.tz) : zonedMs(x.arr.time, x.arr.tz);
export const startLL = (x: Segment): LatLng | null => (x.kind === 'hotel' ? x.ll : x.dep.ll);
export const endLL = (x: Segment): LatLng | null => (x.kind === 'hotel' ? x.ll : x.arr.ll);
export const startCity = (x: Segment): string => (x.kind === 'hotel' ? x.city : x.dep.city);
export const endCity = (x: Segment): string => (x.kind === 'hotel' ? x.city : x.arr.city);
export const startTimeStr = (x: Segment): string => (x.kind === 'hotel' ? x.checkIn : x.dep.time);
export const endTimeStr = (x: Segment): string => (x.kind === 'hotel' ? x.checkOut : x.arr.time);
export const startAddr = (x: Segment): string => (x.kind === 'hotel' ? x.addr || '' : x.dep.addr);
export const endAddr = (x: Segment): string => (x.kind === 'hotel' ? x.addr || '' : x.arr.addr);

/** Number of nights a hotel stay spans (at least 1). */
export const nights = (h: Hotel): number =>
  Math.max(1, Math.round((zonedMs(h.checkOut, h.tz) - zonedMs(h.checkIn, h.tz)) / 86400000));

/** True when two segments intersect in time. */
export const overlaps = (a: Leg, b: Leg): boolean =>
  zonedMs(a.dep.time, a.dep.tz) < zonedMs(b.arr.time, b.arr.tz) &&
  zonedMs(b.dep.time, b.dep.tz) < zonedMs(a.arr.time, a.arr.tz);
