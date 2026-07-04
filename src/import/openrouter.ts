import type { Settings } from '../state/settings';
import { beginExchange } from './debugLog';
import { AuthError, type ExtractedSegment, type SegmentExtractor } from './extractor';
import { assertFileSize, CURRENCIES, fileToDataUrl, PROMPT, TRANSPORTS } from './shared';

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

interface ChatCompletion {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string };
}

export const openrouterExtractor: SegmentExtractor = {
  name: 'OpenRouter',

  isConfigured: (s: Settings): boolean => !!s.openrouterApiKey,

  clearKey: (s: Settings): void => {
    s.openrouterApiKey = '';
  },

  async extract(file: File, s: Settings): Promise<ExtractedSegment[]> {
    assertFileSize(file);
    const ex = beginExchange({
      provider: 'OpenRouter',
      model: s.openrouterModel,
      file: { name: file.name, type: file.type, size: file.size },
      startedAt: Date.now(),
    });
    try {
      const dataUrl = await fileToDataUrl(file);
      // PDFs go through OpenRouter's file parser (native engine when the model
      // reads PDFs itself, OCR otherwise); images use the standard vision part.
      const isPdf = file.type === 'application/pdf';
      const filePart = isPdf
        ? { type: 'file', file: { filename: file.name || 'ticket.pdf', file_data: dataUrl } }
        : { type: 'image_url', image_url: { url: dataUrl } };
      const request = (fp: unknown): unknown => ({
        model: s.openrouterModel,
        messages: [{ role: 'user', content: [fp, { type: 'text', text: PROMPT }] }],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'segment_legs',
            schema: {
              type: 'object',
              properties: { legs: { type: 'array', items: LEG_SCHEMA } },
              required: ['legs'],
            },
          },
        },
      });
      ex.request = request(
        isPdf
          ? { type: 'file', file: { filename: file.name, file_data: `<${file.size} bytes elided>` } }
          : { type: 'image_url', image_url: { url: `<${file.size} bytes elided>` } },
      );

      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${s.openrouterApiKey}`,
          'Content-Type': 'application/json',
          // Optional app attribution (shows up in the user's OpenRouter stats).
          'HTTP-Referer': 'https://milyin.github.io/trip_planner/',
          'X-Title': 'Trip Planner',
        },
        body: JSON.stringify(request(filePart)),
      });
      ex.status = `HTTP ${res.status}`;
      const raw = await res.text();
      ex.rawResponse = raw;
      if (res.status === 401 || res.status === 403) throw new AuthError('OpenRouter rejected the API key.');
      let body: ChatCompletion;
      try {
        body = JSON.parse(raw) as ChatCompletion;
      } catch {
        throw new Error(`OpenRouter returned HTTP ${res.status} with a non-JSON body.`);
      }
      if (!res.ok || body.error) {
        throw new Error(body.error?.message || `OpenRouter returned HTTP ${res.status}.`);
      }
      const content = body.choices?.[0]?.message?.content;
      if (!content) throw new Error('OpenRouter returned an empty response.');
      // Models without structured-output support may wrap the JSON in a fence.
      const json = content.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '');
      const legs = (JSON.parse(json) as { legs?: ExtractedSegment[] }).legs;
      if (!legs?.length) throw new Error('No transport legs found in the file.');
      ex.legs = legs;
      return legs;
    } catch (e) {
      ex.error = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      ex.durationMs = Date.now() - ex.startedAt;
    }
  },
};
