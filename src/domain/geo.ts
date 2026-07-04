import type { LatLng } from './types';

/**
 * Tiny offline gazetteer standing in for a real geocoding provider. Coordinates
 * are approximate and only cover the cities used by the demo itinerary; a real
 * deployment would swap this for a network geocoder behind the same interface.
 */
const GAZETTEER: Record<string, LatLng> = {
  marseille: [43.4393, 5.2214], paris: [48.9, 2.45], 'paris cdg': [49.0097, 2.5479],
  'paris orly': [48.7233, 2.3794], madrid: [40.4936, -3.5668], lyon: [45.7256, 5.0811],
  nice: [43.6584, 7.2159], barcelona: [41.2974, 2.0833], london: [51.47, -0.4543],
  berlin: [52.3667, 13.5033], rome: [41.8003, 12.2389], amsterdam: [52.3105, 4.7683],
  lisbon: [38.7742, -9.1342], geneva: [46.2381, 6.109], zurich: [47.4647, 8.5492],
  brussels: [50.9014, 4.4844], milan: [45.6306, 8.7281],
};

/** Resolve a city/address to coordinates, or `null` (like a real geocoder miss). */
export function geocode(city: string, addr?: string): LatLng | null {
  const key = (city + ' ' + (addr || '')).trim().toLowerCase();
  if (GAZETTEER[key]) return GAZETTEER[key];
  const c = (city || '').trim().toLowerCase();
  if (GAZETTEER[c]) return GAZETTEER[c];
  for (const g in GAZETTEER) {
    if (c && g.includes(c)) return GAZETTEER[g];
  }
  return null;
}

/** Great-circle distance in kilometres, or `null` if either point is missing. */
export function haversine(a: LatLng | null, b: LatLng | null): number | null {
  if (!a || !b) return null;
  const R = 6371;
  const rad = (x: number): number => (x * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]);
  const dLon = rad(b[1] - a[1]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
