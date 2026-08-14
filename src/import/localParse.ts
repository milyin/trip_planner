import type { AutoExtract, ExtractedHotel, ExtractedLeg } from './extractor';

interface DatedTime {
  line: number;
  hour: number;
  minute: number;
  start: number;
  end: number;
}

interface ParsedDate {
  line: number;
  value: Date;
}

/** Common full and abbreviated month names seen on international booking
 * screens. Strings are accent-folded before lookup, so e.g. `juil.`, `März`,
 * `févr.` and `września` work without relying on the browser locale. */
const MONTH_NAMES: readonly string[][] = [
  ['jan', 'january', 'janv', 'janvier', 'januar', 'enero', 'ene', 'gennaio', 'gen', 'janeiro', 'januari', 'sty', 'stycznia', 'ian', 'ianuarie', 'ocak', 'янв', 'января'],
  ['feb', 'february', 'fev', 'fevr', 'fevrier', 'februar', 'febrero', 'febbraio', 'fevereiro', 'lut', 'lutego', 'februarie', 'subat', 'фев', 'февраля'],
  ['mar', 'march', 'mars', 'marz', 'maerz', 'marzo', 'marco', 'maart', 'marca', 'martie', 'mart', 'март', 'марта'],
  ['apr', 'april', 'avr', 'avril', 'abril', 'aprile', 'kwiecien', 'kwietnia', 'kwi', 'aprilie', 'nisan', 'апр', 'апреля'],
  ['may', 'mai', 'mayo', 'maggio', 'mag', 'maio', 'mei', 'maj', 'maja', 'mayis', 'май', 'мая'],
  ['jun', 'june', 'juin', 'juni', 'junio', 'giugno', 'giu', 'junho', 'cze', 'czerwca', 'iun', 'iunie', 'haziran', 'июн', 'июня'],
  ['jul', 'july', 'juil', 'juillet', 'juli', 'julio', 'lug', 'luglio', 'julho', 'lip', 'lipca', 'iul', 'iulie', 'temmuz', 'июл', 'июля'],
  ['aug', 'august', 'aout', 'agosto', 'ago', 'augustus', 'sie', 'sierpnia', 'agustos', 'авг', 'августа'],
  ['sep', 'sept', 'september', 'septembre', 'septiembre', 'set', 'settembre', 'setembro', 'wrz', 'wrzesnia', 'septembrie', 'eylul', 'сен', 'сентября'],
  ['oct', 'october', 'octobre', 'okt', 'oktober', 'octubre', 'ott', 'ottobre', 'out', 'outubro', 'paz', 'pazdziernika', 'octombrie', 'ekim', 'окт', 'октября'],
  ['nov', 'november', 'novembre', 'noviembre', 'listopada', 'lis', 'noiembrie', 'kasim', 'ноя', 'ноября'],
  ['dec', 'december', 'decembre', 'dez', 'dezember', 'dic', 'diciembre', 'dicembre', 'dezembro', 'gru', 'grudnia', 'decembrie', 'aralik', 'дек', 'декабря'],
];

const MONTHS = Object.fromEntries(
  MONTH_NAMES.flatMap((names, month) => names.map((name) => [name, month])),
) as Record<string, number>;

const clean = (s: string): string => s.replace(/[|]+/g, ' ').replace(/\s+/g, ' ').trim();
const folded = (s: string): string => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const pad = (n: number): string => String(n).padStart(2, '0');

