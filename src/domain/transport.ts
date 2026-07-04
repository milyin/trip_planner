import type { CurrencyCode, TransportKind } from './types';

/** Transport modes in display order (drives the map legend + modal select). */
export const TRANSPORT_KINDS: readonly TransportKind[] = ['Plane', 'Train', 'Bus', 'Taxi', 'Car', 'Other'];

/** Emoji icon per transport mode. */
export const TRANSPORT_ICON: Record<TransportKind, string> = {
  Plane: '✈', Train: '🚆', Bus: '🚌', Taxi: '🚕', Car: '🚗', Other: '•',
};

/** CSS custom-property that holds each mode's shared line/icon colour. */
export const TRANSPORT_COLOR_VAR: Record<TransportKind, string> = {
  Plane: '--t-plane', Train: '--t-train', Bus: '--t-bus',
  Taxi: '--t-taxi', Car: '--t-car', Other: '--t-other',
};

/**
 * Minimum connection buffer per mode (minutes): how long a traveller must
 * arrive before the NEXT leg departs. Domain data — reused by any frontend.
 */
export const CONNECTION_BUFFER_MIN: Record<TransportKind, number> = {
  Plane: 120, Train: 20, Bus: 15, Taxi: 5, Car: 5, Other: 30,
};

/** A layover longer than this (minutes) is flagged "too long" (yellow). */
export const LONG_GAP_MIN = 8 * 60;

/** Ends farther apart than this (km) are "geographically remote" → offer a connecting segment. */
export const REMOTE_KM = 50;

/** Currency symbol/prefix per code. */
export const CURRENCY_SYMBOL: Record<CurrencyCode, string> = {
  EUR: '€', USD: '$', GBP: '£', CHF: 'CHF ',
};

/** Connection buffer for a mode, defaulting to the `Other` value. */
export const bufferMin = (t: TransportKind): number => CONNECTION_BUFFER_MIN[t] ?? 30;

/** Symbol for a currency code, tolerating unknown codes (e.g. `"XYZ "`). */
export const currencySymbol = (c: string): string =>
  (CURRENCY_SYMBOL as Record<string, string>)[c] ?? c + ' ';
