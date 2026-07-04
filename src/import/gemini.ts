import type { Settings } from '../state/settings';
import { AuthError, type ExtractedSegment, type SegmentExtractor } from './extractor';

/** Inline-data requests are capped at ~20MB total; leave headroom for the prompt. */
const MAX_FILE_BYTES = 15 * 1024 * 1024;

const TRANSPORTS = ['Plane', 'Train', 'Bus', 'Taxi', 'Car', 'Other'];
const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF'];

const PROMPT = `The attached file is a travel booking confirmation or ticket (flight, train, bus, etc).
Extract every transport leg it describes, in travel order.
- Times must be local to the place they refer to, formatted exactly as YYYY-MM-DDTHH:MM.
- "addr" is the airport, station or stop name (e.g. "CDG", "St-Charles"), not a street address, and not a repetition of the city name.
- "company" is the carrier operating the leg.
- If the total price covers several legs, put it on the first leg and 0 on the rest.
- Pick the currency from the allowed list; if the ticket uses another currency, convert approximately and pick the closest match.
- Omit any field the file does not state; never invent values.`;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    // result is "data:<mime>;base64,<data>" — keep only the payload.
    r.onload = () => resolve((r.result as string).split(',', 2)[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export const geminiExtractor: SegmentExtractor = {
  name: 'Gemini',

  isConfigured: (s: Settings): boolean => !!s.geminiApiKey,

  async extract(file: File, s: Settings): Promise<ExtractedSegment[]> {
    if (file.size > MAX_FILE_BYTES) {
      throw new Error(`File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB, limit 15 MB).`);
    }
    // The SDK is heavy (~400KB) and only needed for imports — load it lazily.
    const { ApiError, GoogleGenAI, Type } = await import('@google/genai');

    const leg = {
      type: Type.OBJECT,
      properties: {
        depCity: { type: Type.STRING, description: 'Departure city' },
        depAddr: { type: Type.STRING, description: 'Departure airport/station/stop' },
        depTime: { type: Type.STRING, description: 'Departure time, YYYY-MM-DDTHH:MM, local' },
        arrCity: { type: Type.STRING, description: 'Arrival city' },
        arrAddr: { type: Type.STRING, description: 'Arrival airport/station/stop' },
        arrTime: { type: Type.STRING, description: 'Arrival time, YYYY-MM-DDTHH:MM, local' },
        transport: { type: Type.STRING, enum: TRANSPORTS },
        company: { type: Type.STRING, description: 'Carrier name' },
        cost: { type: Type.NUMBER, description: 'Price as a number' },
        currency: { type: Type.STRING, enum: CURRENCIES },
      },
    };

    const ai = new GoogleGenAI({ apiKey: s.geminiApiKey });
    let text: string | undefined;
    try {
      const res = await ai.models.generateContent({
        model: s.geminiModel,
        contents: [
          {
            role: 'user',
            parts: [
              { inlineData: { mimeType: file.type || 'application/octet-stream', data: await fileToBase64(file) } },
              { text: PROMPT },
            ],
          },
        ],
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: { legs: { type: Type.ARRAY, items: leg } },
            required: ['legs'],
          },
        },
      });
      text = res.text;
    } catch (e) {
      // Gemini reports an invalid key as 400 INVALID_ARGUMENT ("API key not
      // valid"), not as 401.
      if (
        e instanceof ApiError &&
        (e.status === 401 || e.status === 403 || (e.status === 400 && /api key/i.test(e.message)))
      ) {
        throw new AuthError('Gemini rejected the API key.');
      }
      throw e;
    }
    if (!text) throw new Error('Gemini returned an empty response.');
    const legs = (JSON.parse(text) as { legs?: ExtractedSegment[] }).legs;
    if (!legs?.length) throw new Error('No transport legs found in the file.');
    return legs;
  },
};
