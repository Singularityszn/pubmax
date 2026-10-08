import { expect, type Page } from "@playwright/test";

const HOUR_MS = 60 * 60 * 1000;

function londonHour(when: Date): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hourCycle: "h23" }).format(when));
}

/**
 * Hold the page's clock at the next 18:00 in London. The Plan heading reads the
 * night out from the page's clock, and a night runs until 05:00, so a run between
 * 04:00 and 05:00 would otherwise read the coming evening as "Tomorrow". The
 * time is still ahead of the server's, so a First pint built from it is in the
 * future there too.
 */
export async function pinLondonEvening(page: Page): Promise<Date> {
  let at = Math.ceil((Date.now() + 1) / HOUR_MS) * HOUR_MS;
  while (londonHour(new Date(at)) !== 18) at += HOUR_MS;
  const evening = new Date(at);
  await page.clock.setFixedTime(evening);
  return evening;
}

/** A `datetime-local` value in London, `minutes` after `base`. */
function londonDateTimeIn(minutes: number, base: number): string {
  const when = new Date(base + minutes * 60 * 1000);
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
 * Set First pint to a London time `minutes` from the page's now, and prove the composer
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
  const base = await page.evaluate(() => Date.now());
  const candidate = londonDateTimeIn(minutes, base);
  const value = candidate === current ? londonDateTimeIn(minutes + 1, base) : candidate;
  await field.fill(value);
  await expect(page.getByRole("button", { name: "Regenerate route" })).toBeVisible();
  return value;
}
