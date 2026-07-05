import type { ResolvedParser } from '../state/settings';
import { byId } from '../ui/dom';
import { AuthError, getExtractor, type AutoExtract, type ExtractedHotel, type ExtractedLeg } from './extractor';

/** Busy indicator + user-facing error handling around one extraction call. */
async function guarded<T>(files: File[], parser: ResolvedParser, work: () => Promise<T>): Promise<T | null> {
  const name = `${parser.provider} ${parser.model}`;
  const busy = byId('importBusy');
  const what = files.length > 1 ? `${files.length} images` : files.length ? files[0].name || 'image' : 'note';
  byId('importBusyText').textContent = `Reading ${what} with ${name}…`;
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
  files: File[],
  note: string,
  parser: ResolvedParser,
): Promise<ExtractedLeg[] | null> => guarded(files, parser, () => getExtractor(parser).extract({ files, note }, parser));

/** Auto-detect leg vs hotel and extract; `null` on failure. */
export const runAutoRecognition = (
  files: File[],
  note: string,
  parser: ResolvedParser,
): Promise<AutoExtract | null> =>
  guarded(files, parser, () => getExtractor(parser).extractAuto({ files, note }, parser));

/** Recognise one hotel stay; `null` on failure (exchange dump has details). */
export const runHotelRecognition = (
  files: File[],
  note: string,
  parser: ResolvedParser,
): Promise<ExtractedHotel | null> =>
  guarded(files, parser, () => getExtractor(parser).extractHotel({ files, note }, parser));
