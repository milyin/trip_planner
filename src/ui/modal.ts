import type { CurrencyCode, Hotel, LatLng, Leg, NoteEntry, Segment, TransportKind } from '../domain/types';
import { getRate, RATES_SOURCE, rateSourceUrl } from '../domain/convert';
import { geocodeAddress, geocodePlace } from '../domain/geocode';
import { fmtDur } from '../domain/format';
import { tzForLatLng, tzOffset } from '../domain/tz';
import { bufferMin } from '../domain/transport';
import { formatExchange, lastExchange, type LlmExchange } from '../import/debugLog';
import type { ExtractedHotel, ExtractedLeg } from '../import/extractor';
import { runAutoRecognition, runHotelRecognition, runRecognition } from '../import/recognise';
import {
  deleteAttachment, getAttachment, getExchange, putAttachment, putExchange, resolveLink,
} from '../state/attachments';
import { parserName, resolveParser, saveSettings, settings, type ResolvedParser } from '../state/settings';
import { deleteSegment, emitChange, findItem, upsertItem } from '../state/store';
import { genNoteId, nextId } from '../state/id';
import { fillCurrencySelect } from './currency';
import { byId, getVal, mkBtn, setVal } from './dom';
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
let activeTab: 'form' | 'rec' | 'notes' = 'form';
let previewUrls: string[] = [];
let hasPreview = false;

/** One entry being edited in the dialog: a persisted note (`attachment`/`text`)
 * or a file picked this session (`file`, not yet stored in IndexedDB). */
interface WorkingNote {
  id: string;
  source: 'llm' | 'user';
  kind: 'file' | 'text';
  attachment?: string;
  name?: string;
  mime?: string;
  text?: string;
  file?: File;
}
/** Every note on the record open in the dialog (LLM files + user files/text). */
let notes: WorkingNote[] = [];
/** Stored attachment links present when the dialog opened — any dropped by save
 * are deleted from IndexedDB. */
let originalAttachments = new Set<string>();

/** Remaining legs of a multi-leg recognition, opened one dialog at a time. */
let queuedLegs: ExtractedLeg[] = [];
let queuedFiles: File[] = [];
/** Exchange shown in this dialog: loaded from storage when editing, replaced
 * by a fresh recognition. Saved with the leg. */
let dialogExchange: LlmExchange | null = null;

/** The LLM-source file notes — the images sent to the model and shown in the
 * Recognize tab's gallery. */
const llmFileNotes = (): WorkingNote[] => notes.filter((n) => n.source === 'llm' && n.kind === 'file');

/** Resolve a file note back to a File (pending file, or re-read from IndexedDB). */
async function noteFile(n: WorkingNote): Promise<File | null> {
  if (n.file) return n.file;
  if (n.attachment) {
    const rec = await getAttachment(n.attachment);
    if (rec) return new File([rec.blob], rec.name, { type: rec.type });
  }
  return null;
}

/** Load a record's notes into the working set, plus prefill files as LLM notes. */
function loadNotes(rec: Segment | null, prefillFiles?: File[]): void {
  notes = (rec?.notes ?? []).map((n) => ({ ...n }));
  originalAttachments = new Set(notes.map((n) => n.attachment).filter((a): a is string => !!a));
  for (const f of prefillFiles ?? []) {
    notes.push({ id: genNoteId(), source: 'llm', kind: 'file', file: f, name: f.name, mime: f.type });
  }
}

/** Store pending files, delete blobs dropped from the set, return notes to save. */
async function commitNotes(): Promise<NoteEntry[]> {
  const out: NoteEntry[] = [];
  const kept = new Set<string>();
  for (const n of notes) {
    if (n.kind === 'file') {
      const link = n.attachment ?? (n.file ? await putAttachment(n.file) : undefined);
      if (!link) continue;
      kept.add(link);
      out.push({ id: n.id, source: n.source, kind: 'file', attachment: link, name: n.name, mime: n.mime });
    } else {
      const text = (n.text ?? '').trim();
      if (text) out.push({ id: n.id, source: n.source, kind: 'text', text });
    }
  }
  for (const link of originalAttachments) if (!kept.has(link)) void deleteAttachment(link);
  return out;
}

