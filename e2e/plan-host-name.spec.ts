import { expect, test, type Page } from "@playwright/test";

import { ACCOUNTS, AUTH_STORAGE_KEY, installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";

// Core-loop battle test, 5 Sep 2026: L05. "Your name" in the Plan composer
// defaulted to the account's EMAIL local part, and that name is then the public
// host name on the plan, on the share card and in the unfurler, so a link that
// reached a whole group announced "pentest.alice is planning a night out".

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

async function describeAPlan(page: Page): Promise<void> {
  await openHydratedPlanComposer(page);
  await page
    .getByRole("textbox", { name: "Describe the outing" })
    .fill("Quiet in Clapham for 4, not pricey");
  await page.getByRole("button", { name: "Sort it" }).click();
  await expect(page.getByText("Route refreshed. Review the preview")).toBeVisible();
}

test("L05: the composer's Your name is the public handle, never the email", async ({ page }) => {
  await installAuthDoubles(page);
  await seedSignedIn(page, "B");
  // The doubles hand every account a provider display name. The accounts this
  // defect was found on carry none, which is exactly why the composer fell
  // through to the email local part, so this one carries none either.
  await page.addInitScript((key) => {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return;
      const session = JSON.parse(raw) as { user?: { user_metadata?: unknown } };
      if (session?.user) session.user.user_metadata = {};
      window.localStorage.setItem(key, JSON.stringify(session));
    } catch {
      // A storage-restricted browser signs nobody in, and the test below fails.
    }
  }, AUTH_STORAGE_KEY);

  // "Your name" lives on the full composer, which describe-first opens once a
  // route exists, so the field is reached the way a host reaches it.
  await describeAPlan(page);

  const emailLocalPart = ACCOUNTS.B.email.split("@")[0]!;
  expect(emailLocalPart, "the fixture account's handle and email differ").not.toBe(
    ACCOUNTS.B.handle,
  );
  const name = page.getByLabel("Your name");
  await expect(name).toHaveValue(ACCOUNTS.B.handle, { timeout: HOST_ACTION_BUDGET_MS });
  await expect(name).not.toHaveValue(emailLocalPart);
});

