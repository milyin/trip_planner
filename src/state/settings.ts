/** Persisted application settings (localStorage). The key is prefixed with the
 * app name because `<user>.github.io` is one origin shared by every GitHub
 * Pages project of the account. */

export type LlmProvider = 'gemini' | 'openrouter';

export interface Settings {
  provider: LlmProvider;
  geminiApiKey: string;
  geminiModel: string;
  openrouterApiKey: string;
  openrouterModel: string;
  theme: 'dark' | 'light';
}

const KEY = 'tripPlanner.settings.v1';

const DEFAULTS: Settings = {
  provider: 'gemini',
  geminiApiKey: '',
  geminiModel: 'gemini-2.5-flash',
  openrouterApiKey: '',
  openrouterModel: 'google/gemini-2.5-flash',
  theme: 'dark',
};

export const settings: Settings = load();

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* quota exceeded or storage disabled — settings stay in-memory */
  }
}
