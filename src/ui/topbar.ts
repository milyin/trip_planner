import { pickTicketFile } from '../import/importFlow';
import { fitAll } from '../map/mapView';
import { byId } from './dom';
import { openHotelModal, openModal } from './modal';
import { toggleTheme } from './theme';

/** Close the ＋ Add dropdown menu. */
export function closeAddMenu(): void {
  byId('addMenu').classList.remove('open');
  byId('addBtn').setAttribute('aria-expanded', 'false');
}

/** Wire the top bar (＋ Add menu, theme toggle) and the Map panel's Fit button. */
export function wireTopbar(): void {
  const addBtn = byId('addBtn');
  const addMenu = byId('addMenu');
  addBtn.onclick = (e) => {
    e.stopPropagation();
    const open = !addMenu.classList.contains('open');
    addMenu.classList.toggle('open', open);
    addBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  addMenu.querySelectorAll('button').forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      closeAddMenu();
      if (b.dataset.add === 'hotel') openHotelModal(null);
      else if (b.dataset.add === 'import') pickTicketFile();
      else openModal(null);
    };
  });
  document.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('.menu-wrap')) closeAddMenu();
  });
  byId('themeBtn').onclick = toggleTheme;
  byId('fitBtn').onclick = fitAll;
}
