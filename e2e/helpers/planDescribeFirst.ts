import type { Locator, Page, Response } from "@playwright/test";

/**
 * The describe-first field on /plan, addressed by role and name.
 *
 * `getByLabel("Describe the outing")` matches an accessible name by substring.
 * Since #1402 seated the surface on the `Screen` primitive, that also matches
 * the section itself, whose `aria-labelledby` name is "Describe the outing.
 * We’ll put it in order." Two different names, one loose locator, and every
 * caller answered a strict-mode violation. Role plus name keeps the one
 * control the caller means.
 */
export function describeFirstQuery(page: Page): Locator {
  return page.getByRole("textbox", { name: "Describe the outing" });
}

/**
 * The describe-first surface's own painted action.
 *
 * A launch screen has ONE primary (docs/design/LAUNCH_SCREENS.md), and #1402
 * made this one "Sort it". "Make a plan" is the concierge's button inside the
 * composer, which is not mounted until a route, a recovered draft or a held
 * pub makes the composer visible, so it is the wrong control to reach for on a
 * blank /plan.
 */
export function describeFirstSubmit(page: Page): Locator {
  return page.getByRole("button", { name: "Sort it", exact: true });
}

/**
 * Describe the outing, tap "Sort it", and hand back the planner's answer.
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
  if (stopCount !== undefined) {
    const stopButton = page
      .getByRole("group", { name: "Number of pub stops" })
      .getByRole("button", { name: String(stopCount), exact: true });
    if (await stopButton.getAttribute("aria-pressed") !== "true") await stopButton.click();
  }
  const generation = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/plans/generate");
  await describeFirstSubmit(page).click();
  return generation;
}
