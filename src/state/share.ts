/** Workspace sharing via URL: the whole workspace (minus images and LLM
 * exchanges) plus the relevant geocode-cache entries, gzipped and
 * base64url-encoded into the fragment (`#ws=…`), so nothing touches a server. */

import { exportGeoCache, mergeGeoCache } from '../domain/geocode';
import type { LatLng, Segment } from '../domain/types';
import { state } from './store';
import { activeWorkspace, createWorkspace, itemsKey, setActiveWorkspace } from './workspaces';

interface SharePayload {
  v: 1;
  name: string;
  items: Segment[];
  geo: Record<string, LatLng>;
}

const HASH_PREFIX = '#ws=';

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Geocode-cache entries for the places the items mention (both the plain
 * `city|addr` keys and the exact `x:`-namespaced address keys). */
function relevantGeo(items: Segment[]): Record<string, LatLng> {
  const cache = exportGeoCache();
  const wanted = new Set<string>();
  const add = (city: string, addr: string): void => {
    const c = city.trim().toLowerCase();
    const a = addr.trim().toLowerCase();
    wanted.add(`${c}|`);
    wanted.add(`${c}|${a}`);
    wanted.add(`x:${c}|${a}`);
  };
  for (const it of items) {
    if (it.kind === 'hotel') add(it.city, it.addr);
    else {
      add(it.dep.city, it.dep.addr);
      add(it.arr.city, it.arr.addr);
    }
  }
  const out: Record<string, LatLng> = {};
  for (const k of Object.keys(cache)) if (wanted.has(k)) out[k] = cache[k];
  return out;
}

/** Build the share URL for the active workspace. */
export async function buildShareUrl(): Promise<string> {
  // Deep-copy and strip what the URL must not carry: images stay local.
  const items = (JSON.parse(JSON.stringify(state.items)) as Segment[]).map((it) => ({
    ...it,
    attachment: null,
  })) as Segment[];
  const payload: SharePayload = { v: 1, name: activeWorkspace().name, items, geo: relevantGeo(items) };
  const encoded = toBase64Url(await gzip(JSON.stringify(payload)));
  const base = location.origin + location.pathname;
  return `${base}${HASH_PREFIX}${encoded}`;
}

/** Import a workspace from the URL fragment, if present. Returns true when a
 * workspace was imported and activated (caller reloads the store). */
export async function importSharedFromHash(): Promise<boolean> {
  if (!location.hash.startsWith(HASH_PREFIX)) return false;
  const encoded = location.hash.slice(HASH_PREFIX.length);
  // Whatever happens, don't leave the payload in the address bar.
  history.replaceState(null, '', location.pathname + location.search);
  try {
    const payload = JSON.parse(await gunzip(fromBase64Url(encoded))) as SharePayload;
    if (payload.v !== 1 || !Array.isArray(payload.items)) throw new Error('unsupported payload');
    const ws = createWorkspace(`${payload.name || 'Shared'} (shared)`);
    localStorage.setItem(itemsKey(ws.id), JSON.stringify(payload.items));
    if (payload.geo && typeof payload.geo === 'object') mergeGeoCache(payload.geo);
    setActiveWorkspace(ws.id);
    return true;
  } catch (e) {
    alert(`Could not import the shared workspace from this link: ${e instanceof Error ? e.message : e}`);
    return false;
  }
}
