import L from 'leaflet';
import type { LatLng, TransportKind } from '../domain/types';
import { money, tripDur } from '../domain/format';
import { nights } from '../domain/item';
import { conflictOf } from '../domain/plan';
import { TRANSPORT_KINDS } from '../domain/transport';
import { emitChange, select, state } from '../state/store';
import { cssv, transportColor } from '../ui/theme';
import { selectFromMap } from '../ui/selection';

let map: L.Map;
let segmentLayer: L.LayerGroup;
let darkTiles: L.TileLayer;
let lightTiles: L.TileLayer;
let initialFit = true;
let mobileFitted = false;

const SVGNS = 'http://www.w3.org/2000/svg';

/** The overlay-pane <svg>'s <defs> (created on first use), or null if not ready yet. */
function overlayDefs(): SVGDefsElement | null {
  const svg = document.querySelector<SVGSVGElement>('.leaflet-overlay-pane svg');
  if (!svg) return null;
  let defs = svg.querySelector('defs');
  if (!defs) {
    defs = document.createElementNS(SVGNS, 'defs');
    svg.insertBefore(defs, svg.firstChild);
  }
  return defs as SVGDefsElement;
}

/** Remove arrowhead marker defs left over from the previous draw. */
function clearArrowDefs(): void {
  document.querySelectorAll('.leaflet-overlay-pane svg defs marker.tp-arrow').forEach((m) => m.remove());
}

/**
 * Id of an SVG arrowhead marker filled with `color`, created on demand and cached
 * in `reg` for this draw. Applied to a segment line via `marker-end`, so it sits at
 * the arrival end, points along the direction of travel, and re-renders on zoom/pan.
 */
function arrowMarker(color: string, reg: Map<string, string>): string | null {
  const cached = reg.get(color);
  if (cached) return cached;
  const defs = overlayDefs();
  if (!defs) return null;
  const id = 'tp-arrow-' + reg.size;
  const marker = document.createElementNS(SVGNS, 'marker');
  marker.setAttribute('id', id);
  marker.setAttribute('class', 'tp-arrow');
  marker.setAttribute('viewBox', '0 0 10 10');
  marker.setAttribute('refX', '7');
  marker.setAttribute('refY', '5');
  marker.setAttribute('markerWidth', '10');
  marker.setAttribute('markerHeight', '10');
  marker.setAttribute('markerUnits', 'userSpaceOnUse');
  marker.setAttribute('orient', 'auto');
  const tip = document.createElementNS(SVGNS, 'path');
  tip.setAttribute('d', 'M0.5,1 L9,5 L0.5,9 Z');
  tip.setAttribute('fill', color);
  marker.appendChild(tip);
  defs.appendChild(marker);
  reg.set(color, id);
  return id;
}

/** Create the Leaflet map, tile layers, and global map interactions. */
export function initMap(): void {
  map = L.map('map', { worldCopyJump: true, minZoom: 2, zoomControl: true }).setView([45, 6], 5);
  darkTiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    subdomains: 'abcd', maxZoom: 19, attribution: '© OpenStreetMap · © CARTO',
  });
  lightTiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    subdomains: 'abcd', maxZoom: 19, attribution: '© OpenStreetMap · © CARTO',
  });
  segmentLayer = L.layerGroup().addTo(map);
  applyTiles();
  map.on('moveend zoomend', () => placeLegend());
  map.on('click', () => {
    if (state.selected !== null) {
      select(null);
      emitChange();
    }
  });
  window.addEventListener('resize', () => {
    map.invalidateSize();
    placeLegend();
  });
}

/** Swap the tile layer to match the active theme. */
export function applyTiles(): void {
  const light = document.body.dataset.theme === 'light';
  map.removeLayer(light ? darkTiles : lightTiles);
  (light ? lightTiles : darkTiles).addTo(map);
}

