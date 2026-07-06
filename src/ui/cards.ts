import type { Hotel, Leg, Segment } from '../domain/types';
import { esc, fmtTime, fmtTimeParts, money, tripDur } from '../domain/format';
import { nights } from '../domain/item';
import { conflictOf } from '../domain/plan';
import { TRANSPORT_ICON } from '../domain/transport';
import { addToPlan, emitChange, removeFromPlan, select, state } from '../state/store';
import { mkBtn } from './dom';
import { openHotelModal, openModal } from './modal';
import { clearDrop } from './panels';
import { selectAndShowOnMap } from './selection';
import { hotelColor, transportColor } from './theme';

export type CardMode = 'list' | 'plan';

/** Date and time as separate spans so a narrow (mobile) cell can wrap the time
 * onto its own line under the date instead of trimming it (#43). */
const timeHtml = (s: string): string => {
  const { date, time } = fmtTimeParts(s);
  return `<span class="td">${esc(date)}</span> <span class="tc">${esc(time)}</span>`;
};

/** Build the card element for any record. */
export const itemCard = (r: Segment, mode: CardMode): HTMLDivElement =>
  r.kind === 'hotel' ? hotelCard(r, mode) : legCard(r, mode);

const openEditor = (r: Segment): void => (r.kind === 'hotel' ? openHotelModal(r.id) : openModal(r.id));

/** Populate a card's bottom-right action pill (send/remove + edit). */
function cardActions(el: HTMLElement, r: Segment, mode: CardMode): void {
  const a = el.querySelector('.card-actions');
  if (!a) return;
  if (mode === 'list') {
    const conflict = r.kind === 'leg' ? conflictOf(state.items, r) : null;
    const disabled = !!conflict;
    const add = mkBtn(disabled ? '⊘' : '→', 'btn icon ' + (disabled ? '' : 'primary'));
    add.title = disabled ? "Overlaps plan — can't add" : 'Add to plan';
    add.disabled = disabled;
    add.onclick = (e) => {
      e.stopPropagation();
      addToPlan(r.id);
      emitChange();
    };
    a.appendChild(add);
  } else {
    const rm = mkBtn('↩', 'btn icon');
    rm.title = 'Remove from plan';
    rm.onclick = (e) => {
      e.stopPropagation();
      removeFromPlan(r.id);
      emitChange();
    };
    a.appendChild(rm);
  }
  const ed = mkBtn('✎', 'btn icon ghost');
  ed.title = 'Edit';
  ed.onclick = (e) => {
    e.stopPropagation();
    openEditor(r);
  };
  a.appendChild(ed);
}

/** Wire select / edit / drag interactions shared by every card. */
function makeDraggable(el: HTMLElement, r: Segment): void {
  el.onclick = () => {
    select(r.id);
    emitChange();
  };
  el.ondblclick = (e) => {
    e.stopPropagation();
    openEditor(r);
  };
  el.draggable = true;
  el.addEventListener('dragstart', (e) => {
    state.draggedId = r.id;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      try {
        e.dataTransfer.setData('text/plain', r.id);
      } catch { /* some browsers restrict setData */ }
    }
    requestAnimationFrame(() => el.classList.add('dragging'));
  });
  el.addEventListener('dragend', () => {
    el.classList.remove('dragging');
    clearDrop();
    state.draggedId = null;
  });
}

