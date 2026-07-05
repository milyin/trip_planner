import type { ResolvedParser } from '../state/settings';
import { beginExchange } from './debugLog';
import {
  AuthError, type AutoExtract, type ExtractInput, type ExtractedHotel, type ExtractedLeg, type LegExtractor,
} from './extractor';
import {
  assertFileSize, AUTO_PROMPT, buildPrompt, fileToBase64, HOTEL_PROMPT, HOTEL_SCHEMA, LEG_SCHEMA, PROMPT,
} from './shared';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';
const TOOL_NAME = 'record';

interface AnthropicResponse {
  content?: { type: string; name?: string; input?: unknown }[];
  error?: { message?: string };
}

/** One structured request: the model must call the `record` tool, whose input
 * schema is the JSON shape we want — the most reliable way to get structured
 * output across every Claude model (no beta headers, no per-model quirks). */
async function request(
  { files, note }: ExtractInput,
  parser: ResolvedParser,
  basePrompt: string,
  rootSchema: unknown,
): Promise<unknown> {
  for (const f of files) assertFileSize(f);
  const ex = beginExchange({
    provider: parser.provider,
    model: parser.model,
    files: files.map((f) => ({ name: f.name, type: f.type, size: f.size })),
    note,
    startedAt: Date.now(),
  });
  try {
    // Images use an image block; PDFs use a document block (both base64).
    const filePart = async (file: File): Promise<unknown> => {
      const data = await fileToBase64(file);
      const media_type = file.type || 'application/octet-stream';
      return file.type === 'application/pdf'
        ? { type: 'document', source: { type: 'base64', media_type, data } }
        : { type: 'image', source: { type: 'base64', media_type, data } };
    };
    const elidedParts = files.map((file) => ({
      type: file.type === 'application/pdf' ? 'document' : 'image',
      source: { type: 'base64', media_type: file.type, data: `<${file.size} bytes elided>` },
    }));
    const tools = [{ name: TOOL_NAME, description: 'Record the extracted trip data.', input_schema: rootSchema }];
    const body = (parts: unknown[]): unknown => ({
      model: parser.model,
      max_tokens: 4096,
      tools,
      tool_choice: { type: 'tool', name: TOOL_NAME },
      messages: [{ role: 'user', content: [...parts, { type: 'text', text: buildPrompt(note, basePrompt) }] }],
    });
    ex.request = body(elidedParts);

    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': parser.apiKey,
        'anthropic-version': API_VERSION,
        // Anthropic gates browser (CORS) access behind this explicit opt-in.
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body(await Promise.all(files.map(filePart)))),
    });
    ex.status = `HTTP ${res.status}`;
    const raw = await res.text();
    ex.rawResponse = raw;
    if (res.status === 401 || res.status === 403) throw new AuthError('Anthropic rejected the API key.');
    let parsed: AnthropicResponse;
    try {
      parsed = JSON.parse(raw) as AnthropicResponse;
    } catch {
      throw new Error(`Anthropic returned HTTP ${res.status} with a non-JSON body.`);
    }
    if (!res.ok || parsed.error) {
      throw new Error(parsed.error?.message || `Anthropic returned HTTP ${res.status}.`);
    }
    // The forced tool call carries the structured result in its `input`.
    const toolUse = parsed.content?.find((b) => b.type === 'tool_use' && b.name === TOOL_NAME);
    if (!toolUse || toolUse.input == null) throw new Error('Anthropic returned no structured result.');
    ex.legs = toolUse.input;
    return toolUse.input;
  } catch (e) {
    ex.error = e instanceof Error ? e.message : String(e);
    throw e;
  } finally {
    ex.durationMs = Date.now() - ex.startedAt;
  }
}

export const anthropicExtractor: LegExtractor = {
  async extract(input: ExtractInput, parser: ResolvedParser): Promise<ExtractedLeg[]> {
    const result = (await request(input, parser, PROMPT, {
      type: 'object',
      properties: { legs: { type: 'array', items: LEG_SCHEMA } },
      required: ['legs'],
    })) as { legs?: ExtractedLeg[] };
    if (!result.legs?.length) throw new Error('No transport legs found in the input.');
    return result.legs;
  },

  async extractHotel(input: ExtractInput, parser: ResolvedParser): Promise<ExtractedHotel> {
    const result = (await request(input, parser, HOTEL_PROMPT, {
      type: 'object',
      properties: { hotel: HOTEL_SCHEMA },
      required: ['hotel'],
    })) as { hotel?: ExtractedHotel };
    if (!result.hotel || !Object.keys(result.hotel).length) throw new Error('No hotel found in the input.');
    return result.hotel;
  },

  async extractAuto(input: ExtractInput, parser: ResolvedParser): Promise<AutoExtract> {
    const result = (await request(input, parser, AUTO_PROMPT, {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['legs', 'hotel'] },
        legs: { type: 'array', items: LEG_SCHEMA },
        hotel: HOTEL_SCHEMA,
      },
      required: ['kind'],
    })) as { kind?: string; legs?: ExtractedLeg[]; hotel?: ExtractedHotel };
    if (result.kind === 'hotel' && result.hotel && Object.keys(result.hotel).length) {
      return { hotel: result.hotel };
    }
    if (result.legs?.length) return { legs: result.legs };
    throw new Error('Neither transport legs nor a hotel found in the input.');
  },
};
