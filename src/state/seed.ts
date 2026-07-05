import type { CurrencyCode, Hotel, Leg, TransportKind, Segment } from '../domain/types';
import { geocode } from '../domain/geo';
import { nextId } from './id';

function leg(
  dc: string, da: string, dt: string,
  ac: string, aa: string, at: string,
  tr: TransportKind, co: string, cost: number, cur: CurrencyCode, inPlan: boolean,
): Leg {
  return {
    id: nextId(), kind: 'leg',
    dep: { city: dc, addr: da, time: dt, ll: geocode(dc, da) },
    arr: { city: ac, addr: aa, time: at, ll: geocode(ac, aa) },
    transport: tr, company: co, cost, currency: cur, attachment: null, inPlan,
  };
}

function hotel(
  city: string, name: string, addr: string, ci: string, co: string,
  cost: number, cur: CurrencyCode, inPlan: boolean,
): Hotel {
  return {
    id: nextId(), kind: 'hotel', city, name, addr, checkIn: ci, checkOut: co,
    cost, currency: cur, attachment: null, ll: geocode(city, addr), inPlan,
  };
}

/** Demo itinerary shown on first load: a Paris ↔ Marseille round trip. */
export const seedItems = (): Segment[] => [
  leg('Paris', 'CDG', '2026-05-01T09:00', 'Marseille', 'Airport', '2026-05-01T10:30', 'Plane', 'AirFrance', 100, 'EUR', true),
  hotel('Marseille', 'Hôtel Vieux Port', '12 Quai du Port', '2026-05-01T15:00', '2026-05-03T11:00', 180, 'EUR', true),
  leg('Marseille', 'Airport', '2026-05-03T14:00', 'Paris', 'CDG', '2026-05-03T15:30', 'Plane', 'AirFrance', 100, 'EUR', true),
];
