import type { Hotel, Leg, Segment } from '../domain/types';
import { genNoteId } from './id';
import { seedItems } from './seed';
import { activeWorkspace, itemsKey } from './workspaces';

/** Load the active workspace's items. A missing key means a fresh install
 * (the legacy migration and explicit workspace creation both write one), so
 * only then is the demo itinerary seeded. */
export function loadItems(): Segment[] {
  try {
    const raw = localStorage.getItem(itemsKey(activeWorkspace().id));
    if (!raw) return seedItems();
    const items = JSON.parse(raw) as Segment[];
    for (const it of items) {
      // Transport records were called "segments" before the rename to "leg".
      if ((it.kind as string) === 'segment') (it as { kind: string }).kind = 'leg';
      // Migrate from the earlier `link` field (URL or attachment reference);
      // hotels lose their plain-URL links (#15 removed the Link field).
      const rec = it as (Leg | Hotel) & { link?: string | null; attachment?: string | null };
      const legacyAttachment = rec.attachment ?? (rec.link?.startsWith('attachment:') ? rec.link : null);
      delete rec.link;
      // The single `attachment` field became a `notes[]` list (#62): the old
      // ticket image becomes the first note (it came from the Recognize page).
      if (rec.notes === undefined) {
        rec.notes = legacyAttachment
          ? [{ id: genNoteId(), source: 'llm', kind: 'file', attachment: legacyAttachment, name: 'ticket', mime: '' }]
          : [];
      }
      delete rec.attachment;
      // Transfers fields arrived with #26.
      if (rec.kind === 'leg') {
        if (rec.transfers === undefined) rec.transfers = 0;
        if (rec.transfersInfo === undefined) rec.transfersInfo = '';
      }
    }
    return items;
  } catch {
    return seedItems();
  }
}

export function saveItems(items: Segment[]): void {
  try {
    localStorage.setItem(itemsKey(activeWorkspace().id), JSON.stringify(items));
  } catch {
    /* quota exceeded or storage disabled — items stay in-memory */
  }
}