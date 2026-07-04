import type { Settings } from '../state/settings';
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
