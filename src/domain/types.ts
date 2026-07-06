/** Geographic coordinate as a [latitude, longitude] pair. */
export type LatLng = [number, number];

/** Transport modes for a segment (mirrors the original Rust `Transport` enum). */
export type TransportKind = 'Plane' | 'Train' | 'Bus' | 'Taxi' | 'Car' | 'Other';

/** An ISO 4217 currency code, e.g. `"EUR"`, `"USD"`, `"JPY"`. Any real code is
 * accepted (the picker offers the full `Intl.supportedValuesOf('currency')` set). */
export type CurrencyCode = string;

/** One attachment or note kept on a segment. Files loaded on the Recognize page
 * are `source: 'llm'`; files, links and text the user adds in the Notes tab are
 * `source: 'user'`. Any entry can be removed, but only user entries are addable
 * in the Notes tab. */
export interface NoteEntry {
  id: string;
  source: 'llm' | 'user';
  kind: 'file' | 'text';
  /** file: `attachment:<id>` reference into the local IndexedDB store. */
  attachment?: string;
  /** file: display name and MIME type. */
  name?: string;
  mime?: string;
  /** text: the note or a URL. */
  text?: string;
}

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
  /** Files (from the Recognize page or added manually), links and text notes. */
  notes: NoteEntry[];
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
  /** Files (from the Recognize page or added manually), links and text notes. */
  notes: NoteEntry[];
  ll: LatLng | null;
  inPlan: boolean;
}

/** Any record the planner manages. */
export type Segment = Leg | Hotel;
