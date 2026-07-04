import type { CurrencyCode, Hotel, Segment, TransportKind } from '../domain/types';
import { geocode } from '../domain/geo';
import { fmtDur } from '../domain/format';
import { bufferMin } from '../domain/transport';
import { deleteItemById, emitChange, findItem, upsertItem } from '../state/store';
import { nextId } from '../state/id';
import { byId, getVal, setVal } from './dom';

export interface SegmentPrefill {
  inPlan?: boolean;
  depCity?: string; depAddr?: string; depTime?: string;
  arrCity?: string; arrAddr?: string; arrTime?: string;
  transport?: TransportKind; company?: string; cost?: number; currency?: CurrencyCode;
}

export interface HotelPrefill {
  inPlan?: boolean;
  name?: string; city?: string; addr?: string;
  checkIn?: string; checkOut?: string; cost?: number; currency?: CurrencyCode; link?: string;
}

let editingId: string | null = null;
let editKind: 'segment' | 'hotel' = 'segment';
let newInPlan = false;

function showBody(kind: 'segment' | 'hotel'): void {
  editKind = kind;
  byId('segBody').style.display = kind === 'segment' ? 'grid' : 'none';
  byId('hotelBody').style.display = kind === 'hotel' ? 'grid' : 'none';
  byId('saveBtn').textContent = kind === 'hotel' ? 'Save hotel' : 'Save segment';
}

function bufHint(): void {
  const t = getVal('fTransport') as TransportKind;
  byId('bufHint').textContent = `Needs ≥ ${fmtDur(bufferMin(t) * 60000)} to connect before this leg`;
}

/** Open the segment dialog (new when `id` is null), optionally pre-filled. */
export function openModal(id: string | null, prefill?: SegmentPrefill): void {
  editingId = id || null;
  showBody('segment');
  const P = prefill || {};
  newInPlan = P.inPlan === true;
  byId('modalTitle').textContent = id ? 'Edit segment' : 'New segment';
  byId('delBtn').style.display = id ? 'inline-flex' : 'none';
  const r = (id ? findItem(id) : null) as Segment | null;
  setVal('fDepCity', r ? r.dep.city : P.depCity ?? '');
  setVal('fDepAddr', r ? r.dep.addr : P.depAddr ?? '');
  setVal('fDepTime', r ? r.dep.time : P.depTime ?? '2026-05-01T12:00');
  setVal('fArrCity', r ? r.arr.city : P.arrCity ?? '');
  setVal('fArrAddr', r ? r.arr.addr : P.arrAddr ?? '');
  setVal('fArrTime', r ? r.arr.time : P.arrTime ?? '2026-05-01T14:00');
  setVal('fTransport', r ? r.transport : P.transport ?? 'Plane');
  setVal('fCompany', r ? r.company : P.company ?? '');
  setVal('fCost', r ? r.cost : P.cost ?? '');
  setVal('fCur', r ? r.currency : P.currency ?? 'EUR');
  bufHint();
  byId('overlay').classList.add('open');
}

/** Open the hotel dialog (new when `id` is null), optionally pre-filled. */
export function openHotelModal(id: string | null, prefill?: HotelPrefill): void {
  editingId = id || null;
  showBody('hotel');
  const P = prefill || {};
  newInPlan = P.inPlan === true;
  byId('modalTitle').textContent = id ? 'Edit hotel' : 'New hotel';
  byId('delBtn').style.display = id ? 'inline-flex' : 'none';
  const h = (id ? findItem(id) : null) as Hotel | null;
  setVal('hName', h ? h.name : P.name ?? '');
  setVal('hCity', h ? h.city : P.city ?? '');
  setVal('hAddr', h ? h.addr : P.addr ?? '');
  setVal('hIn', h ? h.checkIn : P.checkIn ?? '2026-05-01T15:00');
  setVal('hOut', h ? h.checkOut : P.checkOut ?? '2026-05-03T11:00');
  setVal('hCost', h ? h.cost : P.cost ?? '');
  setVal('hCur', h ? h.currency : P.currency ?? 'EUR');
  setVal('hLink', h ? h.link || '' : P.link ?? '');
  byId('overlay').classList.add('open');
}

export function closeModal(): void {
  byId('overlay').classList.remove('open');
}

function saveModal(): void {
  if (editKind === 'hotel') {
    saveHotel();
    return;
  }
  const dc = getVal('fDepCity');
  const ac = getVal('fArrCity');
  if (!dc || !ac) {
    alert('Departure and arrival city are required.');
    return;
  }
  const existing = editingId ? findItem(editingId) : undefined;
  const seg: Segment = {
    id: existing?.id ?? nextId(),
    kind: 'segment',
    dep: { city: dc, addr: getVal('fDepAddr'), time: getVal('fDepTime'), ll: geocode(dc, getVal('fDepAddr')) },
    arr: { city: ac, addr: getVal('fArrAddr'), time: getVal('fArrTime'), ll: geocode(ac, getVal('fArrAddr')) },
    transport: getVal('fTransport') as TransportKind,
    company: getVal('fCompany'),
    cost: Number(getVal('fCost') || 0),
    currency: getVal('fCur') as CurrencyCode,
    inPlan: existing ? existing.inPlan : newInPlan,
  };
  upsertItem(seg);
  closeModal();
  emitChange();
}

function saveHotel(): void {
  const name = getVal('hName');
  const city = getVal('hCity');
  if (!name || !city) {
    alert('Hotel name and city are required.');
    return;
  }
  const existing = editingId ? findItem(editingId) : undefined;
  const h: Hotel = {
    id: existing?.id ?? nextId(),
    kind: 'hotel',
    name,
    city,
    addr: getVal('hAddr'),
    checkIn: getVal('hIn'),
    checkOut: getVal('hOut'),
    cost: Number(getVal('hCost') || 0),
    currency: getVal('hCur') as CurrencyCode,
    link: getVal('hLink').trim() || null,
    ll: geocode(city, getVal('hAddr')),
    inPlan: existing ? existing.inPlan : newInPlan,
  };
  upsertItem(h);
  closeModal();
  emitChange();
}

function deleteItem(): void {
  if (editingId) deleteItemById(editingId);
  closeModal();
  emitChange();
}

/** Wire the dialog's buttons and overlay-dismiss behaviour (once, at startup). */
export function wireModal(): void {
  byId('closeModal').onclick = closeModal;
  byId('cancelBtn').onclick = closeModal;
  byId('saveBtn').onclick = saveModal;
  byId('delBtn').onclick = deleteItem;
  byId('fTransport').onchange = bufHint;
  byId('overlay').onclick = (e) => {
    if ((e.target as HTMLElement).id === 'overlay') closeModal();
  };
}
