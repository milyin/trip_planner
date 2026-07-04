import type { TransportKind } from '../domain/types';
import { TRANSPORT_COLOR_VAR } from '../domain/transport';
import { applyTiles, buildLegend } from '../map/mapView';
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
  const light = document.body.dataset.theme !== 'light';
  document.body.dataset.theme = light ? 'light' : 'dark';
  byId('themeBtn').textContent = light ? '☀️' : '🌙';
  applyTiles();
  buildLegend();
  emitChange();
}
