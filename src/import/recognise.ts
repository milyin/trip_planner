import type { ResolvedParser } from '../state/settings';
import { byId } from '../ui/dom';
import { AuthError, getExtractor, type ExtractedHotel, type ExtractedLeg } from './extractor';

/** Busy indicator + user-facing error handling around one extraction call. */
async function guarded<T>(file: File | null, parser: ResolvedParser, work: () => Promise<T>): Promise<T | null> {
  const name = `${parser.provider} ${parser.model}`;
  const busy = byId('importBusy');
  byId('importBusyText').textContent = `Reading ${file ? file.name || 'image' : 'note'} with ${name}…`;
  busy.style.display = 'flex';
  try {
    return await work();
  } catch (e) {
    if (e instanceof AuthError) {
      alert(`${name} rejected the API key — check the account in ⚙ LLM configuration.`);
    } else {
      alert(
        `Recognition failed: ${e instanceof Error ? e.message : e}\n` +
          `See the LLM exchange section below for the full request and response.`,
      );
    }
    return null;
  } finally {
    busy.style.display = 'none';
  }
}

/** Recognise transport legs; `null` on failure (exchange dump has details). */
export const runRecognition = (
  file: File | null,
  note: string,
  parser: ResolvedParser,
): Promise<ExtractedLeg[] | null> => guarded(file, parser, () => getExtractor(parser).extract({ file, note }, parser));

/** Recognise one hotel stay; `null` on failure (exchange dump has details). */
export const runHotelRecognition = (
  file: File | null,
  note: string,
  parser: ResolvedParser,
): Promise<ExtractedHotel | null> =>
  guarded(file, parser, () => getExtractor(parser).extractHotel({ file, note }, parser));
