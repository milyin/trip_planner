import { fitAll } from '../map/mapView';
import { clearAllStored } from '../state/attachments';
import { emitChange, state } from '../state/store';
import { byId } from './dom';
import { openHotelModal, openModal } from './modal';
import { toggleTheme } from './theme';

/** Close the ＋ Add and ☰ dropdown menus. */
export function closeAddMenu(): void {
  for (const [btn, menu] of [['addBtn', 'addMenu'], ['hamBtn', 'hamMenu']] as const) {
    byId(menu).classList.remove('open');
    byId(btn).setAttribute('aria-expanded', 'false');
  }
}

function wireMenu(btnId: string, menuId: string): void {
  const btn = byId(btnId);
  const menu = byId(menuId);
  btn.onclick = (e) => {
    e.stopPropagation();
    const open = !menu.classList.contains('open');
    closeAddMenu(); // at most one menu open at a time
    menu.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
}

function clearAll(): void {
  if (!confirm('Remove ALL segments and hotels (including stored images)? This cannot be undone.')) return;
  state.items = [];
  state.selected = null;
  void clearAllStored();
  emitChange();
}

/** Wire the top bar (＋ Add and ☰ menus) and the Map panel's Fit button. */
export function wireTopbar(): void {
  wireMenu('addBtn', 'addMenu');
  wireMenu('hamBtn', 'hamMenu');
  byId('addMenu').querySelectorAll('button').forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      closeAddMenu();
      if (b.dataset.add === 'hotel') openHotelModal(null);
      else openModal(null);
    };
  });
  // Hamburger items: close the menu, then act (preview/settings wire their
  // own onclick elsewhere — attach via listeners so we don't clobber them).
  byId('hamMenu').querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', closeAddMenu);
  });
  byId('themeBtn').addEventListener('click', toggleTheme);
  byId('clearBtn').addEventListener('click', clearAll);
  document.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('.menu-wrap')) closeAddMenu();
  });
  byId('fitBtn').onclick = fitAll;
}
