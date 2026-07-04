import type { TripItem } from '../domain/types';
import { loadItems, saveItems } from './persist';

/** Mutable application state. UI reads this directly and re-renders on change. */
export interface AppState {
  items: TripItem[];
  /** Currently selected record id, or `null`. */
  selected: string | null;
  /** Id of the card being dragged (cross-panel drag-and-drop), or `null`. */
  draggedId: string | null;
}

export const state: AppState = {
  items: loadItems(),
  selected: null,
  draggedId: null,
};

type Listener = () => void;
const listeners: Listener[] = [];

/** Register a render callback invoked on every `emitChange()`. */
export const subscribe = (fn: Listener): void => {
  listeners.push(fn);
};

/** Notify subscribers that state changed (synchronous, mirrors the prototype's `render()`).
 * Also persists the items — every mutation goes through here. */
export const emitChange = (): void => {
  saveItems(state.items);
  for (const fn of listeners) fn();
};

export const select = (id: string | null): void => {
  state.selected = id;
};

export const findItem = (id: string): TripItem | undefined => state.items.find((x) => x.id === id);

export function addToPlan(id: string): void {
  const r = findItem(id);
  if (r) {
    r.inPlan = true;
    state.selected = id;
  }
}

export function removeFromPlan(id: string): void {
  const r = findItem(id);
  if (r) {
    r.inPlan = false;
    state.selected = id;
  }
}

/** Insert a new record or replace an existing one with the same id. */
export function upsertItem(item: TripItem): void {
  const i = state.items.findIndex((x) => x.id === item.id);
  if (i >= 0) state.items[i] = item;
  else state.items.push(item);
  state.selected = item.id;
}

export function deleteItemById(id: string): void {
  state.items = state.items.filter((x) => x.id !== id);
  state.selected = null;
}
