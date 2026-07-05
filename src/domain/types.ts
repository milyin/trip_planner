/** Geographic coordinate as a [latitude, longitude] pair. */
export type LatLng = [number, number];

/** Transport modes for a segment (mirrors the original Rust `Transport` enum). */
export type TransportKind = 'Plane' | 'Train' | 'Bus' | 'Taxi' | 'Car' | 'Other';

/** Supported currency codes (mirrors `Money.currency`). */
export type CurrencyCode = 'EUR' | 'USD' | 'GBP' | 'CHF';

/** One end of a segment: a place (city + address) resolved at a moment in time. */
export interface Place {
  city: string;
  addr: string;
  /** `datetime-local` string, e.g. `"2026-05-01T12:00"`. */
  time: string;
  ll: LatLng | null;
}

/** A transport leg between two places (the record formerly called a "route"). */
export interface Leg {
  id: string;
  kind: 'leg';
  dep: Place;
  arr: Place;
  transport: TransportKind;
  company: string;
  cost: number;
  currency: CurrencyCode;
  /** Number of transfers/connections on this leg (0 = direct). */
  transfers: number;
  /** Free-form transfer details (intermediate cities, durations, …). */
  transfersInfo: string;
  /** `attachment:<id>` reference to the locally stored ticket image, if any. */
  attachment: string | null;
  inPlan: boolean;
}

/** An overnight stay. */
export interface Hotel {
  id: string;
  kind: 'hotel';
  city: string;
  name: string;
  addr: string;
  /** `datetime-local` check-in string. */
  checkIn: string;
  /** `datetime-local` check-out string. */
  checkOut: string;
  cost: number;
  currency: CurrencyCode;
  /** `attachment:<id>` reference to the locally stored booking image, if any. */
  attachment: string | null;
  ll: LatLng | null;
  inPlan: boolean;
}

/** Any record the planner manages. */
export type Segment = Leg | Hotel;
