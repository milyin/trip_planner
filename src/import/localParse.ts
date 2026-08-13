import type { AutoExtract, ExtractedHotel, ExtractedLeg } from './extractor';

interface DatedTime {
  line: number;
  hour: number;
  minute: number;
}

interface ParsedDate {
  line: number;
  value: Date;
}

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, janvier: 0,
  feb: 1, february: 1, fev: 1, fevrier: 1,
  mar: 2, march: 2, mars: 2,
  apr: 3, april: 3, avr: 3, avril: 3,
  may: 4, mai: 4,
  jun: 5, june: 5, juin: 5,
  jul: 6, july: 6, juillet: 6,
  aug: 7, august: 7, aout: 7,
  sep: 8, sept: 8, september: 8, septembre: 8,
  oct: 9, october: 9, octobre: 9,
  nov: 10, november: 10, novembre: 10,
  dec: 11, december: 11, decembre: 11,
};

const clean = (s: string): string => s.replace(/[|]+/g, ' ').replace(/\s+/g, ' ').trim();
const folded = (s: string): string => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const pad = (n: number): string => String(n).padStart(2, '0');

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
    for (const m of line.matchAll(/\b(\d{1,2})[/.\-](\d{1,2})(?:[/.\-](20\d{2}|\d{2}))?\b/g)) {
      if (m[0].includes(':') || /^20\d{2}-/.test(m[0])) continue;
      const rawYear = m[3] ? Number(m[3]) : undefined;
      add(lineN, rawYear == null ? undefined : rawYear < 100 ? 2000 + rawYear : rawYear, Number(m[2]) - 1, Number(m[1]));
    }
    const f = folded(line);
    for (const m of f.matchAll(/\b(\d{1,2})\s+([a-z]+)\.?\s*(20\d{2})?\b/g)) {
      const month = MONTHS[m[2].slice(0, 3)] ?? MONTHS[m[2]];
      if (month != null) add(lineN, m[3] ? Number(m[3]) : undefined, month, Number(m[1]));
    }
    for (const m of f.matchAll(/\b([a-z]+)\.?\s+(\d{1,2})(?:,?\s*(20\d{2}))?\b/g)) {
      const month = MONTHS[m[1].slice(0, 3)] ?? MONTHS[m[1]];
      if (month != null) add(lineN, m[3] ? Number(m[3]) : undefined, month, Number(m[2]));
    }
  });
  return out;
}

