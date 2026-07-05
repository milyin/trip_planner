/** Geographic coordinate as a [latitude, longitude] pair. */
export type LatLng = [number, number];

/** Transport modes for a segment (mirrors the original Rust `Transport` enum). */
export type TransportKind = 'Plane' | 'Train' | 'Bus' | 'Taxi' | 'Car' | 'Other';

/** An ISO 4217 currency code, e.g. `"EUR"`, `"USD"`, `"JPY"`. Any real code is
 * accepted (the picker offers the full `Intl.supportedValuesOf('currency')` set). */
export type CurrencyCode = string;

/** One end of a segment: a place (city + address) resolved at a moment in time. */
export interface Place {
  city: string;
  addr: string;
  /** `datetime-local` string, e.g. `"2026-05-01T12:00"`, local to this place. */
  time: string;
  /** IANA time zone for `time` (e.g. `"Europe/Paris"`); absent = browser-local. */
  tz?: string;
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
  /** Cost expressed in the settings' base currency (auto-converted or entered). */
  costConverted?: number;
  /** True once the user typed a converted cost — auto-conversion won't overwrite it. */
  costConvertedManual?: boolean;
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
  /** IANA time zone for check-in/out (e.g. `"Europe/Paris"`); absent = browser-local. */
  tz?: string;
  cost: number;
  currency: CurrencyCode;
  /** Cost expressed in the settings' base currency (auto-converted or entered). */
  costConverted?: number;
  /** True once the user typed a converted cost — auto-conversion won't overwrite it. */
  costConvertedManual?: boolean;
  /** `attachment:<id>` reference to the locally stored booking image, if any. */
  attachment: string | null;
  ll: LatLng | null;
  inPlan: boolean;
}

/** Any record the planner manages. */
export type Segment = Leg | Hotel;
