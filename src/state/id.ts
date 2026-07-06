/** Collision-proof id for new records. The previous session counter ('r1',
 * 'r2', …) restarted on every page load while stored records kept their old
 * ids — upsertItem then silently REPLACED old records with new ones. The
 * timestamp+random shape matches attachment and workspace ids. */
export const nextId = (): string =>
  'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/** Collision-proof id for a note/attachment entry within a segment. */
export const genNoteId = (): string =>
  'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
