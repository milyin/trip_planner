/** Bits shared by every extractor implementation. */

/** Inline-data requests are capped around ~20MB total; leave headroom for the prompt. */
export const MAX_FILE_BYTES = 15 * 1024 * 1024;

export const TRANSPORTS = ['Plane', 'Train', 'Bus', 'Taxi', 'Car', 'Other'];
export const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF'];

export const PROMPT = `The attached file is a travel booking confirmation or ticket (flight, train, bus, etc).
Extract every transport leg it describes, in travel order.
- Times must be local to the place they refer to, formatted exactly as YYYY-MM-DDTHH:MM.
- If the year is not printed, infer it: prefer the nearest upcoming date, and if a weekday is printed pick the year where the date falls on that weekday.
- "addr" is the airport, station or stop name (e.g. "CDG", "St-Charles"), not a street address, and not a repetition of the city name.
- "company" is the carrier operating the leg.
- If the total price covers several legs, put it on the first leg and 0 on the rest.
- Pick the currency from the allowed list; if the ticket uses another currency, convert approximately and pick the closest match.
- Omit any field the file does not state; never invent values.`;

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
