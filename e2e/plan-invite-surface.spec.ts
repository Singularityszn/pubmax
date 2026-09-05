import { expect, test, type Page } from "@playwright/test";

// The invite surface on a Plan page.
//
//   M04 (core-loop battle test, 5 Sep 2026) "New link" rotated the token and
//       said so, while the Send on WhatsApp href beside it still carried the old
//       one. The old token is refused, so a host who shared straight away sent a
//       dead link.

const HOST_ACTION_BUDGET_MS = 20_000;

/** The composer needs React attached before a tap counts. */
async function openHydratedPlanComposer(page: Page): Promise<void> {
  await page.goto("/plan");
  const stopCount = page
    .getByRole("group", { name: "Number of pub stops" })
    .getByRole("button", { name: "4", exact: true });
  await expect(async () => {
    await stopCount.click();
    await expect(stopCount).toHaveAttribute("aria-pressed", "true", { timeout: 1_000 });
  }).toPass({ timeout: HOST_ACTION_BUDGET_MS });
}

/** London-local `datetime-local` value a few hours out. */
function futureLondonFirstPint(): string {
  const when = new Date(Date.now() + 3 * 60 * 60 * 1000);
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

function inviteTokenFromHref(href: string | null): string | null {
  if (!href) return null;
  return decodeURIComponent(href).match(/invite=([0-9a-f]{32})/)?.[1] ?? null;
}

async function describeAPlan(page: Page): Promise<void> {
  await openHydratedPlanComposer(page);
  await page
    .getByRole("textbox", { name: "Describe the outing" })
    .fill("Quiet in Clapham for 4, not pricey");
  await page.getByRole("button", { name: "Sort it" }).click();
  await expect(page.getByText("Route refreshed. Review the preview")).toBeVisible();
}

test("M04: rotating the invite link re-points the WhatsApp share href", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmax:identityNudge:dismissedAt:v1", String(Date.now()));
  });
  await describeAPlan(page);
  await page.getByLabel("Your name").fill("Karan");
  await page.getByLabel("First pint").fill(futureLondonFirstPint());
  await page.getByRole("button", { name: "Regenerate route" }).click();
  await expect(page.getByText("Route refreshed. Review the preview")).toBeVisible();
  await expect(page.getByRole("button", { name: "Lock it in" })).toBeEnabled();
  await page.getByRole("button", { name: "Lock it in" }).click();
  await expect(page).toHaveURL(/\/plan\/[0-9a-f-]{36}/);

  const share = page.getByRole("link", { name: "Send on WhatsApp" });
  await expect(share).toBeVisible({ timeout: HOST_ACTION_BUDGET_MS });
  const before = inviteTokenFromHref(await share.getAttribute("href"));
  expect(before, "the share href carries an invite token before rotating").toBeTruthy();

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "New link" }).click();
  await expect(page.locator(".planHostInviteLink__status")).toHaveText(
    "New link ready. The old one stopped working.",
    { timeout: HOST_ACTION_BUDGET_MS },
  );

  // The share href is the thing a host actually taps, and it must be the live
  // token with no reload in between.
  await expect
    .poll(async () => inviteTokenFromHref(await share.getAttribute("href")), {
      timeout: HOST_ACTION_BUDGET_MS,
    })
    .not.toBe(before);

  const planId = page.url().replace(/#.*$/, "").split("/plan/")[1]!;
  const live = await page.evaluate(async (id) => {
    const response = await fetch(`/api/plans/${id}`, { cache: "no-store" });
    return (await response.json()) as { inviteToken?: string | null };
  }, planId);
  expect(inviteTokenFromHref(await share.getAttribute("href"))).toBe(live.inviteToken);
});