/** Redraw all segment/hotel geometry from current state. */
export function drawMap(): void {
  segmentLayer.clearLayers();
  clearArrowDefs();
  const bounds: LatLng[] = [];
  const halo = cssv('--halo');
  const accent = cssv('--accent');
  const danger = cssv('--danger');
  // uniform transparent click/hover width so thin dashed legs are as easy to grab as thick ones
  const HITW = 14;
  const usedTransports = new Set<TransportKind>();
  const arrowReg = new Map<string, string>();

  state.items.forEach((r) => {
    if (r.kind === 'hotel') {
      if (!r.ll) return;
      const isSel = state.selected === r.id;
      const cls = 'hotel-pin' + (r.inPlan ? ' plan' : '') + (isSel ? ' sel' : '');
      const m = L.marker(r.ll, {
        icon: L.divIcon({ html: '🏨', className: cls, iconSize: [26, 26], iconAnchor: [13, 13] }),
        opacity: r.inPlan ? 1 : 0.65,
        zIndexOffset: r.inPlan ? 600 : 300,
      }).addTo(segmentLayer);
      m.bindTooltip(
        `🏨 ${r.name}<br><small>${r.city} · ${money(r)} · ${nights(r)} night${nights(r) > 1 ? 's' : ''}</small>`,
        { className: 'segment-tip', direction: 'top' },
      );
      m.on('click', () => selectFromMap(r));
      bounds.push(r.ll);
      return;
    }

    if (!r.dep.ll || !r.arr.ll) return;
    const col = transportColor(r.transport);
    const conflict = conflictOf(state.items, r);
    const isSel = state.selected === r.id;
    if (conflict && !isSel) return; // overlapped: not drawn unless selected

    let weight: number;
    let opacity: number;
    let dash: string | null = null;
    let lineCol = col;
    if (r.inPlan) {
      weight = 6;
      opacity = 1;
    } else if (conflict) {
      weight = 3;
      opacity = 0.9;
      lineCol = danger;
      dash = '6 8';
    } else {
      weight = 3;
      opacity = 0.7;
      dash = '6 8';
    }
    const selHi = isSel && !conflict; // selected, non-conflicting → highlight
    if (selHi) dash = null; // solid so the accent border reads cleanly
    const mainW = selHi ? weight + 1 : weight; // don't thicken conflicting legs
    const line: LatLng[] = [r.dep.ll, r.arr.ll];

    if (selHi) {
      // selection casing: accent border + neutral separator ring (keeps the border
      // visible even when the leg's own colour IS the accent, e.g. Plane) + soft glow —
      // mirrors the accent border/halo of a selected hotel pin (.hotel-pin.sel)
      L.polyline(line, { color: accent, weight: mainW + 12, opacity: 0.28, interactive: false, lineCap: 'round' }).addTo(segmentLayer);
      L.polyline(line, { color: accent, weight: mainW + 7, opacity: 1, interactive: false, lineCap: 'round' }).addTo(segmentLayer);
      L.polyline(line, { color: halo, weight: mainW + 3, opacity: 1, interactive: false, lineCap: 'round' }).addTo(segmentLayer);
    } else if (r.inPlan) {
      // decorative glow: never captures clicks
      L.polyline(line, { color: halo, weight: weight + 4, opacity: 0.6, interactive: false }).addTo(segmentLayer);
    }
    // visible line is decorative; a fat transparent "hit line" on top carries click + hover
    const visible = L.polyline(line, { color: lineCol, weight: mainW, opacity, dashArray: dash ?? undefined, interactive: false }).addTo(segmentLayer);
    if (lineCol === col) usedTransports.add(r.transport); // legend lists only transports whose colour is on the map
    const arrowId = arrowMarker(lineCol, arrowReg);
    const vpath = (visible as unknown as { getElement(): SVGPathElement | null }).getElement();
    if (vpath && arrowId) vpath.setAttribute('marker-end', `url(#${arrowId})`);
    const tip = conflict ? `<br><small style="color:${danger}">⚠ overlaps plan</small>` : '';
    // bubblingMouseEvents:false → clicking selects without firing the map's "click empty → unselect"
    const hit = L.polyline(line, { color: '#000', opacity: 0, weight: HITW, lineCap: 'round', bubblingMouseEvents: false }).addTo(segmentLayer);
    hit.bindTooltip(
      `${r.dep.city} → ${r.arr.city}<br><small>${r.transport} · ${money(r)} · ⏱ ${tripDur(r)}</small>${tip}`,
      { className: 'segment-tip', sticky: true },
    );
    hit.on('click', () => selectFromMap(r));

    // endpoints contribute to map bounds; only the departure gets a dot —
    // the arrival end is marked by the arrowhead so the leg reads directionally
    [r.dep, r.arr].forEach((p) => { if (p.ll) bounds.push(p.ll); });
    if (r.dep.ll) {
      L.circleMarker(r.dep.ll, {
        radius: r.inPlan ? 6 : 4, color: halo, weight: 2,
        fillColor: isSel ? (conflict ? danger : accent) : col, fillOpacity: 1, bubblingMouseEvents: false,
      })
        .bindTooltip(r.dep.city, { className: 'place-tip', direction: 'top' })
        .on('click', () => selectFromMap(r))
        .addTo(segmentLayer);
    }
  });

  if (initialFit && bounds.length) {
    map.fitBounds(L.latLngBounds(bounds), { padding: [50, 50], maxZoom: 6 });
    initialFit = false;
  }
  buildLegend(usedTransports);
  placeLegend();
}

