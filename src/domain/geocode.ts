/** Real geocoding via Nominatim (OpenStreetMap), with a persistent cache and
 * a rate-limited request queue. The static gazetteer in geo.ts serves as an
 * instant offline tier for the demo cities. */

import type { Hotel, Leg, Segment } from './types';
import type { LatLng } from './types';
import { geocode as gazetteer } from './geo';

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const CACHE_KEY = 'tripPlanner.geocache.v1';
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
}

async function search(q: string): Promise<LatLng | null> {
  const url = `${ENDPOINT}?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  const hits = (await res.json()) as NominatimHit[];
  if (!hits.length) return null;
  const ll: LatLng = [Number(hits[0].lat), Number(hits[0].lon)];
  return Number.isFinite(ll[0]) && Number.isFinite(ll[1]) ? ll : null;
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

/** Resolve a specific address/stop within a city — no bare-city fallback, so
 * a miss genuinely means "this address wasn't found" (the city may still be). */
export async function geocodeAddress(city: string, addr: string, opts?: GeocodeOptions): Promise<LatLng | null> {
  const c = (city || '').trim();
  const a = (addr || '').trim();
  if (!a) return null;
  // 'x:' namespace: legacy combined-lookup entries may hold city-fallback coords.
  const key = `x:${c}|${a}`.toLowerCase();
  if (cache[key]) return cache[key];
  if (misses.has(key) && !opts?.force) return null;
  try {
    const ll = await enqueue(() => search(c ? `${a}, ${c}` : a), !!opts?.priority);
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
