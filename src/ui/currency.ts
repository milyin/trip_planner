/** Populate a `<select>` with the full ISO 4217 currency list (the authoritative
 * set the browser ships via `Intl.supportedValuesOf('currency')`). */

const intl = Intl as unknown as {
  supportedValuesOf?: (k: string) => string[];
  DisplayNames?: new (l: string[] | undefined, o: { type: string }) => { of(c: string): string | undefined };
};

let codes: string[] | null = null;
function isoCurrencies(): string[] {
  if (!codes) {
    codes = typeof intl.supportedValuesOf === 'function'
      ? intl.supportedValuesOf('currency')
      : ['EUR', 'USD', 'GBP', 'CHF', 'JPY'];
  }
  return codes;
}

let optionsHtml: string | null = null;
function currencyOptionsHtml(): string {
  if (optionsHtml != null) return optionsHtml;
  let names: { of(c: string): string | undefined } | null = null;
  try {
    if (intl.DisplayNames) names = new intl.DisplayNames(undefined, { type: 'currency' });
  } catch {
    names = null;
  }
  optionsHtml = isoCurrencies()
    .map((c) => `<option value="${c}">${names ? `${c} — ${names.of(c) ?? c}` : c}</option>`)
    .join('');
  return optionsHtml;
}

/** Fill `sel` with all currencies and select `value`, keeping a stored code
 * that isn't in the ISO list still selectable. */
export function fillCurrencySelect(sel: HTMLSelectElement, value: string): void {
  sel.innerHTML = currencyOptionsHtml();
  if (value && !isoCurrencies().includes(value)) {
    sel.insertAdjacentHTML('afterbegin', `<option value="${value}">${value}</option>`);
  }
  sel.value = value;
}
