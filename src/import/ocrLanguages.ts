/** Tesseract language models available to Scribe.js. Codes are the values
 * expected by `ScribeDoc.recognize({ langs })`. */
export const OCR_LANGUAGES = [
  ['afr', 'Afrikaans'],
  ['sqi', 'Albanian'],
  ['amh', 'Amharic'],
  ['ara', 'Arabic'],
  ['hye', 'Armenian'],
  ['asm', 'Assamese'],
  ['aze', 'Azerbaijani'],
  ['aze_cyrl', 'Azerbaijani — Cyrillic'],
  ['eus', 'Basque'],
  ['bel', 'Belarusian'],
  ['ben', 'Bengali'],
  ['bos', 'Bosnian'],
  ['bre', 'Breton'],
  ['bul', 'Bulgarian'],
  ['mya', 'Burmese'],
  ['cat', 'Catalan'],
  ['ceb', 'Cebuano'],
  ['chr', 'Cherokee'],
  ['chi_sim', 'Chinese — Simplified'],
  ['chi_tra', 'Chinese — Traditional'],
  ['cos', 'Corsican'],
  ['hrv', 'Croatian'],
  ['ces', 'Czech'],
  ['dan', 'Danish'],
  ['div', 'Dhivehi'],
  ['nld', 'Dutch / Flemish'],
  ['dzo', 'Dzongkha'],
  ['eng', 'English'],
  ['epo', 'Esperanto'],
  ['est', 'Estonian'],
  ['fao', 'Faroese'],
  ['fil', 'Filipino'],
  ['fin', 'Finnish'],
  ['fra', 'French'],
  ['fry', 'Frisian'],
  ['glg', 'Galician'],
  ['kat', 'Georgian'],
  ['deu', 'German'],
  ['ell', 'Greek'],
  ['guj', 'Gujarati'],
  ['hat', 'Haitian Creole'],
  ['heb', 'Hebrew'],
  ['hin', 'Hindi'],
  ['hun', 'Hungarian'],
  ['isl', 'Icelandic'],
  ['iku', 'Inuktitut'],
  ['ind', 'Indonesian'],
  ['gle', 'Irish'],
  ['ita', 'Italian'],
  ['jpn', 'Japanese'],
  ['jav', 'Javanese'],
  ['kan', 'Kannada'],
  ['kaz', 'Kazakh'],
  ['khm', 'Khmer'],
  ['kor', 'Korean'],
  ['kmr', 'Kurdish — Kurmanji'],
  ['kir', 'Kyrgyz'],
  ['lao', 'Lao'],
  ['lat', 'Latin'],
  ['lav', 'Latvian'],
  ['lit', 'Lithuanian'],
  ['ltz', 'Luxembourgish'],
  ['mkd', 'Macedonian'],
  ['msa', 'Malay'],
  ['mal', 'Malayalam'],
  ['mri', 'Maori'],
  ['mar', 'Marathi'],
  ['mon', 'Mongolian'],
  ['nep', 'Nepali'],
  ['nor', 'Norwegian'],
  ['oci', 'Occitan'],
  ['ori', 'Oriya'],
  ['pus', 'Pashto'],
  ['fas', 'Persian'],
  ['pol', 'Polish'],
  ['por', 'Portuguese'],
  ['pan', 'Punjabi'],
  ['que', 'Quechua'],
  ['ron', 'Romanian'],
  ['rus', 'Russian'],
  ['san', 'Sanskrit'],
  ['gla', 'Scottish Gaelic'],
  ['srp', 'Serbian'],
  ['srp_latn', 'Serbian — Latin'],
  ['snd', 'Sindhi'],
  ['sin', 'Sinhala'],
  ['slk', 'Slovak'],
  ['slv', 'Slovenian'],
  ['spa', 'Spanish'],
  ['sun', 'Sundanese'],
  ['swa', 'Swahili'],
  ['swe', 'Swedish'],
  ['syr', 'Syriac'],
  ['tgk', 'Tajik'],
  ['tam', 'Tamil'],
  ['tat', 'Tatar'],
  ['tel', 'Telugu'],
  ['tha', 'Thai'],
  ['bod', 'Tibetan'],
  ['tir', 'Tigrinya'],
  ['ton', 'Tonga'],
  ['tur', 'Turkish'],
  ['uig', 'Uyghur'],
  ['ukr', 'Ukrainian'],
  ['urd', 'Urdu'],
  ['uzb', 'Uzbek'],
  ['uzb_cyrl', 'Uzbek — Cyrillic'],
  ['vie', 'Vietnamese'],
  ['cym', 'Welsh'],
  ['yid', 'Yiddish'],
  ['yor', 'Yoruba'],
] as const;

export type OcrLanguageCode = typeof OCR_LANGUAGES[number][0];

/** OCR is always usable for English even when browser locale detection is not
 * available (for example in a non-browser test environment). */
export const DEFAULT_OCR_LANGUAGES: OcrLanguageCode[] = ['eng'];

