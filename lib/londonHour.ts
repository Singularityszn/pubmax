/**
 * The hour-of-day in the Europe/London wall clock — pub presence follows London
 * evenings regardless of where the server runs. Deterministic for a given Date.
 *
 * This is a LEAF module on purpose. The nav model reads it to decide the Now
 * tab href, and the nav model is mounted in the root layout, so it may not drag
 * a module graph behind it: reading the hour off lib/ambientPresence shipped the
 * demo Pint Drop rosters to every route for one Intl call.
 */
export function londonHour(date: Date): number {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      hour12: false,
      timeZone: "Europe/London",
    }).format(date),
  );
  // Intl renders midnight as "24" in some ICU builds — normalize to 0–23.
  return Number.isFinite(hour) ? hour % 24 : 0;
}
