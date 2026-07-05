/** Named workspaces: each holds its own set of segments under its own
 * localStorage key; settings, theme and the geocode cache stay global. */

import { deleteAttachment, deleteExchange } from './attachments';

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
    const items = raw ? (JSON.parse(raw) as { id: string; attachment?: string | null }[]) : [];
    for (const it of items) {
      void deleteAttachment(it.attachment ?? null);
      void deleteExchange(it.id);
    }
    localStorage.removeItem(itemsKey(id));
  } catch {
    /* items unreadable — still drop the workspace */
  }
  registry.list.splice(idx, 1);
  if (!registry.list.length) registry.list.push({ id: genWorkspaceId(), name: 'Default' });
  if (registry.active === id) registry.active = registry.list[0].id;
  save(registry);
}
