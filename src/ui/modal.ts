import type { CurrencyCode, Hotel, LatLng, Leg, TransportKind } from '../domain/types';
import { geocodeAddress, geocodePlace } from '../domain/geocode';
import { fmtDur } from '../domain/format';
import { bufferMin } from '../domain/transport';
import { formatExchange, lastExchange, type LlmExchange } from '../import/debugLog';
import type { ExtractedHotel, ExtractedLeg } from '../import/extractor';
import { runAutoRecognition, runHotelRecognition, runRecognition } from '../import/recognise';
import {
  deleteAttachment, getAttachment, getExchange, putAttachment, putExchange, resolveLink,
} from '../state/attachments';
import { parserName, resolveParser, saveSettings, settings, type ResolvedParser } from '../state/settings';
import { deleteSegment, emitChange, findItem, upsertItem } from '../state/store';
import { nextId } from '../state/id';
import { byId, getVal, setVal } from './dom';
import { openParserSettings } from './parserSettings';

export interface LegPrefill {
  inPlan?: boolean;
  depCity?: string; depAddr?: string; depTime?: string;
  arrCity?: string; arrAddr?: string; arrTime?: string;
  transport?: TransportKind; company?: string; cost?: number; currency?: CurrencyCode;
  transfers?: number; transfersInfo?: string;
  /** Ticket images carried into the dialog (queued multi-leg recognition). */
  files?: File[];
}

export interface HotelPrefill {
  inPlan?: boolean;
  name?: string; city?: string; addr?: string;
  checkIn?: string; checkOut?: string; cost?: number; currency?: CurrencyCode;
  /** Booking images carried into the dialog (auto-import from paste). */
  files?: File[];
}

let editingId: string | null = null;
let editKind: 'leg' | 'hotel' = 'leg';
let newInPlan = false;
let activeTab: 'form' | 'rec' = 'form';
let previewUrls: string[] = [];
let hasPreview = false;
/** Images picked/dropped/pasted in this dialog, not yet saved to IndexedDB.
 * Several can be collected before pressing Recognise (#30). */
let pendingFiles: File[] = [];
/** Attachment of the leg being edited (kept unless replaced). */
let existingAttachment: string | null = null;
/** Remaining legs of a multi-leg recognition, opened one dialog at a time. */
let queuedLegs: ExtractedLeg[] = [];
let queuedFiles: File[] = [];
/** Exchange shown in this dialog: loaded from storage when editing, replaced
 * by a fresh recognition. Saved with the leg. */
let dialogExchange: LlmExchange | null = null;

/** Show/hide the modal sections for the active tab (Edit form / Recognize). */
function applyTabs(): void {
  const form = activeTab === 'form';
  byId('legBody').style.display = form && editKind === 'leg' ? 'grid' : 'none';
  byId('hotelBody').style.display = form && editKind === 'hotel' ? 'grid' : 'none';
  byId('legImport').style.display = form ? 'none' : 'block';
  // clearing the inline display lets the stylesheet pick block vs gallery flex
  byId('filePreview').style.display = hasPreview ? '' : 'none';
  byId('dropHint').style.display = hasPreview ? 'none' : 'flex';
  byId('mtabForm').classList.toggle('active', form);
  byId('mtabRecognize').classList.toggle('active', !form);
  // footer action follows the tab: Save on the edit form, Recognise otherwise
  byId('saveBtn').style.display = form ? 'inline-flex' : 'none';
  byId('recogniseBtn').style.display = form ? 'none' : 'inline-flex';
  if (!form) byId('llmDump').textContent = formatExchange(dialogExchange ?? lastExchange());
}

function revokePreviews(): void {
  for (const u of previewUrls) URL.revokeObjectURL(u);
  previewUrls = [];
}

/** Render the pending images as a removable thumbnail gallery, or — with no
 * pending images — the stored attachment of the record being edited. */
