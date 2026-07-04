import { DEFAULT_MODELS, parserName, saveSettings, settings, type LlmProvider } from '../state/settings';
import { byId, getVal, mkBtn, setVal } from './dom';

const HINTS: Record<LlmProvider, string> = {
  gemini: 'Get a key at aistudio.google.com.',
  openrouter: 'Get a key at openrouter.ai/keys — pick any model that reads images.',
};

let resolveClose: (() => void) | null = null;

/** Wire the ⚙ topbar button and the parser-manager dialog (once, at startup). */
export function wireParserSettings(): void {
  byId('settingsBtn').onclick = () => void openParserSettings();
  byId('closeParsers').onclick = close;
  byId('parserDoneBtn').onclick = close;
  byId('pProvider').onchange = syncProviderFields;
  byId('pAddBtn').onclick = addParser;
}

/** Open the parser manager; resolves when the user closes it. */
export function openParserSettings(): Promise<void> {
  renderList();
  syncProviderFields();
  setVal('pKey', '');
  byId('parserOverlay').classList.add('open');
  return new Promise((resolve) => {
    resolveClose = resolve;
  });
}

function close(): void {
  byId('parserOverlay').classList.remove('open');
  resolveClose?.();
  resolveClose = null;
}

function syncProviderFields(): void {
  const p = byId<HTMLSelectElement>('pProvider').value as LlmProvider;
  setVal('pModel', DEFAULT_MODELS[p]);
  byId('pHint').textContent =
    `${HINTS[p]} The key is stored only in this browser ` +
    '(note: any app hosted on this GitHub Pages origin could read it).';
}

function addParser(): void {
  const provider = byId<HTMLSelectElement>('pProvider').value as LlmProvider;
  const model = getVal('pModel').trim();
  const apiKey = getVal('pKey').trim();
  if (!model || !apiKey) {
    alert('Model and API key are required.');
    return;
  }
  settings.parsers.push({ provider, model, apiKey });
  settings.activeParser = settings.parsers.length - 1;
  saveSettings();
  setVal('pKey', '');
  renderList();
}

function renderList(): void {
  const box = byId('parserList');
  box.innerHTML = '';
  if (!settings.parsers.length) {
    box.innerHTML = '<div class="empty-note">No parsers yet — add one below.</div>';
    return;
  }
  settings.parsers.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'parser-row';
    const name = document.createElement('span');
    name.className = 'pname';
    name.textContent = parserName(p);
    const key = document.createElement('span');
    key.className = 'pkey';
    key.textContent = `key …${p.apiKey.slice(-4)}`;
    const del = mkBtn('✕', 'btn icon ghost');
    del.title = 'Remove parser';
    del.onclick = () => {
      settings.parsers.splice(i, 1);
      if (settings.activeParser >= settings.parsers.length) {
        settings.activeParser = Math.max(0, settings.parsers.length - 1);
      }
      saveSettings();
      renderList();
    };
    row.append(name, key, del);
    box.appendChild(row);
  });
}
