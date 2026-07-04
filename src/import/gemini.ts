import type { Settings } from '../state/settings';
import { beginExchange } from './debugLog';
import { AuthError, type ExtractedSegment, type SegmentExtractor } from './extractor';
import { assertFileSize, CURRENCIES, fileToBase64, PROMPT, TRANSPORTS } from './shared';

export const geminiExtractor: SegmentExtractor = {
  name: 'Gemini',

  isConfigured: (s: Settings): boolean => !!s.geminiApiKey,

  clearKey: (s: Settings): void => {
    s.geminiApiKey = '';
  },

  async extract(file: File, s: Settings): Promise<ExtractedSegment[]> {
    assertFileSize(file);
    const ex = beginExchange({
      provider: 'Gemini',
      model: s.geminiModel,
      file: { name: file.name, type: file.type, size: file.size },
      startedAt: Date.now(),
    });
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
    const config = {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: { legs: { type: Type.ARRAY, items: leg } },
        required: ['legs'],
      },
    };
    ex.request = {
      model: s.geminiModel,
      contents: [{ role: 'user', parts: [{ inlineData: `<${file.size} bytes elided>` }, { text: PROMPT }] }],
      config,
    };

    try {
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
      const legs = (JSON.parse(text) as { legs?: ExtractedSegment[] }).legs;
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
