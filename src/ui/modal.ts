import type { CurrencyCode, Hotel, LatLng, Leg, TransportKind } from '../domain/types';
import { geocodeAddress, geocodePlace } from '../domain/geocode';
import { fmtDur } from '../domain/format';
import { bufferMin } from '../domain/transport';
import { formatExchange, lastExchange, type LlmExchange } from '../import/debugLog';
import type { ExtractedHotel, ExtractedLeg } from '../import/extractor';
import { runHotelRecognition, runRecognition } from '../import/recognise';
import {
  deleteAttachment, getAttachment, getExchange, putAttachment, putExchange, resolveLink,
} from '../state/attachments';
import { parserName, resolveParser, saveSettings, settings } from '../state/settings';
import { deleteSegment, emitChange, findItem, upsertItem } from '../state/store';
import { nextId } from '../state/id';
import { byId, getVal, setVal } from './dom';
import { openParserSettings } from './parserSettings';

export interface LegPrefill {
  inPlan?: boolean;
  depCity?: string; depAddr?: string; depTime?: string;
  arrCity?: string; arrAddr?: string; arrTime?: string;
  transport?: TransportKind; company?: string; cost?: number; currency?: CurrencyCode;
  /** Ticket image carried into the dialog (queued multi-leg recognition). */
  file?: File;
}

export interface HotelPrefill {
  inPlan?: boolean;
  name?: string; city?: string; addr?: string;
  checkIn?: string; checkOut?: string; cost?: number; currency?: CurrencyCode;
}

let editingId: string | null = null;
let editKind: 'leg' | 'hotel' = 'leg';
let newInPlan = false;
let activeTab: 'form' | 'rec' = 'form';
let previewUrl: string | null = null;
let hasPreview = false;
/** Image picked/dropped in this dialog, not yet saved to IndexedDB. */
let pendingFile: File | null = null;
/** Attachment of the leg being edited (kept unless replaced). */
let existingAttachment: string | null = null;
/** Remaining legs of a multi-leg recognition, opened one dialog at a time. */
let queuedLegs: ExtractedLeg[] = [];
let queuedFile: File | null = null;
/** Exchange shown in this dialog: loaded from storage when editing, replaced
 * by a fresh recognition. Saved with the leg. */
let dialogExchange: LlmExchange | null = null;

/** Show/hide the modal sections for the active tab (Edit form / Recognize). */
function applyTabs(): void {
  const form = activeTab === 'form';
  byId('legBody').style.display = form && editKind === 'leg' ? 'grid' : 'none';
  byId('hotelBody').style.display = form && editKind === 'hotel' ? 'grid' : 'none';
  byId('legImport').style.display = form ? 'none' : 'block';
  byId('filePreview').style.display = hasPreview ? 'block' : 'none';
  byId('dropHint').style.display = hasPreview ? 'none' : 'flex';
  byId('mtabForm').classList.toggle('active', form);
  byId('mtabRecognize').classList.toggle('active', !form);
  // footer action follows the tab: Save on the edit form, Recognise otherwise
  byId('saveBtn').style.display = form ? 'inline-flex' : 'none';
  byId('recogniseBtn').style.display = form ? 'none' : 'inline-flex';
  if (!form) byId('llmDump').textContent = formatExchange(dialogExchange ?? lastExchange());
}

/** Render the ticket image (or PDF) preview inside the drop zone. */
function renderPreview(src: File | string | null): void {
  const box = byId('filePreview');
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }
  hasPreview = false;
  box.innerHTML = '';
  const show = (url: string, type: string): void => {
    previewUrl = url;
    box.innerHTML = type.startsWith('image/')
      ? `<img src="${url}" alt="Attached ticket preview">`
      : `<embed src="${url}" type="${type}">`;
    hasPreview = true;
    applyTabs();
  };
  if (src instanceof File) {
    show(URL.createObjectURL(src), src.type);
    return;
  }
  applyTabs();
  if (!src) return;
  void resolveLink(src).then((r) => {
    if (r && byId('overlay').classList.contains('open')) show(r.url, r.type);
  });
}

