/** Currency conversion via a free, keyless, CORS-friendly rates API
 * (open.er-api.com, ECB-derived daily rates covering ~160 currencies), with a
 * persistent cache and a rate-limited queue — the same shape as `geocode.ts`.
 * Records store their cost in their own currency plus an optional converted cost
 * in the settings' base currency; totals sum the converted values.
 */

import type { Segment } from './types';

const ENDPOINT = 'https://open.er-api.com/v6/latest';
const CACHE_KEY = 'tripPlanner.fxcache.v1';
/** Refetch a base's table once it's older than this (rates update ~daily). */
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
/** Be polite to the free endpoint. */
const MIN_SPACING_MS = 400;

interface RateTable {
  fetchedAt: number;
  rates: Record<string, number>;
}
type Cache = Record<string, RateTable>;

function loadCache(): Cache {
  try {
    return (JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') as Cache) ?? {};
  } catch {
    return {};
  }
}
const cache: Cache = loadCache();
/** Bases whose fetch failed this session, so we don't hammer a bad code. */
const misses = new Set<string>();

function saveCache(): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* quota exceeded or storage disabled — cache stays in-memory */
  }
}

// Serialise network lookups ≥ MIN_SPACING_MS apart, priority (user-triggered)
// ahead of background backfill — mirrors the geocoder's two-tier queue.
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

interface ErApiResponse {
  result?: string;
  rates?: Record<string, number>;
}

async function fetchTable(base: string): Promise<RateTable | null> {
  const res = await fetch(`${ENDPOINT}/${encodeURIComponent(base)}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`rates HTTP ${res.status}`);
  const data = (await res.json()) as ErApiResponse;
  if (data.result !== 'success' || !data.rates) return null;
  return { fetchedAt: Date.now(), rates: data.rates };
}

/** The rate table for `base`, from cache when fresh, else fetched (queued). */
async function ratesFor(base: string, priority: boolean): Promise<Record<string, number> | null> {
  const key = base.toUpperCase();
  const hit = cache[key];
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return hit.rates;
  if (misses.has(key)) return hit?.rates ?? null; // stale-but-usable if we have it
  try {
    const table = await enqueue(() => fetchTable(key), priority);
    if (table) {
      cache[key] = table;
      misses.delete(key);
      saveCache();
      return table.rates;
    }
    misses.add(key);
    return hit?.rates ?? null;
  } catch {
    misses.add(key);
    return hit?.rates ?? null;
  }
}

export interface ConvertOptions {
  /** User-triggered lookup: jumps ahead of background backfill in the queue. */
  priority?: boolean;
}

/** Convert `amount` from currency `from` to `to`, or `null` if unavailable.
 * Never rejects — a failed lookup returns `null` and callers keep the raw cost. */
export async function convertCost(
  amount: number,
  from: string,
  to: string,
  opts?: ConvertOptions,
): Promise<number | null> {
  if (!Number.isFinite(amount)) return null;
  if (!from || !to || from.toUpperCase() === to.toUpperCase()) return amount;
  const rates = await ratesFor(from, !!opts?.priority);
  const rate = rates?.[to.toUpperCase()];
  return rate != null && Number.isFinite(rate) ? amount * rate : null;
}

/** Fill in missing converted costs in the background (foreign-currency records
 * with no auto value yet), calling `onUpdate` after each one that resolves.
 * Manual values are never touched. Mirrors `backfillCoordinates`. */
export function backfillConversions(items: Segment[], base: string, onUpdate: () => void): void {
  void (async () => {
    for (const it of items) {
      const cost = Number(it.cost) || 0;
      if (!cost || it.currency === base || it.costConvertedManual || it.costConverted != null) continue;
      const v = await convertCost(cost, it.currency, base);
      if (v != null) {
        it.costConverted = Math.round(v * 100) / 100;
        onUpdate();
      }
    }
  })();
}
