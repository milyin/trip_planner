/** Bits shared by every extractor implementation. */

/** Inline-data requests are capped around ~20MB total; leave headroom for the prompt. */
export const MAX_FILE_BYTES = 15 * 1024 * 1024;

export const TRANSPORTS = ['Plane', 'Train', 'Bus', 'Taxi', 'Car', 'Other'];
export const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF'];

export const PROMPT = `You help fill in the leg form (one transport ride) of a trip-planning app.
The user provides a screenshot and/or a free-form note. The screenshot is usually a list of flights or trains from a booking site or search engine — not a bought ticket — though it can also be a booking confirmation.
Extract the transport legs of ONE itinerary:
- If the input shows several alternatives, extract the one the user's note points to; without a note, take the highlighted/selected one, otherwise the first.
- An itinerary may consist of several legs (connections); return each leg separately, in travel order.
- Times must be local to the place they refer to, formatted exactly as YYYY-MM-DDTHH:MM.
- If the year is not printed, infer it: prefer the nearest upcoming date, and if a weekday is printed pick the year where the date falls on that weekday.
- "addr" is the airport, station or stop name (e.g. "CDG", "St-Charles"), not a street address, and not a repetition of the city name.
- "company" is the carrier operating the leg.
- If one price covers the whole itinerary, put it on the first leg and 0 on the rest.
- Pick the currency from the allowed list; if another currency is shown, convert approximately and pick the closest match.
- Omit any field the input does not state; never invent values.`;

export const HOTEL_PROMPT = `You help fill in the hotel form (one overnight stay) of a trip-planning app.
The user provides a screenshot and/or a free-form note. The screenshot is usually a hotel listing from a booking site or search engine — possibly showing several hotels — though it can also be a booking confirmation.
Extract ONE hotel stay:
- If the input shows several hotels, extract the one the user's note points to; without a note, take the highlighted/selected one, otherwise the first.
- "checkIn"/"checkOut" must be datetime-local strings, formatted exactly as YYYY-MM-DDTHH:MM. When only dates are shown, use 15:00 for check-in and 11:00 for check-out.
- If the year is not printed, infer it: prefer the nearest upcoming date, and if a weekday is printed pick the year where the date falls on that weekday.
- "addr" is the street address if shown.
- "cost" is the total price for the stay if shown, as a number.
- Pick the currency from the allowed list; if another currency is shown, convert approximately and pick the closest match.
- Omit any field the input does not state; never invent values.`;

/** Final prompt text: the instructions plus the user's note, if any. */
export const buildPrompt = (note: string, base: string = PROMPT): string =>
  note.trim() ? `${base}\n\nUser note:\n${note.trim()}` : base;

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