const CURRENCIES: Record<string, string> = {
  '€': 'EUR', eur: 'EUR', euro: 'EUR', euros: 'EUR',
  '$': 'USD', usd: 'USD', dollar: 'USD', dollars: 'USD', 'us dollar': 'USD', 'us dollars': 'USD',
  '£': 'GBP', gbp: 'GBP', pound: 'GBP', pounds: 'GBP', sterling: 'GBP', 'british pound': 'GBP', 'british pounds': 'GBP',
  '¥': 'JPY', jpy: 'JPY', yen: 'JPY',
  chf: 'CHF', franc: 'CHF', francs: 'CHF', 'swiss franc': 'CHF', 'swiss francs': 'CHF',
  cad: 'CAD', 'canadian dollar': 'CAD', 'canadian dollars': 'CAD',
  aud: 'AUD', 'australian dollar': 'AUD', 'australian dollars': 'AUD',
  '₽': 'RUB', rub: 'RUB', ruble: 'RUB', rubles: 'RUB', rouble: 'RUB', roubles: 'RUB',
  'russian ruble': 'RUB', 'russian rubles': 'RUB', 'руб': 'RUB', 'рубль': 'RUB', 'рубля': 'RUB', 'рублей': 'RUB',
  cny: 'CNY', rmb: 'CNY', yuan: 'CNY', renminbi: 'CNY',
  inr: 'INR', rupee: 'INR', rupees: 'INR',
  krw: 'KRW', won: 'KRW',
  try: 'TRY', lira: 'TRY',
  pln: 'PLN', zloty: 'PLN',
  sek: 'SEK', krona: 'SEK',
  nok: 'NOK', dkk: 'DKK', krone: 'NOK', kroner: 'NOK',
  czk: 'CZK', koruna: 'CZK', koruny: 'CZK',
};

const CURRENCY_SOURCE = Object.keys(CURRENCIES)
  .sort((a, b) => b.length - a.length)
  .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');

const AMOUNT_SOURCE = String.raw`\d(?:[\d\s.,]*\d)?`;

function pricePatterns(): RegExp[] {
  return [
    new RegExp(`(?:^|[^\\p{L}\\d])(${CURRENCY_SOURCE})\\s*(${AMOUNT_SOURCE})(?![\\d.,])`, 'giu'),
    new RegExp(`(?:^|[^\\p{L}\\d])(${AMOUNT_SOURCE})\\s*(${CURRENCY_SOURCE})(?=\\s|$|[.,;:!?])`, 'giu'),
  ];
}

const maskMatch = (match: string): string => ' '.repeat(match.length);

/** Preserve character offsets while hiding complete numeric dates from the
 * clock parser. A two-part dot token stays visible because `18.30` is a common
 * clock; dot-separated dates need an explicit year to be unambiguous. */
function maskNumericDates(line: string): string {
  return line
    .replace(/\b20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}\b/g, maskMatch)
    .replace(/(?<!\d)\d{1,2}[/-]\d{1,2}(?:[/-](?:20)?\d{2})?(?!\d)/g, maskMatch)
    .replace(/(?<!\d)\d{1,2}\.\d{1,2}\.(?:20)?\d{2}(?!\d)/g, maskMatch);
}

function maskPrices(line: string): string {
  let masked = line;
  for (const pattern of pricePatterns()) masked = masked.replace(pattern, maskMatch);
  return masked;
}

/** Normalize decimal and thousands separators. When both occur, the last one
 * is decimal; a lone three-digit group is treated as a thousands separator. */
