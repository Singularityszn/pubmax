import { expect, type Locator, type Page, type Request, type Response } from "@playwright/test";

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
 * Describe the outing and tap "Sort it" once the composer will keep both, and
 * hand back the planner's answer.
 *
 * /plan paints this field on the server, and PlanComposer remounts its form
 * under a fresh key the moment hydration lands. Text typed or a tap made
 * before that remount is thrown away, so a lone fill and click right after
 * `goto` sometimes asks for nothing and the spec waits out its whole budget
 * for a route nobody requested. Retry the fill and the tap until the planner
 * request has gone out, and never after, so a route is asked for once.
 */
export async function sortDescribeFirst(
  page: Page,
  query: string,
  { stopCount }: { stopCount?: number } = {},
): Promise<Response> {
  const asked: { generation?: Request } = {};
  const onRequest = (request: Request) => {
    if (
      !asked.generation &&
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/plans/generate"
    ) {
      asked.generation = request;
    }
  };
  page.on("request", onRequest);
  try {
    await expect(async () => {
      if (!asked.generation) {
        await describeFirstQuery(page).fill(query);
        if (stopCount !== undefined) {
          const stopButton = page
            .getByRole("group", { name: "Number of pub stops" })
            .getByRole("button", { name: String(stopCount), exact: true });
          if (await stopButton.getAttribute("aria-pressed") !== "true") await stopButton.click();
        }
        await describeFirstSubmit(page).click();
      }
      await expect.poll(() => asked.generation !== undefined, { timeout: 2_000 }).toBe(true);
    }).toPass({ timeout: 20_000 });
  } finally {
    page.off("request", onRequest);
  }
  const response = await asked.generation?.response();
  if (!response) throw new Error("The planner request went out but got no response.");
  return response;
}
