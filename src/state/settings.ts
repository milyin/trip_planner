/** Persisted application settings (localStorage). The key is prefixed with the
 * app name because `<user>.github.io` is one origin shared by every GitHub
 * Pages project of the account. */

import {
  DEFAULT_OCR_LANGUAGES, isOcrLanguageCode, type OcrLanguageCode,
} from '../import/ocrLanguages';

export type LlmProvider = 'gemini' | 'openrouter' | 'anthropic';

/** A provider credential; several parsers can share one account. */
export interface LlmAccount {
  id: string;
  provider: LlmProvider;
  apiKey: string;
}

/** One configured recognition backend: an account plus a model on it. */
export interface ImageParser {
  accountId: string;
  model: string;
}

/** A parser joined with its account — what extractors actually consume. */
export interface ResolvedParser {
  provider: LlmProvider;
  model: string;
  apiKey: string;
}

export interface Settings {
  accounts: LlmAccount[];
  parsers: ImageParser[];
  /** Whether browser-local Scribe.js OCR is attempted. */
  scribeEnabled: boolean;
  /** Tesseract language models loaded by browser-local Scribe.js OCR. */
  scribeLanguages: OcrLanguageCode[];
  /** The selected LLM parser, or `null` for no LLM parsing. */
  activeParser: number | null;
  theme: 'dark' | 'light';
  /** ISO 4217 code every cost is converted to for the plan totals. */
  baseCurrency: string;
}

/** Default base currency for a fresh install. */
export const DEFAULT_BASE_CURRENCY = 'EUR';

export const DEFAULT_MODELS: Record<LlmProvider, string> = {
  gemini: 'gemini-2.5-flash',
  openrouter: 'google/gemini-2.5-flash',
  anthropic: 'claude-haiku-4-5',
};

export const genAccountId = (): string =>
  'acc' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export const accountName = (a: LlmAccount): string =>
  a.apiKey ? `${a.provider} …${a.apiKey.slice(-4)}` : `${a.provider} (no key)`;

export function parserName(p: ImageParser): string {
  const a = settings.accounts.find((x) => x.id === p.accountId);
  return `${a?.provider ?? '?'} ${p.model}`;
}

export function resolveParser(p: ImageParser): ResolvedParser | null {
  const a = settings.accounts.find((x) => x.id === p.accountId);
  return a ? { provider: a.provider, model: p.model, apiKey: a.apiKey } : null;
}

const KEY = 'tripPlanner.settings.v1';

export const settings: Settings = load();

/** Shapes written by earlier versions. */
interface LegacySettings {
  provider?: LlmProvider;
  geminiApiKey?: string;
  geminiModel?: string;
  openrouterApiKey?: string;
  openrouterModel?: string;
  parsers?: unknown[];
}

function load(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<Settings> & LegacySettings;
    const theme: Settings['theme'] = raw.theme === 'light' ? 'light' : 'dark';
    const scribeEnabled = raw.scribeEnabled !== false;
    const loadedLanguages = Array.isArray(raw.scribeLanguages)
      ? [...new Set(raw.scribeLanguages.filter(isOcrLanguageCode))]
      : [];
    const scribeLanguages = loadedLanguages.length ? loadedLanguages : [...DEFAULT_OCR_LANGUAGES];
    const baseCurrency = typeof raw.baseCurrency === 'string' && raw.baseCurrency ? raw.baseCurrency : DEFAULT_BASE_CURRENCY;
    const accounts: LlmAccount[] = [];
    const parsers: ImageParser[] = [];
    const addAccount = (provider: LlmProvider, apiKey: string): string => {
      const existing = accounts.find((a) => a.provider === provider && a.apiKey === apiKey);
      if (existing) return existing.id;
      const acc = { id: genAccountId(), provider, apiKey };
      accounts.push(acc);
      return acc.id;
    };
    const loadActiveParser = (count: number): number | null => {
      if (raw.activeParser === null) return null;
      if (typeof raw.activeParser === 'number') {
        return raw.activeParser >= 0 && raw.activeParser < count ? raw.activeParser : null;
      }
      // Before the explicit "No LLM parsing" choice, having parsers implied
      // that the first one was selected.
      return count ? 0 : null;
    };

    if (Array.isArray(raw.accounts)) {
      // Current shape.
      const loadedParsers = (raw.parsers as ImageParser[]) ?? [];
      return {
        accounts: raw.accounts,
        parsers: loadedParsers,
        scribeEnabled,
        scribeLanguages,
        // Existing installs already selected a parser; preserve that choice.
        activeParser: loadActiveParser(loadedParsers.length),
        theme,
        baseCurrency,
      };
    }
    if (Array.isArray(raw.parsers)) {
      // Previous shape: parsers carried their own provider + key.
      for (const p of raw.parsers as { provider: LlmProvider; model: string; apiKey: string }[]) {
        parsers.push({ accountId: addAccount(p.provider, p.apiKey), model: p.model });
      }
      return {
        accounts,
        parsers,
        scribeEnabled,
        scribeLanguages,
        activeParser: loadActiveParser(parsers.length),
        theme,
        baseCurrency,
      };
    }
    // Oldest shape: one key per provider.
    if (raw.geminiApiKey) {
      parsers.push({
        accountId: addAccount('gemini', raw.geminiApiKey),
        model: raw.geminiModel || DEFAULT_MODELS.gemini,
      });
    }
    if (raw.openrouterApiKey) {
      parsers.push({
        accountId: addAccount('openrouter', raw.openrouterApiKey),
        model: raw.openrouterModel || DEFAULT_MODELS.openrouter,
      });
    }
    const legacyActive = accounts.findIndex((a) => a.provider === raw.provider);
    const activeParser = parsers.length ? Math.max(0, legacyActive) : null;
    return { accounts, parsers, scribeEnabled, scribeLanguages, activeParser, theme, baseCurrency };
  } catch {
    return {
      accounts: [], parsers: [], scribeEnabled: true, scribeLanguages: [...DEFAULT_OCR_LANGUAGES], activeParser: null,
      theme: 'dark', baseCurrency: DEFAULT_BASE_CURRENCY,
    };
  }
}

export function saveSettings(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* quota exceeded or storage disabled — settings stay in-memory */
  }
}
