import type { ResolvedParser } from '../state/settings';
import { beginExchange } from './debugLog';
import {
  AuthError, type AutoExtract, type ExtractInput, type ExtractedHotel, type ExtractedLeg, type LegExtractor,
} from './extractor';
import { assertFileSize, AUTO_PROMPT, buildPrompt, fileToBase64, HOTEL_PROMPT, PROMPT, TRANSPORTS } from './shared';

type GenaiModule = typeof import('@google/genai');

/** Response schema for one leg, built with the SDK's Type enum. */
function legSchema({ Type }: GenaiModule): unknown {
  return {
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
      transfers: { type: Type.NUMBER, description: 'Number of transfers (0 = direct)' },
      transfersInfo: { type: Type.STRING, description: 'Transfer details: intermediate cities, durations' },
      cost: { type: Type.NUMBER, description: 'Price as a number' },
      currency: { type: Type.STRING, description: 'ISO 4217 code shown, e.g. EUR, USD, JPY' },
    },
  };
}

/** Response schema for one hotel stay. */
function hotelSchema({ Type }: GenaiModule): unknown {
  return {
    type: Type.OBJECT,
    properties: {
      name: { type: Type.STRING, description: 'Hotel name' },
      city: { type: Type.STRING, description: 'City' },
      addr: { type: Type.STRING, description: 'Street address' },
      checkIn: { type: Type.STRING, description: 'Check-in, YYYY-MM-DDTHH:MM' },
      checkOut: { type: Type.STRING, description: 'Check-out, YYYY-MM-DDTHH:MM' },
      cost: { type: Type.NUMBER, description: 'Total price as a number' },
      currency: { type: Type.STRING, description: 'ISO 4217 code shown, e.g. EUR, USD, JPY' },
    },
  };
}

/** One structured-output generateContent request; returns the parsed JSON. */
async function request(
  { files, note }: ExtractInput,
  parser: ResolvedParser,
  basePrompt: string,
  rootSchema: (m: GenaiModule) => unknown,
): Promise<unknown> {
  for (const f of files) assertFileSize(f);
  const ex = beginExchange({
    provider: parser.provider,
    model: parser.model,
    files: files.map((f) => ({ name: f.name, type: f.type, size: f.size })),
    note,
    startedAt: Date.now(),
  });
  // The SDK is heavy (~400KB) and only needed for recognition — load it lazily.
  const genai = await import('@google/genai');
  const { ApiError, GoogleGenAI } = genai;
  const prompt = buildPrompt(note, basePrompt);
  const config = {
    responseMimeType: 'application/json',
    responseSchema: rootSchema(genai),
  };
  ex.request = {
    model: parser.model,
    contents: [
      {
        role: 'user',
        parts: [...files.map((f) => ({ inlineData: `<${f.size} bytes elided>` })), { text: prompt }],
      },
    ],
    config,
  };

  try {
    const ai = new GoogleGenAI({ apiKey: parser.apiKey });
    let text: string | undefined;
    try {
      const imageParts = await Promise.all(
        files.map(async (f) => ({
          inlineData: { mimeType: f.type || 'application/octet-stream', data: await fileToBase64(f) },
        })),
      );
      const res = await ai.models.generateContent({
        model: parser.model,
        contents: [{ role: 'user', parts: [...imageParts, { text: prompt }] }],
        config,
      });
      ex.status = 'HTTP 200';
      text = res.text;
      ex.rawResponse = text;
    } catch (e) {
      if (e instanceof ApiError) ex.status = `ApiError ${e.status}`;
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
    const result = JSON.parse(text) as unknown;
    ex.legs = result;
    return result;
  } catch (e) {
    ex.error = e instanceof Error ? e.message : String(e);
    throw e;
  } finally {
    ex.durationMs = Date.now() - ex.startedAt;
  }
}

export const geminiExtractor: LegExtractor = {
  async extract(input: ExtractInput, parser: ResolvedParser): Promise<ExtractedLeg[]> {
    const result = (await request(input, parser, PROMPT, (m) => ({
      type: m.Type.OBJECT,
      properties: { legs: { type: m.Type.ARRAY, items: legSchema(m) } },
      required: ['legs'],
    }))) as { legs?: ExtractedLeg[] };
    if (!result.legs?.length) throw new Error('No transport legs found in the input.');
    return result.legs;
  },

  async extractHotel(input: ExtractInput, parser: ResolvedParser): Promise<ExtractedHotel> {
    const result = (await request(input, parser, HOTEL_PROMPT, (m) => ({
      type: m.Type.OBJECT,
      properties: { hotel: hotelSchema(m) },
      required: ['hotel'],
    }))) as { hotel?: ExtractedHotel };
    if (!result.hotel || !Object.keys(result.hotel).length) throw new Error('No hotel found in the input.');
    return result.hotel;
  },

  async extractAuto(input: ExtractInput, parser: ResolvedParser): Promise<AutoExtract> {
    const result = (await request(input, parser, AUTO_PROMPT, (m) => ({
      type: m.Type.OBJECT,
      properties: {
        kind: { type: m.Type.STRING, enum: ['legs', 'hotel'] },
        legs: { type: m.Type.ARRAY, items: legSchema(m) },
        hotel: hotelSchema(m),
      },
      required: ['kind'],
    }))) as { kind?: string; legs?: ExtractedLeg[]; hotel?: ExtractedHotel };
    if (result.kind === 'hotel' && result.hotel && Object.keys(result.hotel).length) {
      return { hotel: result.hotel };
    }
    if (result.legs?.length) return { legs: result.legs };
    throw new Error('Neither transport legs nor a hotel found in the input.');
  },
};