function setPendingFile(f: File): void {
  pendingFile = f;
  renderPreview(f);
}

function showBody(kind: 'leg' | 'hotel'): void {
  editKind = kind;
  activeTab = 'form';
  byId('mtabForm').textContent = kind === 'hotel' ? 'Edit hotel' : 'Edit leg';
  byId('saveBtn').textContent = kind === 'hotel' ? 'Save hotel' : 'Save leg';
  byId('dropHint').textContent =
    kind === 'hotel'
      ? '📎 Drop or paste (Ctrl+V) a screenshot of a hotel listing or booking, or click to choose'
      : '📎 Drop or paste (Ctrl+V) a screenshot of a flight / train listing, or click to choose';
  applyTabs();
}

// --- per-field geocoding, explicit in the dialog ----------------------------
// Every city and address field has its own status chip. City chips resolve the
// city; address chips resolve "addr, city" with no city fallback, so each chip
// honestly reports its own field. The saved coordinates prefer the address.

type GeoStatus = 'empty' | 'stale' | 'busy' | 'ok' | 'fail';
type SlotKey = 'depCity' | 'depAddr' | 'arrCity' | 'arrAddr' | 'hotCity' | 'hotAddr';

interface SlotSpec {
  chip: string;
  input: string;
  /** Present on address slots: the city field the address belongs to. */
  cityInput?: string;
}

const GEO_SLOTS: Record<SlotKey, SlotSpec> = {
  depCity: { chip: 'depCityGeo', input: 'fDepCity' },
  depAddr: { chip: 'depAddrGeo', input: 'fDepAddr', cityInput: 'fDepCity' },
  arrCity: { chip: 'arrCityGeo', input: 'fArrCity' },
  arrAddr: { chip: 'arrAddrGeo', input: 'fArrAddr', cityInput: 'fArrCity' },
  hotCity: { chip: 'hotCityGeo', input: 'hCity' },
  hotAddr: { chip: 'hotAddrGeo', input: 'hAddr', cityInput: 'hCity' },
};

/** The city slot next to an address slot and vice versa. */
const SIBLING: Record<SlotKey, SlotKey> = {
  depCity: 'depAddr', depAddr: 'depCity',
  arrCity: 'arrAddr', arrAddr: 'arrCity',
  hotCity: 'hotAddr', hotAddr: 'hotCity',
};

interface SlotGeo {
  ll: LatLng | null;
  status: GeoStatus;
  /** Invalidates in-flight lookups when fields change or the dialog reopens. */
  token: number;
}

const slots = Object.fromEntries(
  (Object.keys(GEO_SLOTS) as SlotKey[]).map((k) => [k, { ll: null, status: 'empty', token: 0 }]),
) as Record<SlotKey, SlotGeo>;

function renderGeoChip(key: SlotKey): void {
  const chip = byId<HTMLButtonElement>(GEO_SLOTS[key].chip);
  const g = slots[key];
  chip.className = 'geo-chip ' + g.status;
  const label: Record<GeoStatus, string> = {
    empty: '·',
    stale: '📍 locate',
    busy: '⏳ locating…',
    ok: '✓ located',
    fail: '✗ not found',
  };
  chip.textContent = label[g.status];
  // visibility (not display) so an appearing chip never shifts the layout.
  chip.style.visibility = g.status === 'empty' ? 'hidden' : 'visible';
  if (g.status === 'ok' && g.ll) {
    chip.title = `Located at ${g.ll[0].toFixed(4)}, ${g.ll[1].toFixed(4)} — click to look up again`;
  } else if (g.status === 'fail') {
    chip.title = 'Not found — check spelling and click to retry';
  } else {
    chip.title = 'Locate on the map';
  }
}

/** Set a slot's coordinates directly (record being edited). */
function setSlot(key: SlotKey, ll: LatLng | null, hasText: boolean): void {
  slots[key].token++;
  slots[key].ll = ll;
  slots[key].status = ll ? 'ok' : hasText ? 'stale' : 'empty';
  renderGeoChip(key);
}

