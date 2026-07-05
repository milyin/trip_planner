import bed from '../icons/bed.svg?raw';
import fit from '../icons/fit.svg?raw';
import leg from '../icons/leg.svg?raw';
import trash from '../icons/trash.svg?raw';

/** Shared inline SVG icons (stroked with currentColor, so CSS can tint them —
 * emoji ignore `color`, which is why these replaced them). */
const ICONS: Record<string, string> = { leg, bed, trash, fit };

/** Inject icons into every element carrying `data-icon="<name>"`. */
export function applyIcons(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-icon]').forEach((el) => {
    const svg = ICONS[el.dataset.icon || ''];
    if (svg) el.innerHTML = svg;
  });
}
