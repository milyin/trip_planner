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
  cost: number, cur: CurrencyCode, link: string | null, inPlan: boolean,
): Hotel {
  return {
    id: nextId(), kind: 'hotel', city, name, addr, checkIn: ci, checkOut: co,
    cost, currency: cur, link: link || null, ll: geocode(city, addr), inPlan,
  };
}

/** Demo itinerary shown on first load. */
export const seedItems = (): Segment[] => [
  leg('Marseille', 'Airport', '2026-05-01T12:00', 'Paris', 'CDG', '2026-05-01T13:30', 'Plane', 'AirFrance', 100, 'EUR', true),
  leg('Paris', 'Orly', '2026-05-01T16:00', 'Madrid', 'Airport', '2026-05-01T18:00', 'Plane', 'Iberia', 150, 'EUR', true),
  leg('Paris', 'CDG', '2026-05-01T13:00', 'Lyon', 'Part-Dieu', '2026-05-01T14:30', 'Train', 'SNCF', 60, 'EUR', false),
  leg('Madrid', 'Airport', '2026-05-02T09:00', 'Barcelona', 'El Prat', '2026-05-02T10:15', 'Plane', 'Vueling', 80, 'EUR', true),
  leg('Marseille', 'St-Charles', '2026-05-01T08:00', 'Nice', 'Ville', '2026-05-01T09:00', 'Train', 'SNCF', 30, 'EUR', false),
  leg('Nice', 'Port', '2026-05-01T10:00', 'Marseille', 'Old Port', '2026-05-01T13:20', 'Bus', 'FlixBus', 20, 'EUR', false),
  hotel('Madrid', 'Hostal Central', 'Gran Vía 8', '2026-05-01T20:00', '2026-05-02T08:00', 90, 'EUR', null, false),
  hotel('Paris', 'Hôtel Le Marais', '12 Rue de Rivoli', '2026-05-02T15:00', '2026-05-04T11:00', 240, 'EUR', 'https://example.com/le-marais', false),
  leg('Madrid', 'Airport', '2026-05-02T20:00', 'Lisbon', 'Airport', '2026-05-02T21:30', 'Plane', 'TAP', 120, 'EUR', true),
];
