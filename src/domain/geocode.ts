/** Real geocoding via Nominatim (OpenStreetMap), with a persistent cache and
 * a rate-limited request queue. The static gazetteer in geo.ts serves as an
 * instant offline tier for the demo cities. */

import type { Hotel, Leg, Segment } from './types';
import type { LatLng } from './types';
import { geocode as gazetteer } from './geo';

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const CACHE_KEY = 'tripPlanner.geocache.v1';
const DETAILS_CACHE_KEY = 'tripPlanner.placeDetails.v1';
const CACHE_MAX = 200;
/** Nominatim usage policy: at most one request per second. */
const MIN_SPACING_MS = 1100;

type Cache = Record<string, LatLng>;

function loadCache(): Cache {
  try {
    return (JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') as Cache) ?? {};
  } catch {
    return {};
  }
}

const cache: Cache = loadCache();
/** Failed lookups, remembered for this session only so a later visit retries. */
const misses = new Set<string>();

function saveCache(): void {
  try {
    const keys = Object.keys(cache);
    // Drop oldest-inserted entries when over the cap (object key order).
    for (const k of keys.slice(0, Math.max(0, keys.length - CACHE_MAX))) delete cache[k];
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* quota exceeded or storage disabled — cache stays in-memory */
  }
}

// Serialize network lookups ≥ MIN_SPACING_MS apart. Two tiers: user-triggered
// lookups (dialog) jump ahead of background backfill, so the dialog is never
// starved by a long backfill queue.
interface QueueItem {
  task: () => Promise<unknown>;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}

const highQ: QueueItem[] = [];
const lowQ: QueueItem[] = [];
let pumping = false;
let lastRequestAt = 0;

async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  while (highQ.length || lowQ.length) {
    const item = (highQ.shift() ?? lowQ.shift())!;
    const wait = lastRequestAt + MIN_SPACING_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
    try {
      item.resolve(await item.task());
    } catch (e) {
      item.reject(e);
    }
  }
  pumping = false;
}

function enqueue<T>(task: () => Promise<T>, priority: boolean): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    (priority ? highQ : lowQ).push({ task, resolve: resolve as (v: unknown) => void, reject });
    void pump();
  });
}

interface NominatimHit {
  lat: string;
  lon: string;
  category?: string;
  type?: string;
  name?: string;
  display_name?: string;
  address?: Record<string, string>;
  namedetails?: Record<string, string>;
}

