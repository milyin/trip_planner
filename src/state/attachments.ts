/** Locally stored files (ticket PDFs, booking screenshots) in IndexedDB.
 * Blobs don't fit in localStorage; IndexedDB stores them natively with a
 * large per-origin quota. Segments reference a stored file through a link
 * of the form `attachment:<id>`. */

const DB_NAME = 'tripPlanner';
const STORE = 'attachments';
const LINK_PREFIX = 'attachment:';

interface AttachmentRecord {
  id: string;
  name: string;
  type: string;
  blob: Blob;
  createdAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    // Ask the browser not to evict our storage under pressure (best-effort).
    navigator.storage?.persist?.().catch(() => {});
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = run(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export const isAttachmentLink = (link: string | null): boolean => !!link && link.startsWith(LINK_PREFIX);

/** Store a file; returns the `attachment:<id>` link to put on the record. */
export async function putAttachment(file: File): Promise<string> {
  const id = 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const rec: AttachmentRecord = { id, name: file.name, type: file.type, blob: file, createdAt: Date.now() };
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
