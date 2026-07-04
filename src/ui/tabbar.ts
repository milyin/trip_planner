import { onMapTabShown, refreshMap } from '../map/mapView';
import { byId } from './dom';

export type TabName = 'segments' | 'plan' | 'map';

let previewMobile = false;
const mqMobile = window.matchMedia('(max-width:640px)');

/** Show a single panel (mobile) and highlight its tab-bar button. */
export function setTab(t: TabName): void {
  document.body.dataset.tab = t;
  document.querySelectorAll<HTMLElement>('#tabbar button').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === t);
  });
  if (t === 'map') setTimeout(onMapTabShown, 60);
}

/**
 * Apply the mobile layout when the viewport is narrow OR the desktop preview
 * toggle is on. All mobile styling is gated behind `body.mobile`, so the
 * desktop three-panel layout is never touched.
 */
export function syncMode(): void {
  const mobile = mqMobile.matches || previewMobile;
  document.body.classList.toggle('mobile', mobile);
  document.body.classList.toggle('preview-frame', previewMobile);
  setTimeout(refreshMap, 60);
}

/** Wire the bottom tab bar buttons, the 📱 preview toggle, and the media query. */
export function wireTabbar(): void {
  document.querySelectorAll<HTMLElement>('#tabbar button').forEach((b) => {
    b.onclick = () => setTab(b.dataset.tab as TabName);
  });
  const previewBtn = byId('previewBtn');
  previewBtn.onclick = () => {
    previewMobile = !previewMobile;
    previewBtn.classList.toggle('primary', previewMobile);
    syncMode();
  };
  mqMobile.addEventListener('change', syncMode);
}