async function searchHit(q: string, details = false): Promise<NominatimHit | null> {
  const detailParams = details ? '&addressdetails=1&namedetails=1' : '';
  const url = `${ENDPOINT}?format=jsonv2&limit=1${detailParams}&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  const hits = (await res.json()) as NominatimHit[];
  return hits[0] ?? null;
}

function hitLatLng(hit: NominatimHit | null): LatLng | null {
  if (!hit) return null;
  const ll: LatLng = [Number(hit.lat), Number(hit.lon)];
  return Number.isFinite(ll[0]) && Number.isFinite(ll[1]) ? ll : null;
}

async function search(q: string): Promise<LatLng | null> {
  return hitLatLng(await searchHit(q));
}

export interface LocatedPlace {
  ll: LatLng;
  /** Locality inferred from the matched stop/airport when the input city was blank. */
  city?: string;
  /** Human-readable matched feature name, retained for diagnostics/UI hints. */
  name?: string;
}

type DetailsCache = Record<string, LocatedPlace>;

function loadDetailsCache(): DetailsCache {
  try {
    return (JSON.parse(localStorage.getItem(DETAILS_CACHE_KEY) || '{}') as DetailsCache) ?? {};
  } catch {
    return {};
  }
}

const detailsCache = loadDetailsCache();

function saveDetailsCache(): void {
  try {
    const keys = Object.keys(detailsCache);
    for (const k of keys.slice(0, Math.max(0, keys.length - CACHE_MAX))) delete detailsCache[k];
    localStorage.setItem(DETAILS_CACHE_KEY, JSON.stringify(detailsCache));
  } catch {
    /* quota exceeded or storage disabled — cache stays in-memory */
  }
}

const firstAddressValue = (address: Record<string, string> | undefined, keys: string[]): string | undefined =>
  keys.map((key) => address?.[key]?.trim()).find(Boolean);

/** Airport municipalities are often not the city advertised to travellers
 * (GVA is in Le Grand-Saconnex; ORY is in Villeneuve-le-Roi). Prefer the city
 * embedded in the airport's English OSM name when the query matches its IATA
 * code, with the ordinary address locality as a safe fallback. */
function cityFromHit(hit: NominatimHit, query: string): string | undefined {
  const locality = firstAddressValue(hit.address, ['city', 'town', 'village', 'municipality', 'county']);
  const names = hit.namedetails;
  const code = query.trim().toUpperCase();
  const isAirportCode = /^[A-Z]{3}$/.test(code)
    && (names?.iata?.toUpperCase() === code || names?.ref?.toUpperCase() === code)
    && (hit.category === 'aeroway' || hit.type === 'aerodrome');
  if (!isAirportCode) return locality;

  const airportName = names?.['short_name:en'] ?? names?.['name:en'] ?? hit.name;
  if (!airportName) return locality;
  const withoutType = airportName
    .replace(/\b(?:international|regional|municipal|metropolitan)\s+(?:airport|aerodrome)\b.*$/i, '')
    .replace(/\b(?:airport|aerodrome)\b.*$/i, '')
    .trim();
  const separatedCity = withoutType.split(/\s*[–—-]\s*/, 1)[0]?.trim();
  if (separatedCity && separatedCity !== withoutType) return separatedCity;
  if (locality && withoutType.toLocaleLowerCase().startsWith(locality.toLocaleLowerCase())) return locality;
  if (/^[\p{L}'’.  ]+$/u.test(withoutType) && withoutType.split(/\s+/).length === 1) return withoutType;
  return locality ?? (withoutType || undefined);
}

export interface GeocodeOptions {
  /** User-triggered lookup: jumps ahead of background backfill in the queue. */
  priority?: boolean;
  /** Retry even if this key already failed this session (explicit user retry). */
  force?: boolean;
}

/** Resolve a city (+ optional airport/station/address) to coordinates.
 * Never rejects — a failed lookup returns `null` and the record still saves. */
export async function geocodePlace(city: string, addr?: string, opts?: GeocodeOptions): Promise<LatLng | null> {
  const c = (city || '').trim();
  const a = (addr || '').trim();
  if (!c && !a) return null;
  const key = `${c}|${a}`.toLowerCase();
  if (cache[key]) return cache[key];
  const offline = gazetteer(c, a);
  if (offline) return offline;
  if (misses.has(key) && !opts?.force) return null;
  const priority = !!opts?.priority;
  try {
    // Try the specific place first ("CDG, Paris"), then the bare city.
    const ll =
      (a ? await enqueue(() => search(`${a}, ${c}`), priority) : null) ??
      (c ? await enqueue(() => search(c), priority) : null);
    if (ll) {
      cache[key] = ll;
      misses.delete(key);
      saveCache();
      return ll;
    }
    misses.add(key);
    return null;
  } catch {
    misses.add(key);
    return null;
  }
}

/** Resolve a specific address/stop and retain its matched locality. There is no
 * bare-city fallback, so a miss genuinely means the address wasn't found. */
export async function locateAddress(city: string, addr: string, opts?: GeocodeOptions): Promise<LocatedPlace | null> {
  const c = (city || '').trim();
  const a = (addr || '').trim();
  if (!a) return null;
  // 'x:' namespace: legacy combined-lookup entries may hold city-fallback coords.
  const key = `x:${c}|${a}`.toLowerCase();
  if (detailsCache[key]) return detailsCache[key];
  if (misses.has(key) && !opts?.force) return null;
  try {
    const hit = await enqueue(() => searchHit(c ? `${a}, ${c}` : a, true), !!opts?.priority);
    const ll = hitLatLng(hit);
    if (hit && ll) {
      const located: LocatedPlace = {
        ll,
        city: c || cityFromHit(hit, a),
        name: hit.name?.trim() || hit.display_name?.split(',', 1)[0]?.trim() || undefined,
      };
      cache[key] = ll;
      detailsCache[key] = located;
      // The dialog will save the inferred city. Cache that future query shape
      // too, so reopening the leg does not spend another network request.
      if (!c && located.city) {
        const cityKey = `x:${located.city}|${a}`.toLowerCase();
        cache[cityKey] = ll;
        detailsCache[cityKey] = located;
      }
      misses.delete(key);
      saveCache();
      saveDetailsCache();
      return located;
    }
    misses.add(key);
    return null;
  } catch {
    misses.add(key);
    return null;
  }
}

/** Coordinate-only compatibility wrapper used by existing callers. */
export async function geocodeAddress(city: string, addr: string, opts?: GeocodeOptions): Promise<LatLng | null> {
  return (await locateAddress(city, addr, opts))?.ll ?? null;
}

/** Snapshot of the persistent geocode cache (for workspace sharing). */
export const exportGeoCache = (): Record<string, LatLng> => ({ ...cache });

/** Merge shared geocode entries into the cache (imported workspaces bring
 * their sender's lookups along, saving the receiver the network round). */
export function mergeGeoCache(entries: Record<string, LatLng>): void {
  for (const [k, v] of Object.entries(entries)) {
    if (Array.isArray(v) && v.length === 2 && Number.isFinite(v[0]) && Number.isFinite(v[1])) cache[k] = v;
  }
  saveCache();
}

/** Fill in missing coordinates on stored records in the background.
 * Calls `onUpdate` after each record that gained coordinates. */
export function backfillCoordinates(items: Segment[], onUpdate: () => void): void {
  void (async () => {
    for (const it of items) {
      if (it.kind === 'leg') {
        const leg = it as Leg;
        let changed = false;
        if (!leg.dep.ll) {
          leg.dep.ll = await geocodePlace(leg.dep.city, leg.dep.addr);
          changed = changed || !!leg.dep.ll;
        }
        if (!leg.arr.ll) {
          leg.arr.ll = await geocodePlace(leg.arr.city, leg.arr.addr);
          changed = changed || !!leg.arr.ll;
        }
        if (changed) onUpdate();
      } else {
        const h = it as Hotel;
        if (!h.ll) {
          h.ll = await geocodePlace(h.city, h.addr);
          if (h.ll) onUpdate();
        }
      }
    }
  })();
}