/** Look up one field and show the outcome on its chip. */
function resolveSlot(key: SlotKey, force = false): void {
  const spec = GEO_SLOTS[key];
  const text = getVal(spec.input).trim();
  const g = slots[key];
  const token = ++g.token;
  if (!text) {
    g.ll = null;
    g.status = 'empty';
    renderGeoChip(key);
    return;
  }
  g.status = 'busy';
  renderGeoChip(key);
  const lookup = spec.cityInput
    ? geocodeAddress(getVal(spec.cityInput).trim(), text, { priority: true, force })
    : geocodePlace(text, undefined, { priority: true, force });
  void lookup.then((ll) => {
    if (g.token !== token) return; // field changed meanwhile
    g.ll = ll;
    g.status = ll ? 'ok' : 'fail';
    renderGeoChip(key);
  });
}

/** Mark a slot unresolved after its field (or its city) was edited. */
function staleSlot(key: SlotKey): void {
  setSlot(key, null, !!getVal(GEO_SLOTS[key].input).trim());
}

/** Coordinates a place saves: the specific address if located, else the city. */
const placeLl = (cityKey: SlotKey, addrKey: SlotKey): LatLng | null =>
  slots[addrKey].ll ?? slots[cityKey].ll;

/** Initialize a place's two slots when the dialog opens. */
function initPlaceSlots(cityKey: SlotKey, addrKey: SlotKey, storedLl: LatLng | null): void {
  const cityText = !!getVal(GEO_SLOTS[cityKey].input).trim();
  const addrText = !!getVal(GEO_SLOTS[addrKey].input).trim();
  // Stored coordinates are adopted by the city slot so an untouched record
  // keeps them even if the geocoder is unreachable.
  setSlot(cityKey, storedLl, cityText);
  setSlot(addrKey, null, addrText);
  if (!storedLl && cityText) resolveSlot(cityKey);
  if (addrText) resolveSlot(addrKey);
}

function bufHint(): void {
  const t = getVal('fTransport') as TransportKind;
  byId('bufHint').textContent = `Needs ≥ ${fmtDur(bufferMin(t) * 60000)} to connect before this leg`;
}

function refreshParserCombo(): void {
  const sel = byId<HTMLSelectElement>('fParser');
  sel.innerHTML = '';
  settings.parsers.forEach((p, i) => {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = parserName(p);
    sel.appendChild(o);
  });
  if (!settings.parsers.length) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = 'no parsers — add in ⚙';
    sel.appendChild(o);
    return;
  }
  sel.value = String(Math.min(Math.max(settings.activeParser, 0), settings.parsers.length - 1));
}

/** Fill the leg form from an extracted leg (only fields the model set). */
function fillLegFields(leg: ExtractedLeg): void {
  const set = (id: string, v: unknown): void => {
    if (v !== undefined && v !== null && v !== '') setVal(id, String(v));
  };
  set('fDepCity', leg.depCity);
  set('fDepAddr', leg.depAddr);
  set('fDepTime', leg.depTime);
  set('fArrCity', leg.arrCity);
  set('fArrAddr', leg.arrAddr);
  set('fArrTime', leg.arrTime);
  set('fTransport', leg.transport);
  set('fCompany', leg.company);
  set('fCost', leg.cost);
  set('fCur', leg.currency);
  bufHint();
  // The recognised places are new text — locate them right away.
  for (const k of ['depCity', 'depAddr', 'arrCity', 'arrAddr'] as SlotKey[]) resolveSlot(k);
}