const isUrl = (s?: string): boolean => !!s && /^https?:\/\//i.test(s.trim());

/** Show/hide the modal sections for the active tab (Edit / Recognize / Notes). */
function applyTabs(): void {
  const form = activeTab === 'form';
  const rec = activeTab === 'rec';
  const notesTab = activeTab === 'notes';
  byId('legBody').style.display = form && editKind === 'leg' ? 'grid' : 'none';
  byId('hotelBody').style.display = form && editKind === 'hotel' ? 'grid' : 'none';
  byId('legImport').style.display = rec ? 'block' : 'none';
  byId('notesBody').style.display = notesTab ? 'block' : 'none';
  // clearing the inline display lets the stylesheet pick block vs gallery flex
  byId('filePreview').style.display = hasPreview ? '' : 'none';
  byId('dropHint').style.display = hasPreview ? 'none' : 'flex';
  byId('mtabForm').classList.toggle('active', form);
  byId('mtabRecognize').classList.toggle('active', rec);
  byId('mtabNotes').classList.toggle('active', notesTab);
  // footer action follows the tab: Recognise on the Recognize tab, else Save
  byId('saveBtn').style.display = rec ? 'none' : 'inline-flex';
  byId('recogniseBtn').style.display = rec ? 'inline-flex' : 'none';
  if (rec) byId('llmDump').textContent = formatExchange(dialogExchange ?? lastExchange());
}

function revokePreviews(): void {
  for (const u of previewUrls) URL.revokeObjectURL(u);
  previewUrls = [];
}

/** A thumbnail media element (image or embed) for a file preview. */
function thumbMedia(url: string, type: string, name: string): HTMLElement {
  if (!type || type.startsWith('image/')) {
    const img = document.createElement('img');
    img.src = url;
    img.alt = name;
    return img;
  }
  const emb = document.createElement('embed');
  emb.src = url;
  emb.type = type;
  return emb;
}

/** Render the LLM file notes as a removable thumbnail gallery in the Recognize
 * tab. Files added here become the images sent to the model. */
function renderPreview(): void {
  const box = byId('filePreview');
  revokePreviews();
  box.innerHTML = '';
  const files = llmFileNotes();
  hasPreview = files.length > 0;
  box.classList.toggle('gallery', hasPreview);
  files.forEach((n) => {
    const cell = document.createElement('div');
    cell.className = 'thumb';
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'thumb-rm';
    rm.title = 'Remove this image';
    rm.textContent = '✕';
    rm.onclick = (e) => {
      e.stopPropagation();
      removeNote(n.id);
    };
    cell.appendChild(rm);
    box.appendChild(cell);
    if (n.file) {
      const url = URL.createObjectURL(n.file);
      previewUrls.push(url);
      cell.insertBefore(thumbMedia(url, n.mime || n.file.type, n.name || 'image'), rm);
    } else if (n.attachment) {
      void resolveLink(n.attachment).then((r) => {
        if (!r || !byId('overlay').classList.contains('open')) return;
        previewUrls.push(r.url);
        cell.insertBefore(thumbMedia(r.url, r.type, n.name || 'image'), rm);
      });
    }
  });
  applyTabs();
}

