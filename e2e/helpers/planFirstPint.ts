import { expect, type Page } from "@playwright/test";

/** A `datetime-local` value in London, `minutes` from now. */
function londonDateTimeIn(minutes: number): string {
  const when = new Date(Date.now() + minutes * 60 * 1000);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(when);
  const lookup = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${lookup("year")}-${lookup("month")}-${lookup("day")}T${lookup("hour")}:${lookup("minute")}`;
}

/**
 * Set First pint to a London time `minutes` from now, and prove the composer
 * treated it as a change.
 *
 * A bare `fill` of a computed time is not a change: the generator answers an
 * evening daypart with an on-the-hour start (18:00 London), so an offset that
 * happens to land on that hour writes the value already in the field, fires no
 * input event, leaves the route fresh, and the "Regenerate route" control the
 * caller reaches for next never appears. That is one clock minute a day per
 * offset, which is exactly the kind of red nobody can reproduce. One minute
 * later is still the same night and is always a change.
 */
export async function setFirstPintIn(page: Page, minutes: number): Promise<string> {
  const field = page.getByLabel("First pint");
  const current = await field.inputValue();
  const candidate = londonDateTimeIn(minutes);
  const value = candidate === current ? londonDateTimeIn(minutes + 1) : candidate;
  await field.fill(value);
  await expect(page.getByRole("button", { name: "Regenerate route" })).toBeVisible();
  return value;
}