async function recognise(): Promise<void> {
  if (!settings.parsers.length) {
    await openParserSettings();
    refreshParserCombo();
    if (!settings.parsers.length) return;
  }
  const entry = settings.parsers[Math.min(Math.max(settings.activeParser, 0), settings.parsers.length - 1)];
  const parser = resolveParser(entry);
  if (!parser || !parser.apiKey) {
    alert('The selected parser has no account key — fill it in the LLM configuration.');
    await openParserSettings();
    refreshParserCombo();
    return;
  }
  const note = getVal('fNote');
  let file = pendingFile;
  if (!file && existingAttachment) {
    const rec = await getAttachment(existingAttachment);
    if (rec) file = new File([rec.blob], rec.name, { type: rec.type });
  }
  if (!file && !note.trim()) {
    alert('Attach a screenshot or write a note first.');
    return;
  }
  if (editKind === 'hotel') {
    const hotel = await runHotelRecognition(file, note, parser);
    dialogExchange = lastExchange();
    if (!hotel) {
      recogniseFailed();
      return;
    }
    fillHotelFields(hotel);
  } else {
    const legs = await runRecognition(file, note, parser);
    dialogExchange = lastExchange();
    if (!legs) {
      recogniseFailed();
      return;
    }
    fillLegFields(legs[0]);
    queuedLegs = legs.slice(1);
    queuedFile = queuedLegs.length ? file : null;
  }
  // success: jump to the edit form with the extracted values
  activeTab = 'form';
  applyTabs();
}

/** Failure: refresh and unfold the exchange dump so the cause is one look away. */
function recogniseFailed(): void {
  byId('llmDump').textContent = formatExchange(dialogExchange);
  byId<HTMLDetailsElement>('llmDetails').open = true;
}

/** Fill the hotel form from an extracted stay (only fields the model set). */
function fillHotelFields(h: ExtractedHotel): void {
  const set = (id: string, v: unknown): void => {
    if (v !== undefined && v !== null && v !== '') setVal(id, String(v));
  };
  set('hName', h.name);
  set('hCity', h.city);
  set('hAddr', h.addr);
  set('hIn', h.checkIn);
  set('hOut', h.checkOut);
  set('hCost', h.cost);
  set('hCur', h.currency);
  // The recognised places are new text — locate them right away.
  resolveSlot('hotCity');
  resolveSlot('hotAddr');
}

/** Open the leg dialog (new when `id` is null), optionally pre-filled. */
export function openModal(id: string | null, prefill?: LegPrefill): void {
  editingId = id || null;
  showBody('leg');
  const P = prefill || {};
  newInPlan = P.inPlan === true;
  byId('delBtn').style.display = id ? 'inline-flex' : 'none';
  const r = (id ? findItem(id) : null) as Leg | null;
  pendingFile = P.file ?? null;
  existingAttachment = r ? r.attachment : null;
  dialogExchange = null;
  if (id) {
    // Show the exchange that produced this leg, if one was stored.
    void getExchange(id).then((ex) => {
      if (ex && editingId === id) {
        dialogExchange = ex;
        if (activeTab === 'rec') applyTabs();
      }
    });
  }
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
  setVal('fNote', '');
  refreshParserCombo();
  bufHint();
  initPlaceSlots('depCity', 'depAddr', r ? r.dep.ll : null);
  initPlaceSlots('arrCity', 'arrAddr', r ? r.arr.ll : null);
  byId('overlay').classList.add('open');
  renderPreview(pendingFile ?? existingAttachment);
}

/** Open the hotel dialog (new when `id` is null), optionally pre-filled. */
export function openHotelModal(id: string | null, prefill?: HotelPrefill): void {
  editingId = id || null;
  showBody('hotel');
  const P = prefill || {};
  newInPlan = P.inPlan === true;
  byId('delBtn').style.display = id ? 'inline-flex' : 'none';
  const h = (id ? findItem(id) : null) as Hotel | null;
  pendingFile = null;
  existingAttachment = h ? h.attachment : null;
  dialogExchange = null;
  if (id) {
    // Show the exchange that produced this hotel, if one was stored.
    void getExchange(id).then((ex) => {
      if (ex && editingId === id) {
        dialogExchange = ex;
        if (activeTab === 'rec') applyTabs();
      }
    });
  }
  setVal('hName', h ? h.name : P.name ?? '');
  setVal('hCity', h ? h.city : P.city ?? '');
  setVal('hAddr', h ? h.addr : P.addr ?? '');
  setVal('hIn', h ? h.checkIn : P.checkIn ?? '2026-05-01T15:00');
  setVal('hOut', h ? h.checkOut : P.checkOut ?? '2026-05-03T11:00');
  setVal('hCost', h ? h.cost : P.cost ?? '');
  setVal('hCur', h ? h.currency : P.currency ?? 'EUR');
  setVal('fNote', '');
  refreshParserCombo();
  initPlaceSlots('hotCity', 'hotAddr', h ? h.ll : null);
  byId('overlay').classList.add('open');
  renderPreview(existingAttachment);
}

