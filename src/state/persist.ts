import type { Leg, Segment } from '../domain/types';
import { seedItems } from './seed';

const KEY = 'tripPlanner.items.v1';

/** Load persisted trip items, seeding the demo data on first run. */
export function loadItems(): Segment[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return seedItems();
    const items = JSON.parse(raw) as Segment[];
    for (const it of items) {
      // Transport records were called "segments" before the rename to "leg".
      if ((it.kind as string) === 'segment') (it as { kind: string }).kind = 'leg';
      if (it.kind !== 'leg') continue;
      const leg = it as Leg & { link?: string | null };
      // Migrate from the earlier `link` field (URL or attachment reference).
      if (leg.attachment === undefined) {
        leg.attachment = leg.link?.startsWith('attachment:') ? leg.link : null;
      }
      delete leg.link;
    }
    return items;
  } catch {
    return seedItems();
  }
}

export function saveItems(items: Segment[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* quota exceeded or storage disabled — items stay in-memory */
  }
}
