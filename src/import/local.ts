import { beginExchange, type LlmExchange } from './debugLog';
import type { AutoExtract, ExtractInput, ExtractedHotel, ExtractedLeg } from './extractor';
import {
  localHotelMissingFields, localLegMissingFields, parseLocalAuto, parseLocalHotel, parseLocalLeg,
} from './localParse';

export class LocalRecognitionError extends Error {}

const SCRIBE_BROWSER_ROOT = `${import.meta.env.BASE_URL}vendor/scribe`;

interface LocalScribeDocument {
  importFiles(files: File[]): Promise<void>;
  recognize(options: { langs: string[]; mode: 'speed'; ocrPages: 'autoDeep' }): Promise<unknown>;
  exportData(format: 'text'): Promise<string>;
  close(): Promise<void>;
}

async function recognizeText({ files, note }: ExtractInput): Promise<{ text: string; exchange: LlmExchange }> {
  if (!files.length) throw new LocalRecognitionError('Local recognition needs an image or PDF.');
  const startedAt = Date.now();
  const ex = beginExchange({
    provider: 'local',
    model: 'Scribe.js OCR',
    files: files.map((f) => ({ name: f.name, type: f.type, size: f.size })),
    note,
    startedAt,
  });
  try {
    // Scribe is large and only needed on recognition, so keep it out of the
    // initial application chunk. OCR runs in browser workers; files stay local.
    const [appModule, docModule] = await Promise.all([
      import(/* @vite-ignore */ `${SCRIBE_BROWSER_ROOT}/js/containers/app.js`) as Promise<{
        opt: { workerN: number | null };
      }>,
      import(/* @vite-ignore */ `${SCRIBE_BROWSER_ROOT}/js/containers/scribeDoc.js`) as Promise<{
        ScribeDoc: new () => LocalScribeDocument;
      }>,
    ]);
    // Scribe otherwise creates several WASM workers. One worker is slower but
    // avoids multiplying OCR memory use on phones and lower-memory browsers.
    appModule.opt.workerN = 1;
    // This text-only path avoids Scribe's openDocument convenience wrapper,
    // which also initializes its PDF-writing fonts. OCR text extraction does
    // not need those assets and lower memory use matters in the browser.
    const doc = new docModule.ScribeDoc();
    let text: string;
    try {
      await doc.importFiles(files);
      // The default quality mode runs both OCR engines. LSTM-only speed mode
      // is accurate for clean booking screenshots and uses much less memory.
      await doc.recognize({ langs: ['eng'], mode: 'speed', ocrPages: 'autoDeep' });
      text = (await doc.exportData('text')).trim();
    } finally {
      await doc.close();
    }
    ex.rawResponse = text;
    if (!text) throw new LocalRecognitionError('No text was found in the file.');
    return { text, exchange: ex };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ex.error = message;
    ex.status = 'Failed';
    throw error instanceof LocalRecognitionError ? error : new LocalRecognitionError(message);
  } finally {
    ex.durationMs = Date.now() - startedAt;
  }
}

async function finish<T>(
  input: ExtractInput,
  parse: (text: string) => T | null,
  missingFields: (value: T) => string[],
): Promise<T> {
  const { text, exchange } = await recognizeText(input);
  const parsed = parse(text);
  exchange.model = 'Scribe.js OCR + built-in trip parser';
  if (!parsed) {
    exchange.status = 'OCR succeeded; no reliable trip structure was found';
    exchange.error = 'The local parser could not confidently identify enough trip information.';
    throw new LocalRecognitionError(exchange.error);
  }
  const missing = missingFields(parsed);
  exchange.partial = missing.length > 0;
  exchange.status = exchange.partial ? 'Local recognition partially succeeded' : 'Local recognition succeeded';
  if (exchange.partial) {
    exchange.warning = `Missing or unparsed fields: ${missing.join(', ')}. They were left blank. `
      + 'Add missing details to the Additional note field and run Local Scribe.js again, or fill them in manually.';
  }
  exchange.legs = parsed;
  return parsed;
}

export const extractLocalLegs = async (input: ExtractInput): Promise<ExtractedLeg[]> => {
  const leg = await finish(input, (text) => parseLocalLeg(text, input.note), localLegMissingFields);
  return [leg];
};

export const extractLocalHotel = (input: ExtractInput): Promise<ExtractedHotel> =>
  finish(input, (text) => parseLocalHotel(text), localHotelMissingFields);

export const extractLocalAuto = (input: ExtractInput): Promise<AutoExtract> =>
  finish(input, (text) => parseLocalAuto(text, input.note), (value) => {
    if ('hotel' in value) return localHotelMissingFields(value.hotel);
    return value.legs.flatMap(localLegMissingFields);
  });