const BROWSER_LANGUAGE_TO_OCR: Record<string, OcrLanguageCode> = {
  af: 'afr', sq: 'sqi', am: 'amh', ar: 'ara', hy: 'hye', as: 'asm', az: 'aze',
  eu: 'eus', be: 'bel', bn: 'ben', bs: 'bos', br: 'bre', bg: 'bul', my: 'mya',
  ca: 'cat', ceb: 'ceb', chr: 'chr', co: 'cos', hr: 'hrv', cs: 'ces', da: 'dan',
  dv: 'div', nl: 'nld', dz: 'dzo', en: 'eng', eo: 'epo', et: 'est', fo: 'fao',
  fil: 'fil', tl: 'fil', fi: 'fin', fr: 'fra', fy: 'fry', gl: 'glg', ka: 'kat',
  de: 'deu', el: 'ell', gu: 'guj', ht: 'hat', he: 'heb', iw: 'heb', hi: 'hin',
  hu: 'hun', is: 'isl', iu: 'iku', id: 'ind', ga: 'gle', it: 'ita', ja: 'jpn',
  jv: 'jav', kn: 'kan', kk: 'kaz', km: 'khm', ko: 'kor', ku: 'kmr', ky: 'kir',
  lo: 'lao', la: 'lat', lv: 'lav', lt: 'lit', lb: 'ltz', mk: 'mkd', ms: 'msa',
  ml: 'mal', mi: 'mri', mr: 'mar', mn: 'mon', ne: 'nep', no: 'nor', nb: 'nor',
  nn: 'nor', oc: 'oci', or: 'ori', ps: 'pus', fa: 'fas', pl: 'pol', pt: 'por',
  pa: 'pan', qu: 'que', ro: 'ron', ru: 'rus', sa: 'san', gd: 'gla', sr: 'srp',
  sd: 'snd', si: 'sin', sk: 'slk', sl: 'slv', es: 'spa', su: 'sun', sw: 'swa',
  sv: 'swe', syr: 'syr', tg: 'tgk', ta: 'tam', tt: 'tat', te: 'tel', th: 'tha',
  bo: 'bod', ti: 'tir', to: 'ton', tr: 'tur', ug: 'uig', uk: 'ukr', ur: 'urd',
  uz: 'uzb', vi: 'vie', cy: 'cym', yi: 'yid', yo: 'yor',
};

function ocrLanguageForLocale(tag: string): OcrLanguageCode | null {
  try {
    const locale = new Intl.Locale(tag);
    const maximized = locale.maximize();
    const script = locale.script ?? maximized.script;
    const region = locale.region ?? maximized.region;
    if (locale.language === 'zh') {
      return script === 'Hant' || ['HK', 'MO', 'TW'].includes(region ?? '') ? 'chi_tra' : 'chi_sim';
    }
    if (locale.language === 'az' && script === 'Cyrl') return 'aze_cyrl';
    if (locale.language === 'sr' && script === 'Latn') return 'srp_latn';
    if (locale.language === 'uz' && script === 'Cyrl') return 'uzb_cyrl';
    return BROWSER_LANGUAGE_TO_OCR[locale.language] ?? null;
  } catch {
    return null;
  }
}

/** Defaults for a fresh install: English, the likely language of the primary
 * browser locale's region, then all supported browser/system languages. This
 * uses locale metadata only; it never requests physical location permission. */
export function defaultOcrLanguages(
  browserLanguages?: readonly string[],
  browserLocale?: string,
): OcrLanguageCode[] {
  const navigatorLocale = typeof navigator !== 'undefined' && typeof navigator.language === 'string'
    ? navigator.language
    : undefined;
  const navigatorLanguages = typeof navigator !== 'undefined' && Array.isArray(navigator.languages)
    ? navigator.languages
    : navigatorLocale ? [navigatorLocale] : [];
  const systemLanguages = (Array.isArray(browserLanguages) ? browserLanguages : navigatorLanguages)
    .filter((locale): locale is string => typeof locale === 'string');
  const primaryLocale = browserLocale
    ?? navigatorLocale
    ?? systemLanguages[0];
  const defaults: OcrLanguageCode[] = [...DEFAULT_OCR_LANGUAGES];
  const add = (code: OcrLanguageCode | null): void => {
    if (code && !defaults.includes(code)) defaults.push(code);
  };
  if (primaryLocale) {
    try {
      const region = new Intl.Locale(primaryLocale).region;
      if (region) add(ocrLanguageForLocale(new Intl.Locale(`und-${region}`).maximize().toString()));
    } catch {
      /* Invalid browser locale — system-language fallback below still applies. */
    }
  }
  for (const locale of systemLanguages) add(ocrLanguageForLocale(locale));
  return defaults;
}

const LANGUAGE_CODES = new Set<string>(OCR_LANGUAGES.map(([code]) => code));

export const isOcrLanguageCode = (value: unknown): value is OcrLanguageCode =>
  typeof value === 'string' && LANGUAGE_CODES.has(value);

export const ocrLanguageName = (code: string): string =>
  OCR_LANGUAGES.find(([candidate]) => candidate === code)?.[1] ?? code;
