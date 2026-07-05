import { fitAll } from '../map/mapView';
import { byId } from './dom';
import { openHotelModal, openModal } from './modal';
import { toggleTheme } from './theme';

/** Close the ☰ dropdown menu. */
export function closeMenus(): void {
  byId('hamMenu').classList.remove('open');
  byId('hamBtn').setAttribute('aria-expanded', 'false');
}

/** Wire the top bar (☰ menu) and the Map panel's Fit button. */
export function wireTopbar(): void {
  const btn = byId('hamBtn');
  const menu = byId('hamMenu');
  btn.onclick = (e) => {
    e.stopPropagation();
    const open = !menu.classList.contains('open');
    menu.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  // Every menu item closes the menu; the item actions themselves are wired
  // here or elsewhere (preview in tabbar.ts, settings in parserSettings.ts).
  menu.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', closeMenus);
  });
  byId('addLegBtn').addEventListener('click', () => openModal(null));
  byId('addHotelBtn').addEventListener('click', () => openHotelModal(null));
  byId('themeBtn').addEventListener('click', toggleTheme);
  document.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('.menu-wrap')) closeMenus();
  });
  byId('fitBtn').onclick = fitAll;
}
