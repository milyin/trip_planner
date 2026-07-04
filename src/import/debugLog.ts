/** In-memory record of the most recent LLM exchange, shown in the segment
 * dialog's "LLM exchange" tab for debugging extraction problems. */

export interface LlmExchange {
  provider: string;
  model: string;
  file: { name: string; type: string; size: number };
  startedAt: number;
  durationMs?: number;
  /** Request body with the file payload elided (it would be megabytes of base64). */
  request?: unknown;
  /** e.g. `HTTP 200` or `ApiError 400`. */
  status?: string;
  rawResponse?: string;
  legs?: unknown;
  error?: string;
}

let last: LlmExchange | null = null;

/** Start recording a new exchange (replaces the previous one). The extractor
 * keeps mutating the returned object as the exchange progresses. */
export function beginExchange(x: LlmExchange): LlmExchange {
  last = x;
  return x;
}

export const lastExchange = (): LlmExchange | null => last;

/** Render the exchange as plain text for the debug tab. */
export function formatExchange(x: LlmExchange | null): string {
  if (!x) {
    return 'No LLM exchange in this session yet.\nUse ＋ Add → 🎫 Segment from ticket… to import a file.';
  }
  const lines = [
    `Provider: ${x.provider} (${x.model})`,
    `File: ${x.file.name} (${x.file.type || 'unknown type'}, ${(x.file.size / 1024).toFixed(1)} KB)`,
    `When: ${new Date(x.startedAt).toLocaleString()}${x.durationMs != null ? ` · took ${(x.durationMs / 1000).toFixed(1)} s` : ''}`,
    `Status: ${x.status ?? '—'}`,
  ];
  if (x.error) lines.push('', '--- Error ---', x.error);
  if (x.request !== undefined) lines.push('', '--- Request (file payload elided) ---', JSON.stringify(x.request, null, 2));
  if (x.rawResponse) lines.push('', '--- Raw response ---', x.rawResponse);
  if (x.legs !== undefined) lines.push('', '--- Parsed legs ---', JSON.stringify(x.legs, null, 2));
  return lines.join('\n');
}