function renderPreview(): void {
  const box = byId('filePreview');
  revokePreviews();
  hasPreview = false;
  box.innerHTML = '';
  box.classList.toggle('gallery', pendingFiles.length > 0);
  if (pendingFiles.length) {
    pendingFiles.forEach((f, i) => {
      const url = URL.createObjectURL(f);
      previewUrls.push(url);
      const cell = document.createElement('div');
      cell.className = 'thumb';
      cell.innerHTML = f.type.startsWith('image/')
        ? `<img src="${url}" alt="Pending image ${i + 1}">`
        : `<embed src="${url}" type="${f.type}">`;
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'thumb-rm';
      rm.title = 'Remove this image';
      rm.textContent = '✕';
      rm.onclick = (e) => {
        e.stopPropagation();
        pendingFiles.splice(i, 1);
        renderPreview();
      };
      cell.appendChild(rm);
      box.appendChild(cell);
    });
    hasPreview = true;
    applyTabs();
    return;
  }
  applyTabs();
  const att = existingAttachment;
  if (!att) return;
  void resolveLink(att).then((r) => {
    if (!r || !byId('overlay').classList.contains('open') || pendingFiles.length) return;
    previewUrls.push(r.url);
    box.innerHTML = r.type.startsWith('image/')
      ? `<img src="${r.url}" alt="Attached ticket preview">`
      : `<embed src="${r.url}" type="${r.type}">`;
    hasPreview = true;
    applyTabs();
  });
}

/** Append picked/dropped/pasted files to the pending list (no recognition —
 * the user collects images and presses Recognise explicitly). */
function addPendingFiles(fs: Iterable<File>): void {
  for (const f of fs) pendingFiles.push(f);
  renderPreview();
}

function showBody(kind: 'leg' | 'hotel'): void {
  editKind = kind;
  activeTab = 'form';
  byId('mtabForm').textContent = kind === 'hotel' ? 'Edit hotel' : 'Edit leg';
  byId('saveBtn').textContent = kind === 'hotel' ? 'Save hotel' : 'Save leg';
  byId('dropHint').textContent =
    kind === 'hotel'
      ? '📎 Drop or paste (Ctrl+V) screenshots of a hotel listing or booking, or click to choose'
      : '📎 Drop or paste (Ctrl+V) screenshots of a flight / train listing, or click to choose';
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
  set('fTransfers', leg.transfers);
  set('fTransfersInfo', leg.transfersInfo);
  set('fCost', leg.cost);
  set('fCur', leg.currency);
  bufHint();
  // The recognised places are new text — locate them right away.
  for (const k of ['depCity', 'depAddr', 'arrCity', 'arrAddr'] as SlotKey[]) resolveSlot(k);
}

/** Resolve the active parser, walking the user to the LLM configuration when
 * none is usable yet. Returns `null` when still unconfigured. */
async function ensureParser(): Promise<ResolvedParser | null> {
  if (!settings.parsers.length) {
    await openParserSettings();
    refreshParserCombo();
    if (!settings.parsers.length) return null;
  }
  const entry = settings.parsers[Math.min(Math.max(settings.activeParser, 0), settings.parsers.length - 1)];
  const parser = resolveParser(entry);
  if (!parser || !parser.apiKey) {
    alert('The selected parser has no account key — fill it in the LLM configuration.');
    await openParserSettings();
    refreshParserCombo();
    return null;
  }
  return parser;
}

async function recognise(): Promise<void> {
  const parser = await ensureParser();
  if (!parser) return;
  const note = getVal('fNote');
  let files = [...pendingFiles];
  if (!files.length && existingAttachment) {
    const rec = await getAttachment(existingAttachment);
    if (rec) files = [new File([rec.blob], rec.name, { type: rec.type })];
  }
  if (!files.length && !note.trim()) {
    alert('Attach a screenshot or write a note first.');
    return;
  }
  if (editKind === 'hotel') {
    const hotel = await runHotelRecognition(files, note, parser);
    dialogExchange = lastExchange();
    if (!hotel) {
      recogniseFailed();
      return;
    }
    fillHotelFields(hotel);
  } else {
    const legs = await runRecognition(files, note, parser);
    dialogExchange = lastExchange();
    if (!legs) {
      recogniseFailed();
      return;
    }
    fillLegFields(legs[0]);
    queuedLegs = legs.slice(1);
    queuedFiles = queuedLegs.length ? files : [];
  }
  // success: jump to the edit form with the extracted values
  activeTab = 'form';
  applyTabs();
}

/** Failure: refresh and unfold the exchange dump so the cause is one look away. */
function recogniseFailed(): void {
  byId('llmDump').textContent = formatExchange(dialogExchange);
  byId<HTMLDetailsElement>('llmDetails').open = true;
  activeTab = 'rec';
  applyTabs();
}

/** Image pasted with no dialog open: auto-detect leg vs hotel, then open the
 * matching dialog with the image attached and the fields filled. */
