import type { ImageParser } from '../state/settings';
import { beginExchange } from './debugLog';
import { AuthError, type ExtractInput, type ExtractedSegment, type SegmentExtractor } from './extractor';
import { assertFileSize, buildPrompt, CURRENCIES, fileToBase64, TRANSPORTS } from './shared';

export const geminiExtractor: SegmentExtractor = {
  async extract({ file, note }: ExtractInput, parser: ImageParser): Promise<ExtractedSegment[]> {
    if (file) assertFileSize(file);
    const ex = beginExchange({
      provider: parser.provider,
      model: parser.model,
      file: file ? { name: file.name, type: file.type, size: file.size } : null,
      note,
      startedAt: Date.now(),
    });
    // The SDK is heavy (~400KB) and only needed for recognition — load it lazily.
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
    const prompt = buildPrompt(note);
    ex.request = {
      model: parser.model,
      contents: [
        {
          role: 'user',
          parts: [...(file ? [{ inlineData: `<${file.size} bytes elided>` }] : []), { text: prompt }],
        },
      ],
      config,
    };

    try {
      const ai = new GoogleGenAI({ apiKey: parser.apiKey });
      let text: string | undefined;
      try {
        const res = await ai.models.generateContent({
          model: parser.model,
          contents: [
            {
              role: 'user',
              parts: [
                ...(file
                  ? [{ inlineData: { mimeType: file.type || 'application/octet-stream', data: await fileToBase64(file) } }]
                  : []),
                { text: prompt },
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
      if (!legs?.length) throw new Error('No transport legs found in the input.');
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
