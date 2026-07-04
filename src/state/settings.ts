/** Persisted application settings (localStorage). The key is prefixed with the
 * app name because `<user>.github.io` is one origin shared by every GitHub
 * Pages project of the account. */

export type LlmProvider = 'gemini' | 'openrouter';

/** One configured LLM backend for ticket-image recognition. */
export interface ImageParser {
  provider: LlmProvider;
  model: string;
  apiKey: string;
}

export interface Settings {
  parsers: ImageParser[];
  /** Index into `parsers` of the last parser used. */
  activeParser: number;
  theme: 'dark' | 'light';
}

export const parserName = (p: ImageParser): string => `${p.provider} ${p.model}`;

export const DEFAULT_MODELS: Record<LlmProvider, string> = {
  gemini: 'gemini-2.5-flash',
  openrouter: 'google/gemini-2.5-flash',
};

const KEY = 'tripPlanner.settings.v1';

export const settings: Settings = load();

/** Shape written by earlier versions (single key per provider). */
interface LegacySettings {
  provider?: LlmProvider;
  geminiApiKey?: string;
  geminiModel?: string;
  openrouterApiKey?: string;
  openrouterModel?: string;
}

function load(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<Settings> & LegacySettings;
    const theme: Settings['theme'] = raw.theme === 'light' ? 'light' : 'dark';
    if (Array.isArray(raw.parsers)) {
      return { parsers: raw.parsers, activeParser: raw.activeParser ?? 0, theme };
    }
    // Migrate the legacy one-key-per-provider shape into the parser list.
    const parsers: ImageParser[] = [];
    if (raw.geminiApiKey) {
      parsers.push({ provider: 'gemini', model: raw.geminiModel || DEFAULT_MODELS.gemini, apiKey: raw.geminiApiKey });
    }
    if (raw.openrouterApiKey) {
      parsers.push({
        provider: 'openrouter',
        model: raw.openrouterModel || DEFAULT_MODELS.openrouter,
        apiKey: raw.openrouterApiKey,
      });
    }
    const activeParser = Math.max(0, parsers.findIndex((p) => p.provider === raw.provider));
    return { parsers, activeParser, theme };
  } catch {
    return { parsers: [], activeParser: 0, theme: 'dark' };
  }
}

export function saveSettings(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* quota exceeded or storage disabled — settings stay in-memory */
  }
}
