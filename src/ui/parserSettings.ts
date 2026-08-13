import { backfillConversions } from '../domain/convert';
import {
  accountName, DEFAULT_MODELS, genAccountId, parserName, saveSettings, settings, type LlmProvider,
} from '../state/settings';
import { emitChange, state } from '../state/store';
import { fillCurrencySelect } from './currency';
import { byId, mkBtn } from './dom';

const PROVIDERS: LlmProvider[] = ['gemini', 'openrouter', 'anthropic'];

let resolveClose: (() => void) | null = null;

/** Show the General or LLM tab of the Settings dialog. */
function showSettingsTab(tab: 'general' | 'llm'): void {
  byId('settGeneral').style.display = tab === 'general' ? '' : 'none';
  byId('settLlm').style.display = tab === 'llm' ? '' : 'none';
  byId('stabGeneral').classList.toggle('active', tab === 'general');
  byId('stabLlm').classList.toggle('active', tab === 'llm');
}

/** Wire the Settings dialog: tabs, base-currency picker, and LLM lists. */
export function wireParserSettings(): void {
  byId('settingsBtn').onclick = () => void openParserSettings();
  byId('closeParsers').onclick = close;
  byId('parserDoneBtn').onclick = close;
  byId('stabGeneral').onclick = () => showSettingsTab('general');
  byId('stabLlm').onclick = () => showSettingsTab('llm');
  byId<HTMLInputElement>('scribeEnabled').onchange = (event) => {
    settings.scribeEnabled = (event.target as HTMLInputElement).checked;
    saveSettings();
    renderRecognitionChoice();
  };
  byId<HTMLSelectElement>('activeLlmParser').onchange = (event) => {
    const value = (event.target as HTMLSelectElement).value;
    settings.activeParser = value === '' ? null : Number(value);
    saveSettings();
  };
  const cur = byId<HTMLSelectElement>('baseCurSel');
  cur.onchange = () => {
    settings.baseCurrency = cur.value;
    saveSettings();
    // Auto-conversions were computed for the previous base — drop them so the
    // backfill recomputes for the new one; manual values are kept.
    for (const it of state.items) if (!it.costConvertedManual) it.costConverted = undefined;
    emitChange();
    backfillConversions(state.items, settings.baseCurrency, emitChange);
  };
  byId('addAccountBtn').onclick = () => {
    settings.accounts.push({ id: genAccountId(), provider: 'gemini', apiKey: '' });
    saveSettings();
    renderLists();
  };
  byId('addParserBtn').onclick = () => {
    const acc = settings.accounts[0];
    if (!acc) {
      alert('Add an account first.');
      return;
    }
    settings.parsers.push({ accountId: acc.id, model: DEFAULT_MODELS[acc.provider] });
    settings.activeParser = settings.parsers.length - 1;
    saveSettings();
    renderLists();
  };
}

/** Open the Settings dialog on the given tab (default General); resolves when
 * the user closes it. The recognize flow opens it straight on the LLM tab. */
