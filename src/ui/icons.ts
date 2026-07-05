import bed from '../icons/bed.svg?raw';
import eye from '../icons/eye.svg?raw';
import eyeOff from '../icons/eye-off.svg?raw';
import fit from '../icons/fit.svg?raw';
import leg from '../icons/leg.svg?raw';
import trash from '../icons/trash.svg?raw';

/** Shared inline SVG icons (stroked with currentColor, so CSS can tint them —
 * emoji ignore `color`, which is why these replaced them). */
const ICONS: Record<string, string> = { leg, bed, trash, fit, eye, 'eye-off': eyeOff };

/** Raw SVG markup for an icon name (empty string if unknown) — lets code swap an
 * element's glyph at runtime (e.g. the map-visibility eye toggle). */
export function getIcon(name: string): string {
  return ICONS[name] || '';
}

/** Inject icons into every element carrying `data-icon="<name>"`. */
export function applyIcons(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-icon]').forEach((el) => {
    const svg = ICONS[el.dataset.icon || ''];
    if (svg) el.innerHTML = svg;
  });
}