export function closeModal(): void {
  byId('overlay').classList.remove('open');
  renderPreview(null);
  pendingFile = null;
  existingAttachment = null;
  const ex = dialogExchange;
  dialogExchange = null;
  if (queuedLegs.length) {
    const [leg, ...rest] = queuedLegs;
    queuedLegs = [];
    const f = queuedFile;
    if (!rest.length) queuedFile = null;
    openModal(null, { ...leg, file: f ?? undefined });
    queuedLegs = rest;
    // Every leg of the itinerary came from the same recognition.
    dialogExchange = ex;
  }
}

async function saveLeg(): Promise<void> {
  const dc = getVal('fDepCity');
  const ac = getVal('fArrCity');
  if (!dc || !ac) {
    alert('Departure and arrival city are required.');
    return;
  }
  // Storing the image is async — block a double-click on Save meanwhile.
  const saveBtn = byId<HTMLButtonElement>('saveBtn');
  if (saveBtn.disabled) return;
  saveBtn.disabled = true;
  try {
    await doSaveLeg(dc, ac);
  } finally {
    saveBtn.disabled = false;
  }
}

async function doSaveLeg(dc: string, ac: string): Promise<void> {
  const existing = editingId ? (findItem(editingId) as Leg | undefined) : undefined;
  let attachment = existingAttachment;
  if (pendingFile) {
    // A newly picked image replaces the stored one.
    if (existingAttachment) void deleteAttachment(existingAttachment);
    attachment = await putAttachment(pendingFile);
  }
  const segId = existing?.id ?? nextId();
  // Persist the exchange that filled this leg, next to the image. Awaited so
  // a reload right after Save cannot lose the write.
  if (dialogExchange) await putExchange(segId, dialogExchange);
  // Coordinates come from the dialog's explicit lookups (the chips); saving
  // never geocodes. Unresolved places save as null and stay off the map.
  const seg: Leg = {
    id: segId,
    kind: 'leg',
    dep: { city: dc, addr: getVal('fDepAddr'), time: getVal('fDepTime'), ll: placeLl('depCity', 'depAddr') },
    arr: { city: ac, addr: getVal('fArrAddr'), time: getVal('fArrTime'), ll: placeLl('arrCity', 'arrAddr') },
    transport: getVal('fTransport') as TransportKind,
    company: getVal('fCompany'),
    cost: Number(getVal('fCost') || 0),
    currency: getVal('fCur') as CurrencyCode,
    attachment,
    inPlan: existing ? existing.inPlan : newInPlan,
  };
  upsertItem(seg);
  closeModal();
  emitChange();
}

function saveModal(): void {
  if (editKind === 'hotel') {
    void saveHotel();
    return;
  }
  void saveLeg();
}