export function openParserSettings(tab: 'general' | 'llm' = 'general'): Promise<void> {
  fillCurrencySelect(byId<HTMLSelectElement>('baseCurSel'), settings.baseCurrency);
  renderLists();
  showSettingsTab(tab);
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

function providerSelect(value: LlmProvider): HTMLSelectElement {
  const sel = document.createElement('select');
  for (const p of PROVIDERS) {
    const o = document.createElement('option');
    o.value = p;
    o.textContent = p;
    sel.appendChild(o);
  }
  sel.value = value;
  return sel;
}

function renderLists(): void {
  renderAccounts();
  renderParsers();
  renderRecognitionChoice();
}

/** Render the two routing choices in plain language: local OCR on/off and one
 * LLM parser (or none). "Fallback" applies only when local OCR is enabled. */
function renderRecognitionChoice(): void {
  byId<HTMLInputElement>('scribeEnabled').checked = settings.scribeEnabled;
  const fallback = settings.scribeEnabled;
  byId('llmChoiceTitle').textContent = fallback ? 'LLM fallback' : 'LLM parser';
  byId('llmChoiceLabel').textContent = fallback
    ? 'Used only when Scribe.js cannot confidently read the file'
    : 'Used to recognize images, PDFs and notes';
  byId('llmSettingsHint').textContent = fallback
    ? 'Scribe.js runs locally first. The selected LLM receives files only when the local result is insufficient.'
    : 'Scribe.js is disabled. Files are sent directly to the selected LLM; choose “No LLM parsing” to disable recognition.';

  const select = byId<HTMLSelectElement>('activeLlmParser');
  select.innerHTML = '';
  const none = document.createElement('option');
  none.value = '';
  none.textContent = 'No LLM parsing';
  select.appendChild(none);
  settings.parsers.forEach((parser, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = parserName(parser);
    select.appendChild(option);
  });
  const active = settings.activeParser;
  select.value = active != null && settings.parsers[active] ? String(active) : '';
}

function renderAccounts(): void {
  const box = byId('accountList');
  box.innerHTML = '';
  if (!settings.accounts.length) {
    box.innerHTML = '<div class="empty-note">No accounts yet.</div>';
    return;
  }
  settings.accounts.forEach((acc) => {
    const row = document.createElement('div');
    row.className = 'parser-row';
    const prov = providerSelect(acc.provider);
    prov.title = 'Provider';
    prov.onchange = () => {
      acc.provider = prov.value as LlmProvider;
      saveSettings();
      renderParsers(); // parser rows show the account's provider in their labels
      renderRecognitionChoice();
    };
    const key = document.createElement('input');
    key.type = 'password';
    key.placeholder = 'API key…';
    key.value = acc.apiKey;
    key.autocomplete = 'off';
    key.title = 'API key (stored only in this browser)';
    key.oninput = () => {
      acc.apiKey = key.value.trim();
      saveSettings();
    };
    // Re-label parser account selects once the user finishes typing the key.
    key.onchange = () => {
      renderParsers();
      renderRecognitionChoice();
    };
    const del = mkBtn('✕', 'btn icon ghost');
    del.title = 'Remove account (and its parsers)';
    del.onclick = () => {
      const selected = settings.activeParser == null ? null : settings.parsers[settings.activeParser];
      settings.accounts = settings.accounts.filter((a) => a.id !== acc.id);
      settings.parsers = settings.parsers.filter((p) => p.accountId !== acc.id);
      const selectedIndex = selected ? settings.parsers.indexOf(selected) : -1;
      settings.activeParser = selectedIndex >= 0 ? selectedIndex : null;
      saveSettings();
      renderLists();
    };
    row.append(prov, key, del);
    box.appendChild(row);
  });
}

function renderParsers(): void {
  const box = byId('parserList');
  box.innerHTML = '';
  if (!settings.parsers.length) {
    box.innerHTML = '<div class="empty-note">No parsers yet.</div>';
    renderRecognitionChoice();
    return;
  }
  settings.parsers.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'parser-row';
    const accSel = document.createElement('select');
    accSel.title = 'Account';
    settings.accounts.forEach((a) => {
      const o = document.createElement('option');
      o.value = a.id;
      o.textContent = accountName(a);
      accSel.appendChild(o);
    });
    accSel.value = p.accountId;
    accSel.onchange = () => {
      p.accountId = accSel.value;
      saveSettings();
      renderRecognitionChoice();
    };
    const model = document.createElement('input');
    model.placeholder = 'model id…';
    model.value = p.model;
    model.autocomplete = 'off';
    model.title = 'Model id on this account';
    model.oninput = () => {
      p.model = model.value.trim();
      saveSettings();
      renderRecognitionChoice();
    };
    const del = mkBtn('✕', 'btn icon ghost');
    del.title = 'Remove parser';
    del.onclick = () => {
      settings.parsers.splice(i, 1);
      if (settings.activeParser === i) settings.activeParser = null;
      else if (settings.activeParser != null && settings.activeParser > i) settings.activeParser -= 1;
      saveSettings();
      renderLists();
    };
    row.append(accSel, model, del);
    box.appendChild(row);
  });
}