function parseAmount(raw: string): number | null {
  const compact = raw.replace(/\s/g, '');
  const separators = [...compact.matchAll(/[.,]/g)].map((m) => m.index ?? 0);
  let normalized = compact;
  if (separators.length) {
    const decimal = separators[separators.length - 1];
    const fractionLength = compact.length - decimal - 1;
    const hasBoth = compact.includes('.') && compact.includes(',');
    const isGroupedThousands = !hasBoth && fractionLength === 3;
    normalized = isGroupedThousands
      ? compact.replace(/[.,]/g, '')
      : compact.slice(0, decimal).replace(/[.,]/g, '') + '.' + compact.slice(decimal + 1);
  }
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

function futureYear(month: number, day: number, now: Date): number {
  const year = now.getFullYear();
  const candidate = new Date(year, month, day, 23, 59);
  return candidate < now ? year + 1 : year;
}

function validDate(year: number, month: number, day: number): Date | null {
  const d = new Date(year, month, day);
  return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day ? d : null;
}

function datesIn(lines: string[], now: Date): ParsedDate[] {
  const out: ParsedDate[] = [];
  const seen = new Set<string>();
  const add = (line: number, year: number | undefined, month: number, day: number): void => {
    const y = year ?? futureYear(month, day, now);
    const value = validDate(y, month, day);
    const key = `${line}:${y}-${month}-${day}`;
    if (value && !seen.has(key)) {
      seen.add(key);
      out.push({ line, value });
    }
  };

  lines.forEach((line, lineN) => {
    for (const m of line.matchAll(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/g)) {
      add(lineN, Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    }
    const withoutIso = line.replace(/\b20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}\b/g, maskMatch);
    for (const m of withoutIso.matchAll(/(?<!\d)(\d{1,2})[/-](\d{1,2})(?:[/-](20\d{2}|\d{2}))?(?!\d)/g)) {
      const rawYear = m[3] ? Number(m[3]) : undefined;
      add(lineN, rawYear == null ? undefined : rawYear < 100 ? 2000 + rawYear : rawYear, Number(m[2]) - 1, Number(m[1]));
    }
    for (const m of withoutIso.matchAll(/(?<!\d)(\d{1,2})\.(\d{1,2})\.(20\d{2}|\d{2})(?!\d)/g)) {
      const rawYear = Number(m[3]);
      add(lineN, rawYear < 100 ? 2000 + rawYear : rawYear, Number(m[2]) - 1, Number(m[1]));
    }
    const f = folded(line);
    for (const m of f.matchAll(/(?:^|[^\p{L}\d])(\d{1,2})\s+([\p{L}]+)\.?\s*(20\d{2})?(?=$|[^\p{L}\d])/gu)) {
      const month = MONTHS[m[2]];
      if (month != null) add(lineN, m[3] ? Number(m[3]) : undefined, month, Number(m[1]));
    }
    for (const m of f.matchAll(/(?:^|[^\p{L}\d])([\p{L}]+)\.?\s+(\d{1,2})(?:,?\s*(20\d{2}))?(?=$|[^\p{L}\d])/gu)) {
      const month = MONTHS[m[1]];
      if (month != null) add(lineN, m[3] ? Number(m[3]) : undefined, month, Number(m[2]));
    }
  });
  return out;
}

function timesIn(lines: string[]): DatedTime[] {
  const out: DatedTime[] = [];
  lines.forEach((line, lineN) => {
    if (/\b(duration|travel time|journey time)\b/i.test(line)) return;
    const withoutDates = maskNumericDates(maskPrices(line));
    for (const m of withoutDates.matchAll(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\s*(am|pm)?\b/gi)) {
      let hour = Number(m[1]);
      const suffix = m[3]?.toLowerCase();
      if (suffix === 'pm' && hour < 12) hour += 12;
      if (suffix === 'am' && hour === 12) hour = 0;
      const start = m.index ?? 0;
      out.push({ line: lineN, hour, minute: Number(m[2]), start, end: start + m[0].length });
    }
  });
  return out;
}

function closestDate(time: DatedTime, dates: ParsedDate[], fallback?: ParsedDate): Date | null {
  let best: ParsedDate | undefined;
  let distance = Infinity;
  for (const date of dates) {
    const d = Math.abs(date.line - time.line);
    if (d < distance) {
      best = date;
      distance = d;
    }
  }
  return (distance <= 5 ? best : fallback)?.value ?? null;
}

function datetime(date: Date, time: DatedTime): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(time.hour)}:${pad(time.minute)}`;
}

const GENERIC_LINE = /^(from|to|departure|arrival|depart|arrivee?|outbound|inbound|details?|summary|booking|passengers?|adults?|change|direct|non.?stop)$/i;

function locationCandidate(line: string): string | null {
  const value = clean(maskPrices(line)
    .replace(/\b(?:[01]?\d|2[0-3])[:.]([0-5]\d)\s*(?:am|pm)?\b/gi, '')
    .replace(/\b20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}\b/g, '')
    .replace(/\b\d{1,2}[/.\-]\d{1,2}(?:[/.\-](?:20)?\d{2})?\b/g, '')
    .replace(/\b\d{1,2}\s+(?:jan(?:uary|vier)?|feb(?:ruary)?|fev(?:rier)?|mar(?:ch|s)?|apr(?:il)?|avr(?:il)?|may|mai|jun(?:e|in)?|jul(?:y|let)?|aug(?:ust)?|aout|sep(?:t(?:ember|embre)?)?|oct(?:ober|obre)?|nov(?:ember|embre)?|dec(?:ember|embre)?)\.?\s*(?:20\d{2})?\b/gi, '')
    .replace(/^[\s·•—–-]+|[\s·•—–-]+$/g, ''));
  if (!value || value.length < 2 || value.length > 70 || GENERIC_LINE.test(value)) return null;
  if (/\b(check.?in|check.?out|price|total|fare|duration|travell?ers?|class|seat|night|room)\b/i.test(value)) return null;
  if (/^\d+$/.test(value) || /^(?:mon|tue|wed|thu|fri|sat|sun)/i.test(value)) return null;
  if (!/[A-Za-zÀ-ž]/.test(value)) return null;
  return value;
}

function routeFrom(lines: string[]): [string, string] | null {
  for (const line of lines) {
    let m = line.match(/\bfrom\s+(.+?)\s+to\s+(.+?)(?:\s{2,}|$)/i);
    if (!m) m = line.match(/^(.{2,50}?)\s*(?:→|->|➜|⟶)\s*(.{2,50})$/);
    if (m) {
      const from = locationCandidate(m[1]);
      const to = locationCandidate(m[2]);
      if (from && to) return [from, to];
    }
  }
  return null;
}

/** Booking/search UIs often put both times and places on one visual row. Text
 * export preserves reading order but not field boundaries, so use the time
 * positions as anchors and trim common UI text from the following chunks. */
function routeFollowingTimes(lines: string[], departure: DatedTime, arrival: DatedTime): [string, string] | null {
  if (departure.line !== arrival.line) return null;
  const line = lines[departure.line];
  if (!line) return null;
  const trimUi = (value: string): string => clean(value)
    .split(/[©®|]/, 1)[0]
    .split(/\b(?:details?|d[eé]tails?|duration|dur[eé]e|correspondance|connection|change|transfer|total|fare|price)\b/i, 1)[0]
    .replace(/^[\s·•—–→>-]+|[\s·•—–→>-]+$/g, '');
  const dep = locationCandidate(trimUi(line.slice(departure.end, arrival.start)));
  const arr = locationCandidate(trimUi(line.slice(arrival.end)));
  return dep && arr ? [dep, arr] : null;
}

function nearbyLocation(lines: string[], lineN: number, used?: string): string | null {
  for (const offset of [0, -1, 1, -2, 2, -3, 3]) {
    const candidate = lines[lineN + offset] && locationCandidate(lines[lineN + offset]);
    if (candidate && candidate !== used) return candidate;
  }
  return null;
}

function applyLocation(leg: ExtractedLeg, side: 'dep' | 'arr', raw: string): void {
  const value = clean(raw.replace(/^(?:from|to|departure|arrival|depart|arrivee?)\s*:?\s*/i, ''));
  const paren = value.match(/^(.+?)\s*\(([A-Z]{3})\)$/);
  const airport = value.match(/\b([A-Z]{3})\b/);
  const station = value.match(/^(.+?)\s+(?=(?:gare|station|airport|aeroport|terminal|hbf|central|st[.-]))/i);
  const city = (paren?.[1] ?? station?.[1] ?? (!airport || value.length > 3 ? value : undefined))
    ?.replace(/[\s·•—–-]+$/g, '');
  const addr = paren?.[2] ?? (airport && value.length <= 5 ? airport[1] : station ? value : undefined);
  if (side === 'dep') {
    if (city) leg.depCity = city;
    if (addr) leg.depAddr = addr;
  } else {
    if (city) leg.arrCity = city;
    if (addr) leg.arrAddr = addr;
  }
}

function priceIn(text: string): { cost: number; currency: string } | null {
  const candidates: { cost: number; currency: string; priority: number }[] = [];
  const currencyFor = (token: string): string => {
    const normalized = token.toLowerCase().replace(/\s+/g, ' ').trim();
    return CURRENCIES[normalized] ?? CURRENCIES[folded(normalized)] ?? token.toUpperCase();
  };
  text.split('\n').forEach((line) => {
    const priority = /\b(total|price|fare|amount|cost)\b/i.test(line) ? 1 : 0;
    const patterns = pricePatterns();
    for (const [index, pattern] of patterns.entries()) {
      for (const m of line.matchAll(pattern)) {
        const amount = index === 0 ? m[2] : m[1];
        const currency = index === 0 ? m[1] : m[2];
        const cost = parseAmount(amount);
        if (cost != null) candidates.push({ cost, currency: currencyFor(currency), priority });
      }
    }
  });
  candidates.sort((a, b) => b.priority - a.priority);
  return candidates[0] ?? null;
}

function transportIn(text: string): ExtractedLeg['transport'] {
  if (/\b(flight|airline|boarding|gate)\b/i.test(text)) return 'Plane';
  if (/\b(train|rail|gare|station|tgv|ter|sncf|eurostar)\b/i.test(text)) return 'Train';
  if (/\b(bus|coach|flixbus)\b/i.test(text)) return 'Bus';
  if (/\b(airport|terminal)\b/i.test(text)) return 'Plane';
  if (/\b(taxi|cab)\b/i.test(text)) return 'Taxi';
  if (/\b(car|rental|drive)\b/i.test(text)) return 'Car';
  return 'Other';
}

/** Convert OCR text into one transport leg. Reliable partial fields are kept;
 * only text without enough independent trip signals is rejected. */
export function parseLocalLeg(text: string, note = '', now = new Date()): ExtractedLeg | null {
  const lines = text.split(/\r?\n/).map(clean).filter(Boolean);
  const noteLines = note.split(/\r?\n/).map(clean).filter(Boolean);
  const combinedLines = [...lines, ...noteLines];
  const noteDates = datesIn(noteLines, now).map((date) => ({ ...date, line: date.line + lines.length }));
  // An explicit date in Additional note clarifies or corrects the OCR date.
  const dates = noteDates.length ? noteDates : datesIn(lines, now);
  let times = timesIn(lines);
  const requestedTime = note.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/);
  let selectedByNote = false;
  if (requestedTime) {
    const preferred = times.findIndex((t) => t.hour === Number(requestedTime[1]) && t.minute === Number(requestedTime[2]));
    if (preferred >= 0) {
      times = times.slice(preferred, preferred + 2);
      selectedByNote = true;
    }
  }
  // More than one pair usually means alternatives or connecting legs. Without
  // an explicit requested departure, let the LLM fallback interpret layout
  // instead of silently choosing the wrong itinerary.
  if (!selectedByNote && times.length > 2) return null;
  // Additional note can also supply clocks that OCR missed. Do not duplicate a
  // clock already found in the image (the common "the 20:09 train" selector).
  if (times.length < 2 && noteLines.length) {
    const noteTimes = timesIn(noteLines).map((time) => ({ ...time, line: time.line + lines.length }));
    for (const time of noteTimes) {
      if (!times.some((found) => found.hour === time.hour && found.minute === time.minute)) times.push(time);
      if (times.length === 2) break;
    }
  }
  const [departure, arrival] = times;
  const hasTimePair = !!departure && !!arrival;
  const noteTransport = transportIn(note);
  const leg: ExtractedLeg = {
    transport: noteTransport !== 'Other' ? noteTransport : transportIn(text),
  };
  if (hasTimePair) {
    const depDate = closestDate(departure, dates, dates[0]);
    let arrDate = closestDate(arrival, dates, dates[1] ?? dates[0]);
    if (depDate && arrDate) {
      if (arrDate.getTime() === depDate.getTime()
          && arrival.hour * 60 + arrival.minute < departure.hour * 60 + departure.minute) {
        arrDate = new Date(arrDate);
        arrDate.setDate(arrDate.getDate() + 1);
      }
      leg.depTime = datetime(depDate, departure);
      leg.arrTime = datetime(arrDate, arrival);
    } else {
      // Keep the useful clocks but leave the dates visibly blank in the form.
      leg.depClock = `${pad(departure.hour)}:${pad(departure.minute)}`;
      leg.arrClock = `${pad(arrival.hour)}:${pad(arrival.minute)}`;
    }
  }

  const route = routeFrom(noteLines) ?? routeFrom(lines)
    ?? (hasTimePair ? routeFollowingTimes(combinedLines, departure, arrival) : null);
  const depLoc = route?.[0] ?? (departure ? nearbyLocation(combinedLines, departure.line) : null);
  const arrLoc = route?.[1] ?? (arrival ? nearbyLocation(combinedLines, arrival.line, depLoc ?? undefined) : null);
  if (depLoc && arrLoc) {
    applyLocation(leg, 'dep', depLoc);
    applyLocation(leg, 'arr', arrLoc);
  }

  const price = priceIn(note) ?? priceIn(text);
  if (price) {
    leg.cost = price.cost;
    leg.currency = price.currency;
  }
  const combinedText = `${text}\n${note}`;
  if (/\b(direct|non.?stop)\b/i.test(combinedText)) leg.transfers = 0;
  else {
    const stops = combinedText.match(/\b(\d+)\s+(?:stop|change|transfer|connection)s?\b/i);
    if (stops) leg.transfers = Number(stops[1]);
  }
  // Keep useful route-shaped output while rejecting isolated weak matches.
  const hasTimes = !!(leg.depClock || leg.depTime) && !!(leg.arrClock || leg.arrTime);
  const hasRoute = !!leg.depCity && !!leg.arrCity;
  const hasPrice = leg.cost != null && !!leg.currency;
  const hasMode = leg.transport !== 'Other';
  // A route pair is independently useful. Otherwise require two clocks plus
  // corroboration, so an isolated advertisement such as “train from €20” does
  // not suppress the automatic fallback.
  return hasRoute || (hasTimes && (hasPrice || hasMode)) ? leg : null;
}

/** User-facing fields that local recognition could not extract. Clocks are
 * reported separately from dates so a useful OCR time is not called missing. */
export function localLegMissingFields(leg: ExtractedLeg): string[] {
  const missing: string[] = [];
  if (!leg.depCity) missing.push('departure city');
  if (!leg.depTime) missing.push(leg.depClock ? 'departure date' : 'departure date and time');
  if (!leg.arrCity) missing.push('arrival city');
  if (!leg.arrTime) missing.push(leg.arrClock ? 'arrival date' : 'arrival date and time');
  if (leg.cost == null) missing.push('cost');
  else if (!leg.currency) missing.push('currency');
  return missing;
}

export const localLegComplete = (leg: ExtractedLeg): boolean => localLegMissingFields(leg).length === 0;

/** Convert OCR text into a hotel stay when dates and a recognizable name are present. */
export function parseLocalHotel(text: string, now = new Date()): ExtractedHotel | null {
  const lines = text.split(/\r?\n/).map(clean).filter(Boolean);
  const dates = datesIn(lines, now);
  const nameLine = lines.find((line) => /\b(hotel|hostel|resort|apart(?:ment|hotel))\b/i.test(line)
    && !/\b(search|results?|booking|details?|check.?in|check.?out)\b/i.test(line));
  const hotel: ExtractedHotel = {};
  if (nameLine) hotel.name = nameLine;
  const nearestLabeledDate = (label: RegExp, exclude?: ParsedDate): ParsedDate | undefined => {
    const labelLines = lines.flatMap((line, index) => label.test(line) ? [index] : []);
    return dates.filter((date) => date !== exclude)
      .flatMap((date) => labelLines.map((line) => ({
        date,
        distance: Math.abs(line - date.line),
        // When equally near, a date following a standalone label is more
        // likely to belong to it than a preceding booking/cancellation date.
        precedesLabel: date.line < line,
      })))
      .filter(({ distance }) => Number.isFinite(distance) && distance <= 2)
      .sort((a, b) => a.distance - b.distance || Number(a.precedesLabel) - Number(b.precedesLabel))[0]?.date;
  };
  const labeledIn = nearestLabeledDate(/\b(check[ -]?in|arrival|arrivee?|entree)\b/i);
  const labeledOut = nearestLabeledDate(/\b(check[ -]?out|departure|depart|sortie)\b/i, labeledIn);
  const checkIn = labeledIn ?? (dates.length === 2 ? dates[0] : undefined);
  const checkOut = labeledOut ?? (dates.length === 2 ? dates[1] : undefined);
  const dateOnly = (date: Date): string => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  if (checkIn) hotel.checkInDate = dateOnly(checkIn.value);
  if (checkOut && (!checkIn || checkOut.value > checkIn.value)) hotel.checkOutDate = dateOnly(checkOut.value);
  const cityLine = lines.find((line) => /\b(?:city|ville|ciudad|citt[aà]|cidade)\s*[:\-]/i.test(line));
  if (cityLine) hotel.city = clean(cityLine.replace(/^.*?\b(?:city|ville|ciudad|citt[aà]|cidade)\s*[:\-]\s*/i, ''));
  const address = lines.find((line) => /\b\d{1,5}\s+.+\b(street|st\.?|road|rd\.?|avenue|ave\.?|rue|boulevard|blvd|place|platz|via)\b/i.test(line));
  if (address) hotel.addr = address;
  const price = priceIn(text);
  if (price) {
    hotel.cost = price.cost;
    hotel.currency = price.currency;
  }
  const signals = [!!hotel.name, !!hotel.checkInDate, !!hotel.city, !!hotel.addr, hotel.cost != null && !!hotel.currency]
    .filter(Boolean).length;
  return signals >= 2 ? hotel : null;
}

export function localHotelMissingFields(hotel: ExtractedHotel): string[] {
  const missing: string[] = [];
  if (!hotel.name) missing.push('hotel name');
  if (!hotel.city) missing.push('city');
  if (!hotel.checkIn) missing.push(hotel.checkInDate ? 'check-in time' : 'check-in date and time');
  if (!hotel.checkOut) missing.push(hotel.checkOutDate ? 'check-out time' : 'check-out date and time');
  return missing;
}

export const localHotelComplete = (hotel: ExtractedHotel): boolean => localHotelMissingFields(hotel).length === 0;

export function parseLocalAuto(text: string, note = '', now = new Date()): AutoExtract | null {
  const looksHotel = /\b(check.?in|check.?out|nights?|rooms?|hotel|hostel|resort)\b/i.test(text);
  if (looksHotel) {
    const hotel = parseLocalHotel(text, now);
    if (hotel) return { hotel };
  }
  const leg = parseLocalLeg(text, note, now);
  return leg ? { legs: [leg] } : null;
}
