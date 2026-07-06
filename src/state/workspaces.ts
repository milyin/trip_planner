/** Named workspaces: each holds its own set of segments under its own
 * localStorage key; settings, theme and the geocode cache stay global. */

import { copyAttachment, copyExchange, deleteAttachment, deleteExchange } from './attachments';
import { nextId } from './id';

export interface WorkspaceInfo {
  id: string;
  name: string;
}

interface Registry {
  active: string;
  list: WorkspaceInfo[];
}

const REG_KEY = 'tripPlanner.workspaces.v1';
/** Pre-workspace storage key; migrated into the first workspace. */
const LEGACY_ITEMS_KEY = 'tripPlanner.items.v1';

export const itemsKey = (wsId: string): string => `tripPlanner.items.${wsId}`;

export const genWorkspaceId = (): string =>
  'ws' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function load(): Registry {
  try {
    const raw = localStorage.getItem(REG_KEY);
    if (raw) {
      const reg = JSON.parse(raw) as Registry;
      if (reg.list?.length && reg.list.some((w) => w.id === reg.active)) return reg;
    }
  } catch {
    /* fall through to a fresh registry */
  }
  // First run (or corrupt registry): create Default, adopting legacy items.
  const def: WorkspaceInfo = { id: genWorkspaceId(), name: 'Default' };
  const reg: Registry = { active: def.id, list: [def] };
  try {
    const legacy = localStorage.getItem(LEGACY_ITEMS_KEY);
    if (legacy !== null) {
      localStorage.setItem(itemsKey(def.id), legacy);
      localStorage.removeItem(LEGACY_ITEMS_KEY);
    }
  } catch {
    /* storage disabled — registry stays in-memory */
  }
  save(reg);
  return reg;
}

const registry: Registry = load();

function save(reg: Registry): void {
  try {
    localStorage.setItem(REG_KEY, JSON.stringify(reg));
  } catch {
    /* quota exceeded or storage disabled */
  }
}

export const activeWorkspace = (): WorkspaceInfo =>
  registry.list.find((w) => w.id === registry.active) ?? registry.list[0];

export const listWorkspaces = (): WorkspaceInfo[] => [...registry.list];

/** Unique cities of a workspace's stored items, in insertion order. */
export function workspaceCities(id: string): string[] {
  try {
    const items = JSON.parse(localStorage.getItem(itemsKey(id)) || '[]') as (
      | { kind: 'leg'; dep?: { city?: string }; arr?: { city?: string } }
      | { kind: 'hotel'; city?: string }
    )[];
    const out: string[] = [];
    const add = (c: string | undefined): void => {
      const t = (c || '').trim();
      if (t && !out.includes(t)) out.push(t);
    };
    for (const it of items) {
      if (it.kind === 'hotel') add(it.city);
      else {
        add(it.dep?.city);
        add(it.arr?.city);
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Create a workspace (empty, not seeded) and return it. */
export function createWorkspace(name: string): WorkspaceInfo {
  const ws: WorkspaceInfo = { id: genWorkspaceId(), name: name.trim() || 'Unnamed' };
  registry.list.push(ws);
  try {
    localStorage.setItem(itemsKey(ws.id), '[]');
  } catch {
    /* storage disabled */
  }
  save(registry);
  return ws;
}

/** Duplicate a workspace's whole content into a new one with a fresh name.
 * Records get new ids, and their images and LLM exchanges are copied too, so
 * the copy is fully independent of the source (deleting either leaves the
 * other intact). Returns the new workspace. */
export async function copyWorkspace(sourceId: string, name: string): Promise<WorkspaceInfo> {
  interface Note { attachment?: string | null }
  interface Rec { id: string; notes?: Note[] }
  let items: Rec[] = [];
  try {
    items = JSON.parse(localStorage.getItem(itemsKey(sourceId)) || '[]') as Rec[];
  } catch {
    items = [];
  }
  const copies: Rec[] = [];
  for (const it of items) {
    const clone = JSON.parse(JSON.stringify(it)) as Rec;
    const oldId = clone.id;
    clone.id = nextId();
    // Give the copy its own image blobs so deleting either workspace is safe.
    for (const n of clone.notes ?? []) if (n.attachment) n.attachment = await copyAttachment(n.attachment);
    await copyExchange(oldId, clone.id);
    copies.push(clone);
  }
  const ws: WorkspaceInfo = { id: genWorkspaceId(), name: name.trim() || 'Copy' };
  registry.list.push(ws);
  try {
    localStorage.setItem(itemsKey(ws.id), JSON.stringify(copies));
  } catch {
    /* storage disabled */
  }
  save(registry);
  return ws;
}

/** Point the registry at another workspace (caller reloads the store). */
export function setActiveWorkspace(id: string): void {
  if (!registry.list.some((w) => w.id === id)) return;
  registry.active = id;
  save(registry);
}

export function renameWorkspace(id: string, name: string): void {
  const ws = registry.list.find((w) => w.id === id);
  if (!ws) return;
  ws.name = name.trim() || ws.name;
  save(registry);
}

/** Delete a workspace with its items and their stored images/exchanges.
 * Deleting the last workspace leaves a fresh empty Default. If the active
 * workspace was deleted the registry points at another one afterwards
 * (caller reloads the store). */
export function deleteWorkspace(id: string): void {
  const idx = registry.list.findIndex((w) => w.id === id);
  if (idx < 0) return;
  try {
    const raw = localStorage.getItem(itemsKey(id));
    const items = raw ? (JSON.parse(raw) as { id: string; notes?: { attachment?: string | null }[] }[]) : [];
    for (const it of items) {
      for (const n of it.notes ?? []) void deleteAttachment(n.attachment ?? null);
      void deleteExchange(it.id);
    }
    localStorage.removeItem(itemsKey(id));
  } catch {
    /* items unreadable — still drop the workspace */
  }
  registry.list.splice(idx, 1);
  if (!registry.list.length) registry.list.push({ id: genWorkspaceId(), name: 'New workspace' });
  if (registry.active === id) registry.active = registry.list[0].id;
  save(registry);
}
