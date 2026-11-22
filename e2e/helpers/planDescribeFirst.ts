import { expect, type Locator, type Page, type Response } from "@playwright/test";

/**
 * The describe-first field on /plan, addressed by role and name.
 *
 * `getByLabel` matches an accessible name by substring. Since #1402 seated the
 * surface on the `Screen` primitive, the old field label also matched the
 * section itself, whose `aria-labelledby` name was the heading. Two different
 * names, one loose locator, and every caller answered a strict-mode violation.
 * Role plus name keeps the one control the caller means.
 */
export function describeFirstQuery(page: Page): Locator {
  return page.getByRole("textbox", { name: "Where, how many, what budget" });
}

/**
 * The describe-first surface's own painted action.
 *
 * A launch screen has ONE primary (docs/design/LAUNCH_SCREENS.md), and #1402
 * made this one "Plan it". "Make a plan" is the concierge's button inside the
 * composer, which is not mounted until a route, a recovered draft or a held
 * pub makes the composer visible, so it is the wrong control to reach for on a
 * blank /plan.
 */
export function describeFirstSubmit(page: Page): Locator {
  return page.getByRole("button", { name: "Plan it", exact: true });
}

/**
 * /plan leads with a priced route, and the stop picker, the £20 crawl, the Dry
 * round and the examples wait behind Options. The row is a native details
 * element, so it opens before the composer hydrates.
 */
export async function openDescribeFirstOptions(page: Page): Promise<void> {
  const options = page.locator(".planDescribeFirst__options");
  if (!(await options.evaluate((node) => (node as HTMLDetailsElement).open))) {
    await options.locator("summary").click();
  }
}

/**
 * Choose how many pubs the night visits. A tap that lands before React
 * attaches is dropped, so the tap itself is retried until the control answers,
 * which also makes this the wait for a hydrated composer.
 */
export async function chooseDescribeFirstStopCount(
  page: Page,
  stopCount: number,
  timeout = 20_000,
): Promise<void> {
  const choice = page
    .getByRole("group", { name: "Number of pub stops" })
    .getByRole("button", { name: String(stopCount), exact: true });
  await expect(async () => {
    await openDescribeFirstOptions(page);
    await choice.click();
    await expect(choice).toHaveAttribute("aria-pressed", "true", { timeout: 1_000 });
  }).toPass({ timeout });
}

/**
 * Plan a pub crawl, tap "Plan it", and hand back the planner's answer.
 *
 * /plan paints this field on the server, and PlanDescribeFirst keeps it
 * read-only, with its controls aria-disabled, until the composer that owns it
 * has hydrated. Playwright's fill waits for an editable field and its click
 * for an enabled control, so one fill and one tap land on the composer that
 * will keep them, and the route is asked for exactly once.
 */
export async function sortDescribeFirst(
  page: Page,
  query: string,
  { stopCount }: { stopCount?: number } = {},
): Promise<Response> {
  await describeFirstQuery(page).fill(query);
  if (stopCount !== undefined) await chooseDescribeFirstStopCount(page, stopCount);
  const generation = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/plans/generate");
  await describeFirstSubmit(page).click();
  return generation;
}
