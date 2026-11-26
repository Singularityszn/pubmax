/** @param {unknown} date */
export function currentClosure(date, now = Date.now()) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const observed = Date.parse(`${date}T00:00:00Z`);
  const age = now - observed;
  return Number.isFinite(observed) && age >= 0 && age < 365 * 24 * 60 * 60 * 1000;
}
