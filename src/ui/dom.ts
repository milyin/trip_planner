/** Get an element by id, asserting it exists (the markup is static). */
export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} not found`);
  return el as T;
}

/** Read the value of an input/select by id. */
export const getVal = (id: string): string => byId<HTMLInputElement>(id).value;

/** Set the value of an input/select by id. */
export const setVal = (id: string, v: string | number): void => {
  byId<HTMLInputElement>(id).value = String(v);
};

/** Create a `<button>` with text and class names. */
export function mkBtn(text: string, className: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = className;
  b.textContent = text;
  return b;
}
