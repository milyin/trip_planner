import type { TransportKind } from '../domain/types';
import { TRANSPORT_COLOR_VAR } from '../domain/transport';
import { applyTiles } from '../map/mapView';
import { saveSettings, settings } from '../state/settings';
import { emitChange } from '../state/store';
import { byId } from './dom';

/** Read a CSS custom property off `<body>` (resolves the active theme). */
export const cssv = (v: string): string => getComputedStyle(document.body).getPropertyValue(v).trim();

/** Resolved colour for a transport mode's line/icon in the current theme. */
export const transportColor = (t: TransportKind): string => cssv(TRANSPORT_COLOR_VAR[t] || '--t-other');

/** Resolved hotel accent colour. */
export const hotelColor = (): string => cssv('--t-hotel');

/** Toggle between the day and night palettes (and swap map tiles + legend colours). */
export function toggleTheme(): void {
  applyTheme(document.body.dataset.theme !== 'light' ? 'light' : 'dark');
  settings.theme = document.body.dataset.theme as 'dark' | 'light';
  saveSettings();
}

/** Set the theme (used by the toggle and by startup restore). */
export function applyTheme(theme: 'dark' | 'light'): void {
  document.body.dataset.theme = theme;
  // The menu item offers the theme you'd switch TO.
  byId('themeIcon').textContent = theme === 'light' ? '🌙' : '☀️';
  byId('themeLabel').textContent = theme === 'light' ? 'Night theme' : 'Day theme';
  applyTiles();
  emitChange();
}
