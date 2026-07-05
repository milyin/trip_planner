/** Bits shared by every extractor implementation. */

/** Inline-data requests are capped around ~20MB total; leave headroom for the prompt. */
export const MAX_FILE_BYTES = 15 * 1024 * 1024;

export const TRANSPORTS = ['Plane', 'Train', 'Bus', 'Taxi', 'Car', 'Other'];
export const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF'];

/** Plain JSON-Schema for one leg / one hotel — shared by every provider that
 * speaks JSON Schema (OpenRouter's response_format, Anthropic's tool input). */
export const LEG_SCHEMA = {
  type: 'object',
  properties: {
    depCity: { type: 'string', description: 'Departure city' },
    depAddr: { type: 'string', description: 'Departure airport/station/stop' },
    depTime: { type: 'string', description: 'Departure time, YYYY-MM-DDTHH:MM, local' },
    arrCity: { type: 'string', description: 'Arrival city' },
    arrAddr: { type: 'string', description: 'Arrival airport/station/stop' },
    arrTime: { type: 'string', description: 'Arrival time, YYYY-MM-DDTHH:MM, local' },
    transport: { type: 'string', enum: TRANSPORTS },
    company: { type: 'string', description: 'Carrier name' },
    transfers: { type: 'number', description: 'Number of transfers (0 = direct)' },
    transfersInfo: { type: 'string', description: 'Transfer details: intermediate cities, durations' },
    cost: { type: 'number', description: 'Price as a number' },
    currency: { type: 'string', enum: CURRENCIES },
  },
};

export const HOTEL_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Hotel name' },
    city: { type: 'string', description: 'City' },
    addr: { type: 'string', description: 'Street address' },
    checkIn: { type: 'string', description: 'Check-in, YYYY-MM-DDTHH:MM' },
    checkOut: { type: 'string', description: 'Check-out, YYYY-MM-DDTHH:MM' },
    cost: { type: 'number', description: 'Total price as a number' },
    currency: { type: 'string', enum: CURRENCIES },
  },
};

const LEG_RULES = `- If the input shows several alternatives, extract the one the user's note points to; without a note, take the highlighted/selected one, otherwise the first.
- An itinerary may consist of several legs (connections); return each leg separately, in travel order.
- Times must be local to the place they refer to, formatted exactly as YYYY-MM-DDTHH:MM.
- This is a planner for FUTURE trips. If the year is not printed, assume the closest matching date AFTER the current date; if a weekday is printed, pick the occurrence falling on that weekday.
- "addr" is the airport, station or stop name (e.g. "CDG", "St-Charles"), not a street address, and not a repetition of the city name.
- "company" is the carrier operating the leg.
- "transfers" is the number of transfers/connections shown for the leg (0 for direct). When intermediate cities, stations or transfer durations are shown, describe them in free form in "transfersInfo" (e.g. "via Lyon Part-Dieu, 1h 20m").
- If one price covers the whole itinerary, put it on the first leg and 0 on the rest.
- Pick the currency from the allowed list; if another currency is shown, convert approximately and pick the closest match.
- Omit any field the input does not state; never invent values.`;

const HOTEL_RULES = `- If the input shows several hotels, extract the one the user's note points to; without a note, take the highlighted/selected one, otherwise the first.
- "checkIn"/"checkOut" must be datetime-local strings, formatted exactly as YYYY-MM-DDTHH:MM. When only dates are shown, use 15:00 for check-in and 11:00 for check-out.
- This is a planner for FUTURE trips. If the year is not printed, assume the closest matching date AFTER the current date; if a weekday is printed, pick the occurrence falling on that weekday.
- "addr" is the street address if shown.
- "cost" is the total price for the stay if shown, as a number.
- Pick the currency from the allowed list; if another currency is shown, convert approximately and pick the closest match.
- Omit any field the input does not state; never invent values.`;

export const PROMPT = `You help fill in the leg form (one transport ride) of a trip-planning app.
The user provides a screenshot and/or a free-form note. The screenshot is usually a list of flights or trains from a booking site or search engine — not a bought ticket — though it can also be a booking confirmation.
Extract the transport legs of ONE itinerary:
${LEG_RULES}`;

export const HOTEL_PROMPT = `You help fill in the hotel form (one overnight stay) of a trip-planning app.
The user provides a screenshot and/or a free-form note. The screenshot is usually a hotel listing from a booking site or search engine — possibly showing several hotels — though it can also be a booking confirmation.
Extract ONE hotel stay:
${HOTEL_RULES}`;

export const AUTO_PROMPT = `You help a trip-planning app import a pasted screenshot.
First decide what the screenshot mainly shows and set "kind":
- "legs" — transport (flights, trains, buses, …): search results, a timetable or a booking confirmation. Fill "legs" with the transport legs of ONE itinerary.
- "hotel" — a hotel / accommodation listing or booking. Fill "hotel" with ONE stay.

Rules when kind is "legs":
${LEG_RULES}

Rules when kind is "hotel":
${HOTEL_RULES}`;

/** Final prompt text: the current date, the instructions, and the user's
 * note, if any. The date anchors year inference — screenshots rarely print
 * the year, and this is a planner for future trips. */
export function buildPrompt(note: string, base: string = PROMPT): string {
  const now = new Date();
  const today = `Current date: ${now.toISOString().slice(0, 10)} (${now.toLocaleDateString('en-GB', { weekday: 'long' })}).`;
  const body = `${today}\n${base}`;
  return note.trim() ? `${body}\n\nUser note:\n${note.trim()}` : body;
}

/** Read a file as a `data:<mime>;base64,…` URL. */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/** Read a file as a bare base64 payload (no data-URL header). */
export const fileToBase64 = async (file: File): Promise<string> =>
  (await fileToDataUrl(file)).split(',', 2)[1] ?? '';

export function assertFileSize(file: File): void {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB, limit 15 MB).`);
  }
}
