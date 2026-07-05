import type { ResolvedParser } from '../state/settings';
import { beginExchange } from './debugLog';
import {
  AuthError, type ExtractInput, type ExtractedHotel, type ExtractedLeg, type LegExtractor,
} from './extractor';
import { assertFileSize, buildPrompt, CURRENCIES, fileToDataUrl, HOTEL_PROMPT, PROMPT, TRANSPORTS } from './shared';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

const LEG_SCHEMA = {
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
    cost: { type: 'number', description: 'Price as a number' },
    currency: { type: 'string', enum: CURRENCIES },
  },
};

const HOTEL_SCHEMA = {
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

interface ChatCompletion {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string };
}

/** One structured-output chat request; returns the parsed JSON content. */
async function request(
  { file, note }: ExtractInput,
  parser: ResolvedParser,
  basePrompt: string,
  schemaName: string,
  rootSchema: unknown,
): Promise<unknown> {
  if (file) assertFileSize(file);
  const ex = beginExchange({
    provider: parser.provider,
    model: parser.model,
    file: file ? { name: file.name, type: file.type, size: file.size } : null,
    note,
    startedAt: Date.now(),
  });
  try {
    // PDFs go through OpenRouter's file parser (native engine when the model
    // reads PDFs itself, OCR otherwise); images use the standard vision part.
    const filePart = async (): Promise<unknown> => {
      if (!file) return null;
      const dataUrl = await fileToDataUrl(file);
      return file.type === 'application/pdf'
        ? { type: 'file', file: { filename: file.name || 'ticket.pdf', file_data: dataUrl } }
        : { type: 'image_url', image_url: { url: dataUrl } };
    };
    const elidedPart = file
      ? file.type === 'application/pdf'
        ? { type: 'file', file: { filename: file.name, file_data: `<${file.size} bytes elided>` } }
        : { type: 'image_url', image_url: { url: `<${file.size} bytes elided>` } }
      : null;
    const body = (fp: unknown): unknown => ({
      model: parser.model,
      messages: [
        { role: 'user', content: [...(fp ? [fp] : []), { type: 'text', text: buildPrompt(note, basePrompt) }] },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: schemaName, schema: rootSchema },
      },
    });
    ex.request = body(elidedPart);

    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${parser.apiKey}`,
        'Content-Type': 'application/json',
        // Optional app attribution (shows up in the user's OpenRouter stats).
        'HTTP-Referer': 'https://milyin.github.io/trip_planner/',
        'X-Title': 'Trip Planner',
      },
      body: JSON.stringify(body(await filePart())),
    });
    ex.status = `HTTP ${res.status}`;
    const raw = await res.text();
    ex.rawResponse = raw;
    if (res.status === 401 || res.status === 403) throw new AuthError('OpenRouter rejected the API key.');
    let parsed: ChatCompletion;
    try {
      parsed = JSON.parse(raw) as ChatCompletion;
    } catch {
      throw new Error(`OpenRouter returned HTTP ${res.status} with a non-JSON body.`);
    }
    if (!res.ok || parsed.error) {
      throw new Error(parsed.error?.message || `OpenRouter returned HTTP ${res.status}.`);
    }
    const content = parsed.choices?.[0]?.message?.content;
    if (!content) throw new Error('OpenRouter returned an empty response.');
    // Models without structured-output support may wrap the JSON in a fence.
    const json = content.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '');
    const result = JSON.parse(json) as unknown;
    ex.legs = result;
    return result;
  } catch (e) {
    ex.error = e instanceof Error ? e.message : String(e);
    throw e;
  } finally {
    ex.durationMs = Date.now() - ex.startedAt;
  }
}

export const openrouterExtractor: LegExtractor = {
  async extract(input: ExtractInput, parser: ResolvedParser): Promise<ExtractedLeg[]> {
    const result = (await request(input, parser, PROMPT, 'itinerary_legs', {
      type: 'object',
      properties: { legs: { type: 'array', items: LEG_SCHEMA } },
      required: ['legs'],
    })) as { legs?: ExtractedLeg[] };
    if (!result.legs?.length) throw new Error('No transport legs found in the input.');
    return result.legs;
  },

  async extractHotel(input: ExtractInput, parser: ResolvedParser): Promise<ExtractedHotel> {
    const result = (await request(input, parser, HOTEL_PROMPT, 'hotel_stay', {
      type: 'object',
      properties: { hotel: HOTEL_SCHEMA },
      required: ['hotel'],
    })) as { hotel?: ExtractedHotel };
    if (!result.hotel || !Object.keys(result.hotel).length) throw new Error('No hotel found in the input.');
    return result.hotel;
  },
};