function timesIn(lines: string[]): DatedTime[] {
  const out: DatedTime[] = [];
  lines.forEach((line, lineN) => {
    if (/\b(duration|travel time|journey time)\b/i.test(line)) return;
    const withoutDates = line
      .replace(/\b20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}\b/g, '')
      .replace(/\b\d{1,2}[/.\-]\d{1,2}(?:[/.\-](?:20)?\d{2})?\b/g, '');
    for (const m of withoutDates.matchAll(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\s*(am|pm)?\b/gi)) {
      let hour = Number(m[1]);
      const suffix = m[3]?.toLowerCase();
      if (suffix === 'pm' && hour < 12) hour += 12;
      if (suffix === 'am' && hour === 12) hour = 0;
      out.push({ line: lineN, hour, minute: Number(m[2]) });
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
  const value = clean(line)
    .replace(/\b(?:[01]?\d|2[0-3])[:.]([0-5]\d)\s*(?:am|pm)?\b/gi, '')
    .replace(/\b20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}\b/g, '')
    .replace(/\b\d{1,2}[/.\-]\d{1,2}(?:[/.\-](?:20)?\d{2})?\b/g, '')
    .replace(/\b\d{1,2}\s+(?:jan(?:uary|vier)?|feb(?:ruary)?|fev(?:rier)?|mar(?:ch|s)?|apr(?:il)?|avr(?:il)?|may|mai|jun(?:e|in)?|jul(?:y|let)?|aug(?:ust)?|aout|sep(?:t(?:ember|embre)?)?|oct(?:ober|obre)?|nov(?:ember|embre)?|dec(?:ember|embre)?)\.?\s*(?:20\d{2})?\b/gi, '')
    .replace(/(?:€|£|\$|¥)\s*\d[\d\s.,]*|\b\d[\d\s.,]*\s*(?:EUR|USD|GBP|JPY|CHF|CAD|AUD)\b/gi, '')
    .replace(/^[\s·•—–-]+|[\s·•—–-]+$/g, '');
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
  const city = paren?.[1] ?? station?.[1] ?? (!airport || value.length > 3 ? value : undefined);
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
  const currencyFor = (token: string): string => ({ '€': 'EUR', '£': 'GBP', '$': 'USD', '¥': 'JPY' })[token] ?? token.toUpperCase();
  text.split('\n').forEach((line) => {
    const priority = /\b(total|price|fare|amount|cost)\b/i.test(line) ? 1 : 0;
    const patterns = [
      /(?:^|\s)(EUR|USD|GBP|JPY|CHF|CAD|AUD|€|£|\$|¥)\s*([\d][\d\s]*(?:[.,]\d{1,2})?)/gi,
      /(?:^|\s)([\d][\d\s]*(?:[.,]\d{1,2})?)\s*(EUR|USD|GBP|JPY|CHF|CAD|AUD|€|£|\$|¥)\b/gi,
    ];
    for (const [index, pattern] of patterns.entries()) {
      for (const m of line.matchAll(pattern)) {
        const amount = index === 0 ? m[2] : m[1];
        const currency = index === 0 ? m[1] : m[2];
        const cost = Number(amount.replace(/\s/g, '').replace(',', '.'));
        if (Number.isFinite(cost)) candidates.push({ cost, currency: currencyFor(currency), priority });
      }
    }
  });
  candidates.sort((a, b) => b.priority - a.priority);
  return candidates[0] ?? null;
}

function transportIn(text: string): ExtractedLeg['transport'] {
  if (/\b(flight|airline|airport|boarding|terminal|gate)\b/i.test(text)) return 'Plane';
  if (/\b(train|rail|gare|station|tgv|ter|sncf|eurostar)\b/i.test(text)) return 'Train';
  if (/\b(bus|coach|flixbus)\b/i.test(text)) return 'Bus';
  if (/\b(taxi|cab)\b/i.test(text)) return 'Taxi';
  if (/\b(car|rental|drive)\b/i.test(text)) return 'Car';
  return 'Other';
}

/** Convert OCR text into one transport leg when the core fields are unambiguous. */
export function parseLocalLeg(text: string, note = '', now = new Date()): ExtractedLeg | null {
  const lines = text.split(/\r?\n/).map(clean).filter(Boolean);
  const dates = datesIn(lines, now);
  let times = timesIn(lines);
  const requestedTime = note.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/);
  if (requestedTime) {
    const preferred = times.findIndex((t) => t.hour === Number(requestedTime[1]) && t.minute === Number(requestedTime[2]));
    if (preferred >= 0) times = times.slice(preferred);
  }
  // More than one pair usually means alternatives or connecting legs. Without
  // an explicit requested departure, let the LLM fallback interpret layout
  // instead of silently choosing the wrong itinerary.
  if (!requestedTime && times.length !== 2) return null;
  if (times.length < 2 || !dates.length) return null;

  const [departure, arrival] = times;
  const depDate = closestDate(departure, dates, dates[0]);
  let arrDate = closestDate(arrival, dates, dates[1] ?? dates[0]);
  if (!depDate || !arrDate) return null;
  if (arrDate.getTime() === depDate.getTime()
      && arrival.hour * 60 + arrival.minute < departure.hour * 60 + departure.minute) {
    arrDate = new Date(arrDate);
    arrDate.setDate(arrDate.getDate() + 1);
  }

  const leg: ExtractedLeg = {
    depTime: datetime(depDate, departure),
    arrTime: datetime(arrDate, arrival),
    transport: transportIn(text),
  };
  const route = routeFrom(lines);
  const depLoc = route?.[0] ?? nearbyLocation(lines, departure.line);
  const arrLoc = route?.[1] ?? nearbyLocation(lines, arrival.line, depLoc ?? undefined);
  if (!depLoc || !arrLoc) return null;
  applyLocation(leg, 'dep', depLoc);
  applyLocation(leg, 'arr', arrLoc);

  const price = priceIn(text);
  if (price) {
    leg.cost = price.cost;
    leg.currency = price.currency;
  }
  if (/\b(direct|non.?stop)\b/i.test(text)) leg.transfers = 0;
  else {
    const stops = text.match(/\b(\d+)\s+(?:stop|change|transfer|connection)s?\b/i);
    if (stops) leg.transfers = Number(stops[1]);
  }
  return leg;
}

/** Convert OCR text into a hotel stay when dates and a recognizable name are present. */
export function parseLocalHotel(text: string, now = new Date()): ExtractedHotel | null {
  const lines = text.split(/\r?\n/).map(clean).filter(Boolean);
  const dates = datesIn(lines, now);
  if (dates.length < 2) return null;
  const nameLine = lines.find((line) => /\b(hotel|hostel|resort|apart(?:ment|hotel))\b/i.test(line)
    && !/\b(search|results?|booking|details?|check.?in|check.?out)\b/i.test(line));
  if (!nameLine) return null;
  const hotel: ExtractedHotel = {
    name: nameLine,
    checkIn: `${dates[0].value.getFullYear()}-${pad(dates[0].value.getMonth() + 1)}-${pad(dates[0].value.getDate())}T15:00`,
    checkOut: `${dates[1].value.getFullYear()}-${pad(dates[1].value.getMonth() + 1)}-${pad(dates[1].value.getDate())}T11:00`,
  };
  const address = lines.find((line) => /\b\d{1,5}\s+.+\b(street|st\.?|road|rd\.?|avenue|ave\.?|rue|boulevard|blvd|place|platz|via)\b/i.test(line));
  if (address) hotel.addr = address;
  const price = priceIn(text);
  if (price) {
    hotel.cost = price.cost;
    hotel.currency = price.currency;
  }
  return hotel;
}

export function parseLocalAuto(text: string, note = '', now = new Date()): AutoExtract | null {
  const looksHotel = /\b(check.?in|check.?out|nights?|rooms?|hotel|hostel|resort)\b/i.test(text);
  if (looksHotel) {
    const hotel = parseLocalHotel(text, now);
    if (hotel) return { hotel };
  }
  const leg = parseLocalLeg(text, note, now);
  return leg ? { legs: [leg] } : null;
}
