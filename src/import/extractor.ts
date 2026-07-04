import type { CurrencyCode, TransportKind } from '../domain/types';
import type { Settings } from '../state/settings';
import { geminiExtractor } from './gemini';

/** One transport leg extracted from an uploaded booking/ticket file. All
 * fields are optional — the user reviews them in the segment dialog. */
export interface ExtractedSegment {
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

/** A pluggable LLM backend that turns a ticket file into segment legs. */
export interface SegmentExtractor {
  /** Human-readable name for error messages. */
  name: string;
  /** True when the extractor has the credentials it needs. */
  isConfigured(settings: Settings): boolean;
  extract(file: File, settings: Settings): Promise<ExtractedSegment[]>;
}

/** Thrown when the provider rejects the configured API key. */
export class AuthError extends Error {}

const extractors: Record<Settings['provider'], SegmentExtractor> = {
  gemini: geminiExtractor,
};

export const getExtractor = (settings: Settings): SegmentExtractor => extractors[settings.provider];
