import { deleteAttachment, putAttachment } from '../state/attachments';
import { saveSettings, settings, type LlmProvider } from '../state/settings';
import { byId, getVal, setVal } from '../ui/dom';
import { openModal, setOnModalClosed } from '../ui/modal';
import { AuthError, getExtractor, type ExtractedSegment } from './extractor';

/** Wire the "Segment from ticket" menu entry: hidden file input + key dialog. */
export function wireImport(): void {
  byId<HTMLInputElement>('importFile').onchange = (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // allow re-selecting the same file
    if (file) void importTicketFile(file);
  };
  byId('keyCancelBtn').onclick = () => closeKeyDialog(false);
  byId('keySaveBtn').onclick = () => closeKeyDialog(true);
  byId('keyProvider').onchange = syncKeyDialog;
  byId('settingsBtn').onclick = () => {
    void askForApiKey();
  };
}

/** Open the file picker (entry point for the Add menu). */
export function pickTicketFile(): void {
  byId<HTMLInputElement>('importFile').click();
}

async function importTicketFile(file: File): Promise<void> {
  const extractor = getExtractor(settings);
  if (!extractor.isConfigured(settings) && !(await askForApiKey())) return;

  const link = await putAttachment(file);
  setBusy(true, `Reading ${file.name} with ${extractor.name}…`);
  let legs: ExtractedSegment[];
  try {
    legs = await extractor.extract(file, settings);
  } catch (e) {
    setBusy(false);
    if (e instanceof AuthError) {
      // The user will re-pick the file after fixing the key; don't leave an
      // orphaned copy behind.
      void deleteAttachment(link);
      extractor.clearKey(settings);
      saveSettings();
      alert(`${extractor.name} rejected the API key. Pick the file again to re-enter it.`);
    } else {
      alert(
        `Could not extract segment data: ${e instanceof Error ? e.message : e}\n` +
          `The file is saved — create the segment manually and paste "${link}" into its Link field.`,
      );
    }
    return;
  }
  setBusy(false);
  openLegDialogs(legs, link);
}

/** Open the segment dialog for each extracted leg in sequence; every leg
 * links to the same stored file. */
function openLegDialogs(legs: ExtractedSegment[], link: string): void {
  const [leg, ...rest] = legs;
  if (!leg) return;
  if (rest.length) setOnModalClosed(() => openLegDialogs(rest, link));
  openModal(null, { ...leg, link });
}

function setBusy(on: boolean, text = ''): void {
  const el = byId('importBusy');
  el.style.display = on ? 'flex' : 'none';
  if (on) byId('importBusyText').textContent = text;
}

// --- provider / API key dialog --------------------------------------------

let keyResolve: ((ok: boolean) => void) | null = null;

const KEY_HINTS: Record<LlmProvider, string> = {
  gemini: 'Get a key at aistudio.google.com.',
  openrouter: 'Get a key at openrouter.ai/keys. The model is any OpenRouter model id that reads files.',
};

/** Refresh the key/model fields and hint for the selected provider. */
function syncKeyDialog(): void {
  const p = byId<HTMLSelectElement>('keyProvider').value as LlmProvider;
  setVal('keyInput', p === 'gemini' ? settings.geminiApiKey : settings.openrouterApiKey);
  setVal('keyModel', p === 'gemini' ? settings.geminiModel : settings.openrouterModel);
  byId('keyHint').textContent =
    `${KEY_HINTS[p]} Used to read ticket files. Stored only in this browser ` +
    '(note: any app hosted on this GitHub Pages origin could read it).';
}

function askForApiKey(): Promise<boolean> {
  byId<HTMLSelectElement>('keyProvider').value = settings.provider;
  syncKeyDialog();
  byId('keyOverlay').classList.add('open');
  byId<HTMLInputElement>('keyInput').focus();
  return new Promise((resolve) => {
    keyResolve = resolve;
  });
}

function closeKeyDialog(save: boolean): void {
  byId('keyOverlay').classList.remove('open');
  const key = getVal('keyInput').trim();
  const model = getVal('keyModel').trim();
  if (save) {
    const p = byId<HTMLSelectElement>('keyProvider').value as LlmProvider;
    settings.provider = p;
    if (p === 'gemini') {
      settings.geminiApiKey = key;
      if (model) settings.geminiModel = model;
    } else {
      settings.openrouterApiKey = key;
      if (model) settings.openrouterModel = model;
    }
    saveSettings();
  }
  keyResolve?.(save && !!key);
  keyResolve = null;
}