function legCard(r: Leg, mode: CardMode): HTMLDivElement {
  const conflict = mode === 'list' ? conflictOf(state.items, r) : null;
  const disabled = !!conflict;
  const col = transportColor(r.transport);
  const el = document.createElement('div');
  el.className =
    'card ' + (mode === 'plan' ? 'plan ' : '') + (disabled ? 'disabled ' : '') + (state.selected === r.id ? 'sel' : '');
  el.innerHTML = `
    <div class="stripe" style="background:${col}"></div>
    <div class="leg-grid">
      <div class="leg-city c1 r1" title="${esc(r.dep.city)}">${r.dep.city}</div>
      <div class="leg-tr c2 r1" title="${esc(r.transport + (r.company ? ' · ' + r.company : ''))}"><span class="ti" style="color:${col}">${TRANSPORT_ICON[r.transport] || '•'}</span> <span class="co">${r.company || r.transport}</span></div>
      <div class="leg-city c3 r1" title="${esc(r.arr.city)}">${r.arr.city}</div>
      <div class="leg-sub c1 r2" title="${esc(r.dep.addr)}">${r.dep.addr || '—'}</div>
      <div class="card-cost c2 r2" title="Fare">${money(r)}</div>
      <div class="leg-sub c3 r2" title="${esc(r.arr.addr)}">${r.arr.addr || '—'}</div>
      <div class="leg-sub leg-time c1 r3" title="${esc(fmtTime(r.dep.time))}">${timeHtml(r.dep.time)}</div>
      <div class="leg-sub c2 r3" title="${esc(r.transfersInfo || '')}">${tripDur(r)}${r.transfers > 0 ? ` · ${r.transfers}⇄` : ''}</div>
      <div class="leg-sub leg-time c3 r3" title="${esc(fmtTime(r.arr.time))}">${timeHtml(r.arr.time)}</div>
    </div>
    ${disabled ? `<div class="warn">⚠ Overlaps plan: ${conflict!.dep.city} → ${conflict!.arr.city}</div>` : ''}
    <div class="card-actions"></div>`;
  el.title =
    `${r.dep.city} → ${r.arr.city}  ·  ${r.transport}${r.company ? ' · ' + r.company : ''}  ·  ${money(r)}  ·  ⏱ ${tripDur(r)}\n` +
    (r.transfers > 0 ? `Transfers: ${r.transfers}${r.transfersInfo ? ' — ' + r.transfersInfo : ''}\n` : '') +
    `Depart: ${fmtTime(r.dep.time)} — ${r.dep.city}, ${r.dep.addr}\n` +
    `Arrive: ${fmtTime(r.arr.time)} — ${r.arr.city}, ${r.arr.addr}\n` +
    `(Click to select · double-click to edit · drag to move)`;
  cardActions(el, r, mode);
  makeDraggable(el, r);
  const trEl = el.querySelector<HTMLElement>('.leg-tr');
  if (trEl) {
    trEl.title = 'Show on map';
    trEl.addEventListener('click', (e) => {
      if (!document.body.classList.contains('mobile')) return; // desktop: bubble up → normal select
      e.stopPropagation();
      selectAndShowOnMap(r);
    });
  }
  return el;
}

function hotelCard(r: Hotel, mode: CardMode): HTMLDivElement {
  const col = hotelColor();
  const n = nights(r);
  const el = document.createElement('div');
  el.className = 'card hotel ' + (mode === 'plan' ? 'plan ' : '') + (state.selected === r.id ? 'sel' : '');
  el.innerHTML = `
    <div class="stripe" style="background:${col}"></div>
    <div class="hotel-grid">
      <div class="hotel-name hc1 hr1"><span class="ti" style="color:${col}">🏨</span><span class="nm" title="${esc(r.name)}">${r.name || 'Hotel'}</span></div>
      <div class="card-cost hc2 hr1" title="Price">${money(r)}</div>
      <div class="hotel-loc hc1 hr2" title="${esc(r.city + (r.addr ? ' · ' + r.addr : ''))}">${r.city}${r.addr ? ' · ' + r.addr : ''}</div>
      <div class="hc2 hr2"></div>
      <div class="hotel-dates hc1 hr3" title="${esc(fmtTime(r.checkIn) + ' → ' + fmtTime(r.checkOut))}">${timeHtml(r.checkIn)} → ${timeHtml(r.checkOut)}</div>
      <div class="hotel-nights hc2 hr3">${n} night${n > 1 ? 's' : ''}</div>
    </div>
    <div class="card-actions"></div>`;
  el.title =
    `🏨 ${r.name} — ${r.city}${r.addr ? ', ' + r.addr : ''}  ·  ${money(r)}  ·  ${n} night${n > 1 ? 's' : ''}\n` +
    `Check-in:  ${fmtTime(r.checkIn)}\n` +
    `Check-out: ${fmtTime(r.checkOut)}\n` +
    `(Click to select · double-click to edit · drag to move)`;
  cardActions(el, r, mode);
  makeDraggable(el, r);
  return el;
}