/** Render the Notes tab: every entry (LLM + user), each removable. */
function renderNotes(): void {
  byId('mtabNotes').textContent = notes.length ? `Notes · ${notes.length}` : 'Notes';
  const box = byId('notesList');
  box.innerHTML = '';
  if (!notes.length) {
    box.innerHTML = '<div class="empty-note">No files or notes yet. Add a file or a note below; images loaded on the Recognize tab appear here too.</div>';
    return;
  }
  notes.forEach((n) => {
    const row = document.createElement('div');
    row.className = 'note-row';
    const badge = document.createElement('span');
    badge.className = 'note-badge ' + n.source;
    badge.textContent = n.source === 'llm' ? 'LLM' : 'you';
    badge.title = n.source === 'llm' ? 'Loaded on the Recognize tab' : 'Added by you';
    const body = document.createElement('div');
    body.className = 'note-body';
    if (n.kind === 'file') {
      const a = document.createElement('a');
      a.className = 'note-name';
      a.textContent = '📎 ' + (n.name || 'file');
      a.href = '#';
      a.title = 'Open file';
      a.onclick = (e) => {
        e.preventDefault();
        void openNote(n);
      };
      body.appendChild(a);
    } else if (isUrl(n.text)) {
      const a = document.createElement('a');
      a.className = 'note-name';
      a.textContent = '🔗 ' + n.text;
      a.href = n.text!;
      a.target = '_blank';
      a.rel = 'noopener';
      body.appendChild(a);
    } else {
      const span = document.createElement('span');
      span.className = 'note-name';
      span.textContent = n.text || '';
      body.appendChild(span);
    }
    const rm = mkBtn('✕', 'btn icon ghost');
    rm.title = 'Remove';
    rm.onclick = () => removeNote(n.id);
    row.append(badge, body, rm);
    box.appendChild(row);
  });
}

/** Open a file note in a new tab. */
async function openNote(n: WorkingNote): Promise<void> {
  let url: string | null = null;
  if (n.file) url = URL.createObjectURL(n.file);
  else if (n.attachment) url = (await resolveLink(n.attachment))?.url ?? null;
  if (url) window.open(url, '_blank', 'noopener');
}

function removeNote(id: string): void {
  notes = notes.filter((n) => n.id !== id);
  renderPreview();
  renderNotes();
}

/** Files picked/dropped/pasted on the Recognize tab become LLM file notes. */
function addRecognizeFiles(fs: Iterable<File>): void {
  for (const f of fs) notes.push({ id: genNoteId(), source: 'llm', kind: 'file', file: f, name: f.name, mime: f.type });
  renderPreview();
  renderNotes();
}

/** Files added in the Notes tab are user files (not sent to the model). */
function addUserFiles(fs: Iterable<File>): void {
  for (const f of fs) notes.push({ id: genNoteId(), source: 'user', kind: 'file', file: f, name: f.name, mime: f.type });
  renderNotes();
}