export async function importPastedImage(file: File): Promise<void> {
  const parser = await ensureParser();
  if (!parser) return;
  const result = await runAutoRecognition([file], '', parser);
  if (!result) {
    // Open a blank leg dialog with the image so the exchange is inspectable
    // and the user can adjust the note and retry.
    openModal(null, { files: [file] });
    dialogExchange = lastExchange();
    recogniseFailed();
    return;
  }
  if ('hotel' in result) {
    openHotelModal(null, { ...result.hotel, files: [file] });
  } else {
    const [first, ...rest] = result.legs;
    openModal(null, { ...first, files: [file] });
    queuedLegs = rest;
    queuedFiles = rest.length ? [file] : [];
  }
  // The exchange belongs to the record(s) just opened; openModal cleared it.
  dialogExchange = lastExchange();
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
  pendingFiles = P.files ? [...P.files] : [];
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
  setVal('fTransfers', r ? r.transfers : P.transfers ?? 0);
  setVal('fTransfersInfo', r ? r.transfersInfo : P.transfersInfo ?? '');
  setVal('fCost', r ? r.cost : P.cost ?? '');
  setVal('fCur', r ? r.currency : P.currency ?? 'EUR');
  setVal('fNote', '');
  refreshParserCombo();
  bufHint();
  initPlaceSlots('depCity', 'depAddr', r ? r.dep.ll : null);
  initPlaceSlots('arrCity', 'arrAddr', r ? r.arr.ll : null);
  byId('overlay').classList.add('open');
  renderPreview();
}

/** Open the hotel dialog (new when `id` is null), optionally pre-filled. */
export function openHotelModal(id: string | null, prefill?: HotelPrefill): void {
  editingId = id || null;
  showBody('hotel');
  const P = prefill || {};
  newInPlan = P.inPlan === true;
  byId('delBtn').style.display = id ? 'inline-flex' : 'none';
  const h = (id ? findItem(id) : null) as Hotel | null;
  pendingFiles = P.files ? [...P.files] : [];
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
  renderPreview();
}

export function closeModal(): void {
  byId('overlay').classList.remove('open');
  pendingFiles = [];
  existingAttachment = null;
  renderPreview();
  const ex = dialogExchange;
  dialogExchange = null;
  if (queuedLegs.length) {
    const [leg, ...rest] = queuedLegs;
    queuedLegs = [];
    const f = queuedFiles;
    if (!rest.length) queuedFiles = [];
    openModal(null, { ...leg, files: f.length ? f : undefined });
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
  if (pendingFiles.length) {
    // Newly picked images replace the stored one; the first is kept as the
    // record's attachment.
    if (existingAttachment) void deleteAttachment(existingAttachment);
    attachment = await putAttachment(pendingFiles[0]);
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
    transfers: Math.max(0, Math.round(Number(getVal('fTransfers') || 0))),
    transfersInfo: getVal('fTransfersInfo').trim(),
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
    if (pendingFiles.length) {
      // Newly picked images replace the stored one; the first is kept as the
      // record's attachment.
      if (existingAttachment) void deleteAttachment(existingAttachment);
      attachment = await putAttachment(pendingFiles[0]);
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
    const fs = input.files ? [...input.files] : [];
    input.value = ''; // allow re-selecting the same files
    if (fs.length) addPendingFiles(fs);
  };
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('dragover');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('dragover');
    const fs = e.dataTransfer?.files;
    if (fs?.length) addPendingFiles(fs);
  });
  // Paste (Ctrl/Cmd+V) an image — e.g. a screenshot taken straight to the
  // clipboard. With the edit dialog open (either tab) it becomes the dialog's
  // image; in the main window it auto-detects leg vs hotel and opens the
  // matching dialog prefilled. Other dialogs / busy states are left alone.
  document.addEventListener('paste', (e) => {
    const imgs = Array.from(e.clipboardData?.items ?? [])
      .filter((i) => i.type.startsWith('image/'))
      .map((i) => i.getAsFile())
      .filter((f): f is File => !!f)
      .map((f, i) => new File([f], f.name || `pasted-image-${i + 1}.png`, { type: f.type }));
    if (!imgs.length) return;
    if (byId('overlay').classList.contains('open')) {
      e.preventDefault();
      addPendingFiles(imgs);
      // make the pasted images visible right away
      activeTab = 'rec';
      applyTabs();
    } else if (!document.querySelector('.overlay.open') && byId('importBusy').style.display !== 'flex') {
      e.preventDefault();
      void importPastedImage(imgs[0]);
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