/** Place the legend in whichever map corner is least covered by drawn segments. */
export function placeLegend(): void {
  const leg = document.querySelector<HTMLElement>('.map-legend');
  const wrap = document.querySelector<HTMLElement>('.map-wrap');
  if (!leg || !wrap) return;
  const W = wrap.clientWidth;
  const H = wrap.clientHeight;
  const lw = leg.offsetWidth;
  const lh = leg.offsetHeight;
  const m = 14;
  if (!W || !H || !lw) return;
  const corners: Record<string, { left: number; top: number }> = {
    bl: { left: m, top: H - lh - m },
    br: { left: W - lw - m, top: H - lh - m },
    tl: { left: m, top: m },
    tr: { left: W - lw - m, top: m },
  };
  const pts: Array<[number, number]> = [];
  state.items.forEach((r) => {
    if (r.kind === 'hotel') {
      if (!r.ll) return;
      try {
        const p = map.latLngToContainerPoint(r.ll);
        pts.push([p.x, p.y]);
      } catch { /* map not ready */ }
      return;
    }
    if (!r.dep.ll || !r.arr.ll) return;
    const conflict = conflictOf(state.items, r);
    const isSel = state.selected === r.id;
    if (conflict && !isSel) return; // only sample drawn segments
    let a: L.Point;
    let b: L.Point;
    try {
      a = map.latLngToContainerPoint(r.dep.ll);
      b = map.latLngToContainerPoint(r.arr.ll);
    } catch {
      return;
    }
    for (let t = 0; t <= 1.0001; t += 0.06) pts.push([a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t]);
  });
  const cover = (c: { left: number; top: number }): number => {
    const x0 = c.left - 8;
    const y0 = c.top - 8;
    const x1 = c.left + lw + 8;
    const y1 = c.top + lh + 8;
    let n = 0;
    for (const p of pts) if (p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1) n++;
    return n;
  };
  let best = 'bl';
  let bn = Infinity;
  for (const k of ['bl', 'br', 'tl', 'tr']) {
    const n = cover(corners[k]);
    if (n < bn) {
      bn = n;
      best = k;
    }
  }
  const c = corners[best];
  leg.style.left = Math.max(m, c.left) + 'px';
  leg.style.top = Math.max(m, c.top) + 'px';
  leg.style.right = 'auto';
  leg.style.bottom = 'auto';
  leg.dataset.corner = best;
}

/** Build the transport colour legend — only modes whose colour is currently on the map. */
export function buildLegend(used: Set<TransportKind>): void {
  const el = document.getElementById('legTransport');
  if (!el) return;
  const kinds = TRANSPORT_KINDS.filter((t) => used.has(t));
  el.innerHTML = kinds
    .map((t) => `<div class="lrow"><span class="lg-line" style="border-top-color:${transportColor(t)}"></span> ${t}</div>`)
    .join('');
  const col = el.closest('.legcol') as HTMLElement | null;
  if (col) col.style.display = kinds.length ? '' : 'none'; // hide the whole column when nothing is drawn
}

/** Zoom/pan to fit every geocoded record. */
export function fitAll(): void {
  const b: LatLng[] = [];
  state.items.forEach((r) => {
    if (r.kind === 'hotel') {
      if (r.ll) b.push(r.ll);
      return;
    }
    if (r.dep.ll) b.push(r.dep.ll);
    if (r.arr.ll) b.push(r.arr.ll);
  });
  if (b.length) map.fitBounds(L.latLngBounds(b), { padding: [50, 50], maxZoom: 6 });
}

/** Recompute map size + legend (after a resize or layout change). */
export function refreshMap(): void {
  map.invalidateSize();
  placeLegend();
}

/** Pan the map to a coordinate (used when revealing a record from a card). */
export function panMapTo(ll: LatLng): void {
  map.panTo(ll, { animate: true });
}

/** Called when the mobile Map tab becomes visible: resize, first-time fit, legend. */
export function onMapTabShown(): void {
  map.invalidateSize();
  if (!mobileFitted) {
    fitAll();
    mobileFitted = true;
  }
  placeLegend();
}
