/** Persisted application settings (localStorage). The key is prefixed with the
 * app name because `<user>.github.io` is one origin shared by every GitHub
 * Pages project of the account. */

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
  /** Index into `parsers` of the last parser used. */
  activeParser: number;
  theme: 'dark' | 'light';
}

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
    const accounts: LlmAccount[] = [];
    const parsers: ImageParser[] = [];
    const addAccount = (provider: LlmProvider, apiKey: string): string => {
      const existing = accounts.find((a) => a.provider === provider && a.apiKey === apiKey);
      if (existing) return existing.id;
      const acc = { id: genAccountId(), provider, apiKey };
      accounts.push(acc);
      return acc.id;
    };

    if (Array.isArray(raw.accounts)) {
      // Current shape.
      return {
        accounts: raw.accounts,
        parsers: (raw.parsers as ImageParser[]) ?? [],
        activeParser: raw.activeParser ?? 0,
        theme,
      };
    }
    if (Array.isArray(raw.parsers)) {
      // Previous shape: parsers carried their own provider + key.
      for (const p of raw.parsers as { provider: LlmProvider; model: string; apiKey: string }[]) {
        parsers.push({ accountId: addAccount(p.provider, p.apiKey), model: p.model });
      }
      return { accounts, parsers, activeParser: raw.activeParser ?? 0, theme };
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
    const activeParser = Math.max(
      0,
      accounts.findIndex((a) => a.provider === raw.provider),
    );
    return { accounts, parsers, activeParser, theme };
  } catch {
    return { accounts: [], parsers: [], activeParser: 0, theme: 'dark' };
  }
}

export function saveSettings(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* quota exceeded or storage disabled — settings stay in-memory */
  }
}
