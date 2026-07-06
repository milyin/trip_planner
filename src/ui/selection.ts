import type { LatLng, Segment } from '../domain/types';
import { panMapTo } from '../map/mapView';
import { emitChange, select, state } from '../state/store';
import { setTab } from './tabbar';

/** Scroll the currently selected card into view within its panel. */
export function scrollSelectedIntoView(): void {
  if (state.selected == null) return;
  const el = document.querySelector('.card.sel');
  if (el) el.scrollIntoView({ block: 'nearest' });
}

/**
 * Select a record from a map interaction. On mobile also jump to the tab that
 * holds it (Plan if planned, else Segments) and scroll it into view. The tab
 * switch is deferred one tick so the global "click outside" handler still sees
 * the map under the tap and keeps the fresh selection.
 */
export function selectFromMap(r: Segment): void {
  select(r.id);
  emitChange();
  if (document.body.classList.contains('mobile')) {
    const tab = r.inPlan ? 'plan' : 'segmentsPool';
    setTimeout(() => {
      setTab(tab);
      scrollSelectedIntoView();
    }, 0);
  } else {
    // Desktop: both lists are visible, but the selected card may be scrolled
    // off in a long list — bring it into view (emitChange re-rendered it).
    scrollSelectedIntoView();
  }
}

/**
 * Select a record and reveal it on the Map tab, centring the map on it — the
 * inverse of {@link selectFromMap}, triggered by tapping a card's transport chip.
 */
export function selectAndShowOnMap(r: Segment): void {
  select(r.id);
  emitChange();
  setTab('map');
  setTimeout(() => {
    let ll: LatLng | null = null;
    if (r.kind === 'hotel') ll = r.ll;
    else if (r.dep.ll && r.arr.ll) ll = [(r.dep.ll[0] + r.arr.ll[0]) / 2, (r.dep.ll[1] + r.arr.ll[1]) / 2];
    else if (r.dep.ll) ll = r.dep.ll;
    if (ll) panMapTo(ll);
  }, 90);
}