function addUserText(text: string): void {
  const t = text.trim();
  if (!t) return;
  notes.push({ id: genNoteId(), source: 'user', kind: 'text', text: t });
  renderNotes();
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

// --- date/time split fields --------------------------------------------------
// The dialog edits date and time separately (#43); records still store one
// `YYYY-MM-DDTHH:MM` wall-clock string, so split on load and rejoin on save.
const splitDT = (s: string): { date: string; time: string } => {
  const [d, t = ''] = (s || '').split('T');
  return { date: d || '', time: t.slice(0, 5) };
};
const joinDT = (date: string, time: string): string => (date ? `${date}T${time || '00:00'}` : '');
const setDT = (dateId: string, timeId: string, s: string): void => {
  const { date, time } = splitDT(s);
  setVal(dateId, date);
  setVal(timeId, time);
};
const getDT = (dateId: string, timeId: string): string => joinDT(getVal(dateId), getVal(timeId));

// --- automatic time zone from the city --------------------------------------
// Each place's slots feed a time-zone input, auto-filled from the resolved
// coordinates. `tzAuto[field]` is cleared once the user types their own value,
// so a later geocode never overwrites a manual choice.
const TZ_FIELD: Partial<Record<SlotKey, string>> = {
  depCity: 'fDepTz', depAddr: 'fDepTz',
  arrCity: 'fArrTz', arrAddr: 'fArrTz',
  hotCity: 'hTz', hotAddr: 'hTz',
};
const tzAuto: Record<string, boolean> = {};

function maybeAutoTz(key: SlotKey, ll: LatLng | null): void {
  const field = TZ_FIELD[key];
  if (!field || !ll) return;
  if (getVal(field).trim() && !tzAuto[field]) return; // user set it — leave it
  const tok = slots[key].token;
  void tzForLatLng(ll).then((tz) => {
    if (!tz || slots[key].token !== tok) return; // field changed while looking up
    if (getVal(field).trim() && !tzAuto[field]) return;
    setVal(field, tz);
    tzAuto[field] = true;
  });
}

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
  maybeAutoTz(key, ll);
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
    maybeAutoTz(key, ll);
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

// --- converted cost (base currency), with a geo-chip-style auto/manual field --
// Like geocoding: the cost is auto-converted to the settings' base currency the
// first time, the user may type their own value, and it's never forced.
interface ConvSpec { cost: string; cur: string; conv: string; chip: string; label: string; rate: string }
const CONV: Record<'leg' | 'hotel', ConvSpec> = {
  leg: { cost: 'fCost', cur: 'fCur', conv: 'fCostConv', chip: 'fConvChip', label: 'fConvCur', rate: 'fRate' },
  hotel: { cost: 'hCost', cur: 'hCur', conv: 'hCostConv', chip: 'hConvChip', label: 'hConvCur', rate: 'hRate' },
};

/** Compact display of an exchange rate, e.g. `0.9091` or `150.48`. */
const fmtRate = (rate: number): string => rate.toLocaleString(undefined, { maximumSignificantDigits: 5 });
/** Per converted-cost input: true once the user typed a value themselves. */
const convManual: Record<string, boolean> = {};
const convToken: Record<string, number> = {};

type ConvStatus = 'empty' | 'busy' | 'ok' | 'fail' | 'manual' | 'same';
function renderConvChip(chipId: string, status: ConvStatus): void {
  const chip = byId<HTMLButtonElement>(chipId);
  chip.className = 'geo-chip ' + (status === 'manual' || status === 'same' ? '' : status);
  const labels: Record<ConvStatus, string> = {
    empty: '·', busy: '⏳ converting…', ok: '✓ auto', fail: '✗ retry', manual: '✎ manual', same: '= base',
  };
  chip.textContent = labels[status];
  chip.style.visibility = status === 'empty' ? 'hidden' : 'visible';
  chip.title = status === 'fail' ? 'Conversion failed — click to retry'
    : status === 'manual' ? 'Your own value — click to auto-convert instead'
    : 'Convert the cost to the base currency';
}

/** Recompute the converted-cost field for the given form from the live rate,
 * and show that rate — as a link to the source page for the currency — above
 * the currency field. */
function refreshConv(kind: 'leg' | 'hotel', opts: { force?: boolean; onlyIfEmpty?: boolean } = {}): void {
  const s = CONV[kind];
  const base = settings.baseCurrency;
  byId(s.label).textContent = base ? `in ${base}` : '';
  const rateEl = byId<HTMLAnchorElement>(s.rate);
  rateEl.style.display = 'none'; // shown only once a real rate is known
  const cost = Number(getVal(s.cost)) || 0;
  const cur = getVal(s.cur);
  if (!cur || cur === base) { setVal(s.conv, cost ? String(cost) : ''); renderConvChip(s.chip, 'same'); return; }
  if (!cost) { setVal(s.conv, ''); renderConvChip(s.chip, 'empty'); return; }
  const tok = (convToken[s.conv] = (convToken[s.conv] || 0) + 1);
  renderConvChip(s.chip, 'busy');
  // The rate is fetched (cached) even for a manual value, so the market rate is
  // always shown above the currency — only the field value respects manual.
  void getRate(cur, base, { priority: true }).then((rate) => {
    if (convToken[s.conv] !== tok) return; // fields changed while converting
    if (rate == null) { renderConvChip(s.chip, 'fail'); return; }
    const text = `1 ${cur} = ${fmtRate(rate)} ${base}`;
    rateEl.textContent = text;
    rateEl.href = rateSourceUrl(cur);
    rateEl.title = `${text} — rates from ${RATES_SOURCE.name}`;
    rateEl.style.display = '';
    if (convManual[s.conv] && !opts.force) { renderConvChip(s.chip, 'manual'); return; }
    if (!(opts.onlyIfEmpty && getVal(s.conv).trim() && !opts.force)) {
      setVal(s.conv, String(Math.round(cost * rate * 100) / 100));
      convManual[s.conv] = false;
    }
    renderConvChip(s.chip, 'ok');
  });
}

/** Initialise a form's currency select + converted-cost field on open. */
function initCurrency(kind: 'leg' | 'hotel', currency: string, converted: number | undefined, manual: boolean): void {
  const s = CONV[kind];
  fillCurrencySelect(byId<HTMLSelectElement>(s.cur), currency);
  setVal(s.conv, converted != null ? String(converted) : '');
  convManual[s.conv] = manual;
  refreshConv(kind, { onlyIfEmpty: true });
}

/** The converted-cost fields to store: none when the record is already in the
 * base currency, otherwise the field value + whether the user set it. */
function readConverted(kind: 'leg' | 'hotel'): { costConverted?: number; costConvertedManual?: boolean } {
  const s = CONV[kind];
  if (getVal(s.cur) === settings.baseCurrency) return {};
  const raw = getVal(s.conv).trim();
  const v = Number(raw);
  if (!raw || !Number.isFinite(v)) return {};
  return { costConverted: v, costConvertedManual: convManual[s.conv] ? true : undefined };
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
  if (leg.depTime) setDT('fDepDate', 'fDepTime', leg.depTime);
  set('fArrCity', leg.arrCity);
  set('fArrAddr', leg.arrAddr);
  if (leg.arrTime) setDT('fArrDate', 'fArrTime', leg.arrTime);
  set('fTransport', leg.transport);
  set('fCompany', leg.company);
  set('fTransfers', leg.transfers);
  set('fTransfersInfo', leg.transfersInfo);
  set('fCost', leg.cost);
  set('fCur', leg.currency);
  bufHint();
  refreshConv('leg'); // recognised cost/currency — convert to the base currency
  // The recognised places are new text — locate them right away.
  for (const k of ['depCity', 'depAddr', 'arrCity', 'arrAddr'] as SlotKey[]) resolveSlot(k);
}

/** Resolve the active parser, walking the user to the LLM configuration when
 * none is usable yet. Returns `null` when still unconfigured. */
async function ensureParser(): Promise<ResolvedParser | null> {
  if (!settings.parsers.length) {
    await openParserSettings('llm');
    refreshParserCombo();
    if (!settings.parsers.length) return null;
  }
  const entry = settings.parsers[Math.min(Math.max(settings.activeParser, 0), settings.parsers.length - 1)];
  const parser = resolveParser(entry);
  if (!parser || !parser.apiKey) {
    alert('The selected parser has no account key — fill it in the LLM configuration.');
    await openParserSettings('llm');
    refreshParserCombo();
    return null;
  }
  return parser;
}

async function recognise(): Promise<void> {
  const parser = await ensureParser();
  if (!parser) return;
  const note = getVal('fNote');
  const files: File[] = [];
  for (const n of llmFileNotes()) {
    const f = await noteFile(n);
    if (f) files.push(f);
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
  if (h.checkIn) setDT('hInDate', 'hInTime', h.checkIn);
  if (h.checkOut) setDT('hOutDate', 'hOutTime', h.checkOut);
  set('hCost', h.cost);
  set('hCur', h.currency);
  refreshConv('hotel'); // recognised cost/currency — convert to the base currency
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
  loadNotes(r, P.files);
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
  setDT('fDepDate', 'fDepTime', r ? r.dep.time : P.depTime ?? '2026-05-01T12:00');
  setVal('fArrCity', r ? r.arr.city : P.arrCity ?? '');
  setVal('fArrAddr', r ? r.arr.addr : P.arrAddr ?? '');
  setDT('fArrDate', 'fArrTime', r ? r.arr.time : P.arrTime ?? '2026-05-01T14:00');
  const depTz = r ? r.dep.tz ?? '' : '';
  const arrTz = r ? r.arr.tz ?? '' : '';
  setVal('fDepTz', depTz); tzAuto.fDepTz = !depTz;
  setVal('fArrTz', arrTz); tzAuto.fArrTz = !arrTz;
  setVal('fTransport', r ? r.transport : P.transport ?? 'Plane');
  setVal('fCompany', r ? r.company : P.company ?? '');
  setVal('fTransfers', r ? r.transfers : P.transfers ?? 0);
  setVal('fTransfersInfo', r ? r.transfersInfo : P.transfersInfo ?? '');
  setVal('fCost', r ? r.cost : P.cost ?? '');
  initCurrency('leg', r ? r.currency : P.currency ?? settings.baseCurrency, r?.costConverted, !!r?.costConvertedManual);
  setVal('fNote', '');
  refreshParserCombo();
  bufHint();
  initPlaceSlots('depCity', 'depAddr', r ? r.dep.ll : null);
  initPlaceSlots('arrCity', 'arrAddr', r ? r.arr.ll : null);
  byId('overlay').classList.add('open');
  renderPreview();
  renderNotes();
}

/** Open the hotel dialog (new when `id` is null), optionally pre-filled. */
export function openHotelModal(id: string | null, prefill?: HotelPrefill): void {
  editingId = id || null;
  showBody('hotel');
  const P = prefill || {};
  newInPlan = P.inPlan === true;
  byId('delBtn').style.display = id ? 'inline-flex' : 'none';
  const h = (id ? findItem(id) : null) as Hotel | null;
  loadNotes(h, P.files);
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
  setDT('hInDate', 'hInTime', h ? h.checkIn : P.checkIn ?? '2026-05-01T15:00');
  setDT('hOutDate', 'hOutTime', h ? h.checkOut : P.checkOut ?? '2026-05-03T11:00');
  const hTz = h ? h.tz ?? '' : '';
  setVal('hTz', hTz); tzAuto.hTz = !hTz;
  setVal('hCost', h ? h.cost : P.cost ?? '');
  initCurrency('hotel', h ? h.currency : P.currency ?? settings.baseCurrency, h?.costConverted, !!h?.costConvertedManual);
  setVal('fNote', '');
  refreshParserCombo();
  initPlaceSlots('hotCity', 'hotAddr', h ? h.ll : null);
  byId('overlay').classList.add('open');
  renderPreview();
  renderNotes();
}

export function closeModal(): void {
  byId('overlay').classList.remove('open');
  notes = [];
  originalAttachments = new Set();
  renderPreview();
  renderNotes();
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
  // Store any pending files and drop blobs removed from the notes list.
  const savedNotes = await commitNotes();
  const segId = existing?.id ?? nextId();
  // Persist the exchange that filled this leg, next to the image. Awaited so
  // a reload right after Save cannot lose the write.
  if (dialogExchange) await putExchange(segId, dialogExchange);
  // Coordinates come from the dialog's explicit lookups (the chips); saving
  // never geocodes. Unresolved places save as null and stay off the map.
  const seg: Leg = {
    id: segId,
    kind: 'leg',
    dep: {
      city: dc, addr: getVal('fDepAddr'), time: getDT('fDepDate', 'fDepTime'),
      tz: getVal('fDepTz').trim() || undefined, ll: placeLl('depCity', 'depAddr'),
    },
    arr: {
      city: ac, addr: getVal('fArrAddr'), time: getDT('fArrDate', 'fArrTime'),
      tz: getVal('fArrTz').trim() || undefined, ll: placeLl('arrCity', 'arrAddr'),
    },
    transport: getVal('fTransport') as TransportKind,
    company: getVal('fCompany'),
    transfers: Math.max(0, Math.round(Number(getVal('fTransfers') || 0))),
    transfersInfo: getVal('fTransfersInfo').trim(),
    cost: Number(getVal('fCost') || 0),
    currency: getVal('fCur') as CurrencyCode,
    ...readConverted('leg'),
    notes: savedNotes,
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
    const savedNotes = await commitNotes();
    const hotelId = existing?.id ?? nextId();
    if (dialogExchange) await putExchange(hotelId, dialogExchange);
    const h: Hotel = {
      id: hotelId,
      kind: 'hotel',
      name,
      city,
      addr: getVal('hAddr'),
      checkIn: getDT('hInDate', 'hInTime'),
      checkOut: getDT('hOutDate', 'hOutTime'),
      tz: getVal('hTz').trim() || undefined,
      cost: Number(getVal('hCost') || 0),
      currency: getVal('hCur') as CurrencyCode,
      ...readConverted('hotel'),
      notes: savedNotes,
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
  // Populate the inline time-zone combos once (blank "auto" + every IANA zone,
  // labelled with its GMT offset and ordered by offset); picking one opts it out
  // of auto-fill so a later geocode can't overwrite it.
  const zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] })
    .supportedValuesOf?.('timeZone') ?? [];
  const sorted = zones
    .map((z) => ({ z, ...tzOffset(z) }))
    .sort((a, b) => a.minutes - b.minutes || a.z.localeCompare(b.z));
  const tzOptions = '<option value="">auto</option>'
    + sorted.map(({ z, label }) => `<option value="${z}">${label} · ${z}</option>`).join('');
  for (const id of ['fDepTz', 'fArrTz', 'hTz']) {
    byId(id).innerHTML = tzOptions;
    byId(id).addEventListener('change', () => { tzAuto[id] = false; });
  }
  // Converted cost: editing the cost or currency re-converts (unless the user
  // typed their own value); the chip forces a fresh conversion.
  byId('fCost').addEventListener('input', () => refreshConv('leg'));
  byId('hCost').addEventListener('input', () => refreshConv('hotel'));
  byId('fCur').addEventListener('change', () => refreshConv('leg'));
  byId('hCur').addEventListener('change', () => refreshConv('hotel'));
  byId('fCostConv').addEventListener('input', () => { convManual.fCostConv = true; renderConvChip('fConvChip', 'manual'); });
  byId('hCostConv').addEventListener('input', () => { convManual.hCostConv = true; renderConvChip('hConvChip', 'manual'); });
  byId('fConvChip').onclick = (e) => { e.preventDefault(); refreshConv('leg', { force: true }); };
  byId('hConvChip').onclick = (e) => { e.preventDefault(); refreshConv('hotel', { force: true }); };
  byId('mtabForm').onclick = () => {
    activeTab = 'form';
    applyTabs();
  };
  byId('mtabRecognize').onclick = () => {
    activeTab = 'rec';
    applyTabs();
  };
  byId('mtabNotes').onclick = () => {
    activeTab = 'notes';
    applyTabs();
  };
  // Notes tab: add a user file, or a user text/link note.
  byId('noteAddFileBtn').onclick = () => byId<HTMLInputElement>('noteFile').click();
  byId<HTMLInputElement>('noteFile').onchange = (e) => {
    const input = e.target as HTMLInputElement;
    const fs = input.files ? [...input.files] : [];
    input.value = '';
    if (fs.length) addUserFiles(fs);
  };
  const addText = (): void => {
    addUserText(getVal('noteText'));
    setVal('noteText', '');
  };
  byId('noteAddTextBtn').onclick = addText;
  byId('noteText').addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') {
      e.preventDefault();
      addText();
    }
  });
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
    if (fs.length) addRecognizeFiles(fs);
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
    if (fs?.length) addRecognizeFiles(fs);
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
      // make the pasted images visible right away on the Recognize tab
      activeTab = 'rec';
      addRecognizeFiles(imgs);
    } else if (!document.querySelector('.overlay.open') && byId('importBusy').style.display !== 'flex') {
      e.preventDefault();
      void importPastedImage(imgs[0]);
    }
  });
  byId('recogniseBtn').onclick = () => void recognise();
  byId('cfgParsersBtn').onclick = async () => {
    await openParserSettings('llm');
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
