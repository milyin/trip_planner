import type { TripItem } from '../domain/types';
import { fmtDur } from '../domain/format';
import { haversine } from '../domain/geo';
import {
  endAddr, endCity, endLL, endMs, startAddr, startCity, startLL, startMs, endTimeStr, startTimeStr,
} from '../domain/item';
import { classifyGap, conflictOf, gapNights, gapRemote, listItems, planItems, planTotals } from '../domain/plan';
import { currencySymbol } from '../domain/transport';
import { emitChange, findItem, state } from '../state/store';
import { itemCard } from './cards';
import { byId, mkBtn } from './dom';
import { openHotelModal, openModal } from './modal';

/** Render the Segments panel (not-yet-planned records). */
export function renderSegments(): void {
  const rl = byId('segmentsList');
  rl.innerHTML = '';
  const list = listItems(state.items);
  byId('segmentsCount').textContent = String(list.length);
  byId('tabSegCount').textContent = String(list.length);
  if (!list.length) {
    rl.innerHTML = `<div class="empty"><span class="big">🧭</span>Nothing here.<br>Add a segment or hotel above.</div>`;
  }
  list.forEach((r) => rl.appendChild(itemCard(r, 'list')));
}

/** Render the Plan panel: planned records interleaved with generated gap rows. */
export function renderPlan(): void {
  const pl = byId('planList');
  pl.innerHTML = '';
  const plan = planItems(state.items);
  byId('planCount').textContent = String(plan.length);
  byId('tabPlanCount').textContent = String(plan.length);
  if (!plan.length) {
    pl.innerHTML = `<div class="empty"><span class="big">🧩</span>Your plan is empty.<br>In the <b>Segments</b> list, press <b>→</b> on a segment or hotel to add it here.</div>`;
  }
  let badCount = 0;
  plan.forEach((r, i) => {
    if (i > 0) {
      const prev = plan[i - 1];
      const c = classifyGap(prev, r);
      if (c.kind === 'bad') badCount++;
      const dist = haversine(endLL(prev), startLL(r));
      const g = document.createElement('div');
      g.className = 'gap ' + c.kind;
      let status = '';
      if (c.kind === 'bad') {
        const lead = c.availMin < 0 ? 'Overlaps previous item' : 'Too tight';
        const suf = r.kind === 'segment' ? ` · needs ≥ ${fmtDur(c.need * 60000)} before ${r.transport}` : '';
        status = `<span class="status">⛔ ${lead}${suf}</span>`;
      } else if (c.kind === 'long') {
        status = `<span class="status">⚠ Long layover</span>`;
      }
      g.innerHTML = `<span class="pill">⏱ <b>${fmtDur(startMs(r) - endMs(prev))}</b></span>
        <span class="pill">📏 <b>${dist != null ? Math.round(dist) + ' km' : '—'}</b></span>
        <span style="color:var(--faint)">${endCity(prev)} → ${startCity(r)}</span> ${status}`;
      if (c.kind !== 'bad') {
        const nN = gapNights(prev, r);
        const wantHotel = prev.kind !== 'hotel' && r.kind !== 'hotel' && nN >= 1; // overnight gap, no hotel yet
        const wantSeg = gapRemote(prev, r); // ends are far apart
        const acts = document.createElement('span');
        acts.className = 'gap-actions';
        if (wantHotel) {
          const b = mkBtn('🏨 Add hotel', 'gap-btn');
          b.title = `Overnight gap — ${nN} night${nN > 1 ? 's' : ''} in ${endCity(prev)}. Add a hotel to fill it.`;
          b.onclick = (e) => {
            e.stopPropagation();
            openHotelModal(null, { inPlan: true, city: endCity(prev), checkIn: endTimeStr(prev), checkOut: startTimeStr(r) });
          };
          acts.appendChild(b);
        }
        if (wantSeg) {
          const b = mkBtn('🧭 Add segment', 'gap-btn');
          b.title = `${endCity(prev)} → ${startCity(r)}${dist != null ? ` (${Math.round(dist)} km apart)` : ''}. Add a connecting segment.`;
          b.onclick = (e) => {
            e.stopPropagation();
            openModal(null, {
              inPlan: true,
              depCity: endCity(prev), depAddr: endAddr(prev), depTime: endTimeStr(prev),
              arrCity: startCity(r), arrAddr: startAddr(r), arrTime: startTimeStr(r),
            });
          };
          acts.appendChild(b);
        }
        if (acts.childNodes.length) g.appendChild(acts);
      }
      pl.appendChild(g);
    }
    pl.appendChild(itemCard(r, 'plan'));
  });
  renderPlanFoot(plan, badCount);
}

function renderPlanFoot(plan: TripItem[], badCount: number): void {
  const foot = byId('planFoot');
  if (!plan.length) {
    foot.innerHTML = `<span style="color:var(--faint)">Add segments or hotels to see totals.</span>`;
    return;
  }
  const { legs, nightsTotal, spanMs, byCurrency } = planTotals(plan);
  const totalStr = Object.entries(byCurrency)
    .map(([c, v]) => currencySymbol(c) + v.toFixed(0))
    .join(' + ');
  const span = fmtDur(spanMs);
  foot.innerHTML = `
    <div class="stat"><small>Legs</small><b>${legs}</b></div>
    ${nightsTotal ? `<div class="stat"><small>Nights</small><b>${nightsTotal}</b></div>` : ''}
    <div class="stat"><small>Total time</small><b>${span}</b></div>
    <div class="stat total"><small>Total cost</small><b>${totalStr}</b></div>
    <div class="flag ${badCount ? '' : 'ok'}">${
      badCount ? '⛔ ' + badCount + ' impossible connection' + (badCount > 1 ? 's' : '') : '✓ all connections OK'
    }</div>`;
}

/** Clear any active drop-target highlight. */
export function clearDrop(): void {
  ['segmentsList', 'planList'].forEach((id) => byId(id).classList.remove('drop', 'drop-bad'));
}

/** Wire a panel as a drop target for cross-panel drag-and-drop. */
export function setupDrop(id: string, target: 'segments' | 'plan'): void {
  const c = byId(id);
  c.addEventListener('dragover', (e) => {
    if (!state.draggedId) return;
    const r = findItem(state.draggedId);
    if (!r) return;
    e.preventDefault();
    const bad = target === 'plan' && !r.inPlan && !!conflictOf(state.items, r);
    c.classList.toggle('drop', !bad);
    c.classList.toggle('drop-bad', bad);
    if (e.dataTransfer) e.dataTransfer.dropEffect = bad ? 'none' : 'move';
  });
  c.addEventListener('dragleave', (e) => {
    if (e.target === c) clearDrop();
  });
  c.addEventListener('drop', (e) => {
    e.preventDefault();
    const r = state.draggedId ? findItem(state.draggedId) : null;
    clearDrop();
    if (!r) return;
    if (target === 'plan') {
      if (!r.inPlan && !conflictOf(state.items, r)) {
        r.inPlan = true;
        state.selected = r.id;
      }
    } else if (r.inPlan) {
      r.inPlan = false;
      state.selected = r.id;
    }
    state.draggedId = null;
    emitChange();
  });
}
