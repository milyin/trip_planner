/** Locally stored files (ticket PDFs, booking screenshots) and per-segment
 * LLM exchanges in IndexedDB. Blobs don't fit in localStorage; IndexedDB
 * stores them natively with a large per-origin quota. Segments reference a
 * stored file through a link of the form `attachment:<id>`. */

import type { LlmExchange } from '../import/debugLog';

const DB_NAME = 'tripPlanner';
const STORE = 'attachments';
const EX_STORE = 'exchanges';
const LINK_PREFIX = 'attachment:';

interface AttachmentRecord {
  id: string;
  name: string;
  type: string;
  blob: Blob;
  createdAt: number;
}

interface ExchangeRecord {
  /** Leg id the recognition belongs to. */
  id: string;
  exchange: LlmExchange;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    // Ask the browser not to evict our storage under pressure (best-effort).
    navigator.storage?.persist?.().catch(() => {});
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 2);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
        if (!req.result.objectStoreNames.contains(EX_STORE)) req.result.createObjectStore(EX_STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function txIn<T>(
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const txn = db.transaction(storeName, mode);
        const req = run(txn.objectStore(storeName));
        req.onerror = () => reject(req.error);
        if (mode === 'readwrite') {
          // Resolve only once the write is durably committed — request
          // success fires before the transaction completes, and a reload in
          // that window would lose the write.
          txn.oncomplete = () => resolve(req.result);
          txn.onabort = () => reject(txn.error);
        } else {
          req.onsuccess = () => resolve(req.result);
        }
      }),
  );
}

const tx = <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> =>
  txIn(STORE, mode, run);

export const isAttachmentLink = (link: string | null): boolean => !!link && link.startsWith(LINK_PREFIX);

/** Store a file; returns the `attachment:<id>` link to put on the record. */
export async function putAttachment(file: File): Promise<string> {
  const id = 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  // Copy the bytes: Chromium stores `File` objects by reference to the file
  // on disk, so a dropped screenshot that is later deleted or moved would
  // silently break the stored attachment.
  const blob = new Blob([await file.arrayBuffer()], { type: file.type });
  const rec: AttachmentRecord = { id, name: file.name, type: file.type, blob, createdAt: Date.now() };
  await tx('readwrite', (s) => s.put(rec));
  return LINK_PREFIX + id;
}

export async function getAttachment(link: string): Promise<AttachmentRecord | null> {
  if (!isAttachmentLink(link)) return null;
  const rec = await tx<AttachmentRecord | undefined>('readonly', (s) => s.get(link.slice(LINK_PREFIX.length)));
  return rec ?? null;
}

export async function deleteAttachment(link: string | null): Promise<void> {
  if (!link || !isAttachmentLink(link)) return;
  await tx('readwrite', (s) => s.delete(link.slice(LINK_PREFIX.length)));
}

/** Resolve any link to an openable URL: object URL for attachments, the link
 * itself for plain URLs. Returns the mime type for preview rendering. */
export async function resolveLink(link: string | null): Promise<{ url: string; type: string } | null> {
  if (!link) return null;
  if (!isAttachmentLink(link)) return { url: link, type: '' };
  const rec = await getAttachment(link);
  if (!rec) return null;
  return { url: URL.createObjectURL(rec.blob), type: rec.type };
}

/** Persist the LLM exchange that produced a segment (keyed by segment id). */
export async function putExchange(segmentId: string, exchange: LlmExchange): Promise<void> {
  await txIn<IDBValidKey>(EX_STORE, 'readwrite', (s) => s.put({ id: segmentId, exchange } satisfies ExchangeRecord));
}

export async function getExchange(segmentId: string): Promise<LlmExchange | null> {
  const rec = await txIn<ExchangeRecord | undefined>(EX_STORE, 'readonly', (s) => s.get(segmentId));
  return rec?.exchange ?? null;
}

export async function deleteExchange(segmentId: string): Promise<void> {
  await txIn(EX_STORE, 'readwrite', (s) => s.delete(segmentId));
}

/** Wipe every stored file and exchange (used by "Clear all"). */
export async function clearAllStored(): Promise<void> {
  await tx('readwrite', (s) => s.clear());
  await txIn(EX_STORE, 'readwrite', (s) => s.clear());
}