async function saveHotel(): Promise<void> {
  const name = getVal('hName');
  const city = getVal('hCity');
  if (!name || !city) {
    alert('Hotel name and city are required.');
    return;
  }
  // Storing the image is async — block a double-click on Save meanwhile.
  const saveBtn = byId<HTMLButtonElement>('saveBtn');
  if (saveBtn.disabled) return;
  saveBtn.disabled = true;
  try {
    const existing = editingId ? findItem(editingId) : undefined;
    let attachment = existingAttachment;
    if (pendingFile) {
      // A newly picked image replaces the stored one.
      if (existingAttachment) void deleteAttachment(existingAttachment);
      attachment = await putAttachment(pendingFile);
    }
    const hotelId = existing?.id ?? nextId();
    if (dialogExchange) await putExchange(hotelId, dialogExchange);
    const h: Hotel = {
      id: hotelId,
      kind: 'hotel',
      name,
      city,
      addr: getVal('hAddr'),
      checkIn: getVal('hIn'),
      checkOut: getVal('hOut'),
      cost: Number(getVal('hCost') || 0),
      currency: getVal('hCur') as CurrencyCode,
      attachment,
      ll: placeLl('hotCity', 'hotAddr'),
      inPlan: existing ? existing.inPlan : newInPlan,
    };
    upsertItem(h);
    closeModal();
    emitChange();
  } finally {
    saveBtn.disabled = false;
  }
}

function deleteItem(): void {
  if (editingId) deleteSegment(editingId);
  closeModal();
  emitChange();
}

/** Wire the dialog's buttons, drop zone and overlay-dismiss (once, at startup). */
export function wireModal(): void {
  byId('closeModal').onclick = closeModal;
  byId('cancelBtn').onclick = closeModal;
  byId('saveBtn').onclick = saveModal;
  byId('delBtn').onclick = deleteItem;
  byId('fTransport').onchange = bufHint;
  byId('mtabForm').onclick = () => {
    activeTab = 'form';
    applyTabs();
  };
  byId('mtabRecognize').onclick = () => {
    activeTab = 'rec';
    applyTabs();
  };
  // Geo chips: click retries the lookup; editing a field marks its slot (and,
  // for city fields, the dependent address slot) unresolved immediately and
  // re-locates once the field loses focus.
  for (const key of Object.keys(GEO_SLOTS) as SlotKey[]) {
    const spec = GEO_SLOTS[key];
    const isCity = !spec.cityInput;
    byId(spec.chip).onclick = (e) => {
      e.preventDefault(); // chips live inside <label>: don't focus the input
      resolveSlot(key, true);
    };
    byId(spec.input).addEventListener('input', () => {
      staleSlot(key);
      if (isCity) staleSlot(SIBLING[key]); // the address lookup uses the city
    });
    byId(spec.input).addEventListener('change', () => {
      resolveSlot(key);
      if (isCity && getVal(GEO_SLOTS[SIBLING[key]].input).trim()) resolveSlot(SIBLING[key]);
    });
  }
  const zone = byId('importZone');
  zone.onclick = (e) => {
    if ((e.target as HTMLElement).id !== 'legFile') byId<HTMLInputElement>('legFile').click();
  };
  byId<HTMLInputElement>('legFile').onchange = (e) => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = ''; // allow re-selecting the same file
    if (f) setPendingFile(f);
  };
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('dragover');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('dragover');
    const f = e.dataTransfer?.files?.[0];
    if (f) setPendingFile(f);
  });
  // Paste (Ctrl/Cmd+V) an image while the Recognize tab is open — e.g. a
  // screenshot taken straight to the clipboard.
  document.addEventListener('paste', (e) => {
    if (!byId('overlay').classList.contains('open') || activeTab !== 'rec') return;
    const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith('image/'));
    const f = item?.getAsFile();
    if (f) {
      e.preventDefault();
      setPendingFile(new File([f], f.name || 'pasted-image.png', { type: f.type }));
    }
  });
  byId('recogniseBtn').onclick = () => void recognise();
  byId('cfgParsersBtn').onclick = async () => {
    await openParserSettings();
    refreshParserCombo();
  };
  byId('fParser').onchange = () => {
    const v = Number(getVal('fParser'));
    if (!Number.isNaN(v)) {
      settings.activeParser = v;
      saveSettings();
    }
  };
  byId('overlay').onclick = (e) => {
    if ((e.target as HTMLElement).id === 'overlay') closeModal();
  };
}
