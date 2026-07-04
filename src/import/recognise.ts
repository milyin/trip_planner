import { parserName, type ImageParser } from '../state/settings';
import { byId } from '../ui/dom';
import { AuthError, getExtractor, type ExtractedSegment } from './extractor';

/** Run recognition with the busy indicator up; reports errors to the user and
 * returns `null` on failure (the LLM-exchange tab has the details). */
export async function runRecognition(
  file: File | null,
  note: string,
  parser: ImageParser,
): Promise<ExtractedSegment[] | null> {
  const busy = byId('importBusy');
  byId('importBusyText').textContent = `Reading ${file ? file.name || 'image' : 'note'} with ${parserName(parser)}…`;
  busy.style.display = 'flex';
  try {
    return await getExtractor(parser).extract({ file, note }, parser);
  } catch (e) {
    if (e instanceof AuthError) {
      alert(`${parserName(parser)} rejected the API key — check this parser in ⚙ Image parsers.`);
    } else {
      alert(
        `Recognition failed: ${e instanceof Error ? e.message : e}\n` +
          `See the "LLM exchange" tab for the full request and response.`,
      );
    }
    return null;
  } finally {
    busy.style.display = 'none';
  }
}
