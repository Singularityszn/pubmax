/**
 * The value, or a thrown error naming what was missing.
 *
 * A test that reads `rows[0].name` assumes the row exists. Under
 * `noUncheckedIndexedAccess` that assumption is stated here instead of
 * silenced with `!`, and a missing row fails with this message rather than a
 * TypeError on `undefined`.
 */
export function defined<T>(value: T | undefined, what = "value"): T {
  if (value === undefined) throw new Error(`expected ${what} to be defined`);
  return value;
}
