import type { CurrencyCode, TransportKind } from '../domain/types';
import type { LlmProvider, ResolvedParser } from '../state/settings';
import { geminiExtractor } from './gemini';
import { openrouterExtractor } from './openrouter';

/** One transport leg extracted from the user's screenshot and/or note. All
 * fields are optional — the user reviews them in the segment dialog. */
export interface ExtractedLeg {
  depCity?: string;
  depAddr?: string;
  /** `datetime-local` string (`YYYY-MM-DDTHH:MM`), local to the departure place. */
  depTime?: string;
  arrCity?: string;
  arrAddr?: string;
  /** `datetime-local` string (`YYYY-MM-DDTHH:MM`), local to the arrival place. */
  arrTime?: string;
  transport?: TransportKind;
  company?: string;
  cost?: number;
  currency?: CurrencyCode;
}

/** What the user provides for recognition: a screenshot, a free-form note,
 * or both. */
export interface ExtractInput {
  file: File | null;
  note: string;
}

/** A pluggable LLM backend that turns the input into segment legs. */
export interface LegExtractor {
  extract(input: ExtractInput, parser: ResolvedParser): Promise<ExtractedLeg[]>;
}

/** Thrown when the provider rejects the parser's API key. */
export class AuthError extends Error {}

const extractors: Record<LlmProvider, LegExtractor> = {
  gemini: geminiExtractor,
  openrouter: openrouterExtractor,
};

export const getExtractor = (parser: ResolvedParser): LegExtractor => extractors[parser.provider];
