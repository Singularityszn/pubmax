import { expect, type Page } from "@playwright/test";

import { describeFirstQuery, describeFirstSubmit } from "./planDescribeFirst";

export const CAPABILITY_COOKIE = (planId: string) => `pubmax_plan_member_${planId}`;
export const RECOVERY_OBSERVATION_BUDGET_MS = 20_000;

/** The composer needs React attached before a tap counts. */
async function openHydratedPlanComposer(page: Page): Promise<void> {
  await page.goto("/plan");
  const stopCount = page
    .getByRole("group", { name: "Number of pub stops" })
    .getByRole("button", { name: "4", exact: true });
  await expect(async () => {
    await stopCount.click();
    await expect(stopCount).toHaveAttribute("aria-pressed", "true", { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
}

/** London-local `datetime-local` value a couple of hours out. */
function futureLondonFirstPint(): string {
  const when = new Date(Date.now() + 2 * 60 * 60 * 1000);
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

export function trackMainFrameDocumentNavigations(page: Page): () => number {
  let documentRequests = 0;
  page.on("request", (request) => {
    if (
      request.isNavigationRequest()
      && request.resourceType() === "document"
      && request.frame() === page.mainFrame()
    ) {
      documentRequests += 1;
    }
  });
  return () => documentRequests;
}

/** Create a real Plan as the signed-in host and answer its id. */
export async function lockInAPlan(
  page: Page,
  options: { waitForAccountClaim?: boolean } = {},
): Promise<string> {
  await openHydratedPlanComposer(page);
  await describeFirstQuery(page).fill("Quiet in Clapham for 4, not pricey");
  await describeFirstSubmit(page).click();
  await expect(page.getByText("Route refreshed. Review the preview")).toBeVisible();
  await page.getByLabel("Your name").fill("Karan");
  await page.getByLabel("First pint").fill(futureLondonFirstPint());
  await page.getByRole("button", { name: "Regenerate route" }).click();
  await expect(page.getByText("Route refreshed. Review the preview")).toBeVisible();
  await expect(page.getByRole("button", { name: "Lock it in" })).toBeEnabled();
  const claim = options.waitForAccountClaim
    ? page.waitForResponse(
        (response) =>
          response.request().method() === "PUT"
          && /\/api\/plans\/[0-9a-f-]{36}\/session$/.test(response.url())
          && response.ok(),
        { timeout: RECOVERY_OBSERVATION_BUDGET_MS },
      )
    : null;
  await page.getByRole("button", { name: "Lock it in" }).click();
  await expect(page).toHaveURL(/\/plan\/[0-9a-f-]{36}/);
  if (claim) await claim;
  return page.url().replace(/#.*$/, "").split("/plan/")[1]!;
}

/** Drop the HttpOnly capability cookie, leaving every other cookie alone. */
export async function loseTheCapabilityCookie(page: Page, planId: string): Promise<void> {
  const context = page.context();
  const name = CAPABILITY_COOKIE(planId);
  const cookies = await context.cookies();
  expect(
    cookies.some((cookie) => cookie.name === name),
    "the capability cookie exists before the reset",
  ).toBe(true);
  const kept = cookies.filter((cookie) => cookie.name !== name);
  await context.clearCookies();
  await context.addCookies(kept);
  expect(
    (await context.cookies()).some((cookie) => cookie.name === name),
    "the capability cookie is gone before the reload",
  ).toBe(false);
}

