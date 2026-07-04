import { emitChange, select, state } from '../state/store';
import { closeModal } from './modal';
import { closeMenus } from './topbar';

/**
 * Global handlers: Escape closes overlays; a click outside any card (and outside
 * the map / modal / buttons) clears the selection. The map is tested by screen
 * geometry rather than `closest('#map')` because clicking a segment re-renders
 * the map and detaches the clicked SVG path, so `closest('#map')` would be null.
 */
export function wireGlobal(): void {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModal();
      closeMenus();
    }
  });
  document.addEventListener('click', (e) => {
    const mapEl = document.getElementById('map');
    let inMap = false;
    if (mapEl) {
      const b = mapEl.getBoundingClientRect();
      inMap = e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom;
    }
    const t = e.target as HTMLElement;
    if (inMap || t.closest('.card') || t.closest('.overlay') || t.closest('button')) return;
    if (state.selected !== null) {
      select(null);
      emitChange();
    }
  });
}
