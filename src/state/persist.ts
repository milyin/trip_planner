import type { Segment, TripItem } from '../domain/types';
import { seedItems } from './seed';

const KEY = 'tripPlanner.items.v1';

/** Load persisted trip items, seeding the demo data on first run. */
export function loadItems(): TripItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return seedItems();
    const items = JSON.parse(raw) as TripItem[];
    // Items saved before the segment `link` field existed lack it.
    for (const it of items) {
      if (it.kind === 'segment' && (it as Segment).link === undefined) (it as Segment).link = null;
    }
    return items;
  } catch {
    return seedItems();
  }
}

export function saveItems(items: TripItem[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* quota exceeded or storage disabled — items stay in-memory */
  }
}
