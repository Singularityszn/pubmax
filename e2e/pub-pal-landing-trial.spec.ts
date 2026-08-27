import { mkdir } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

const PROOF_DIR = "docs/proof/pub-pal-landing-trial";

async function suppressFirstRun(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
}

test("guest chooses a Pal, receives five answers, then reaches account creation", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await suppressFirstRun(page);
  let asks = 0;
  await page.route("**/api/ask", async (route) => {
    asks += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ venues: [], message: `Grounded guest answer ${asks}.` }),
    });
  });

  await page.goto("/");
  await expect(page.locator('.lpPalEntry[data-ready="true"]')).toBeVisible();
  await page.getByRole("button", { name: "Fox", exact: true }).click();
  await page.getByRole("link", { name: "Text", exact: true }).first().click();
  await expect(page).toHaveURL(/\/pal\/chat\?mode=text&pal=fox$/);
  await expect(page.getByText("Fox", { exact: true })).toBeVisible();

  for (let index = 1; index <= 5; index += 1) {
    await page.getByRole("textbox", { name: "Describe the outing" }).fill(`Question ${index}`);
    await page.getByRole("button", { name: "Ask" }).click();
    await expect(page.getByText(`Grounded guest answer ${index}.`, { exact: true })).toBeVisible();
  }

  const gateHeading = page.getByRole("heading", { name: "Five guest answers complete" });
  await expect(gateHeading).toBeVisible();
  await expect(gateHeading).toBeFocused();
  await expect(page.getByRole("textbox", { name: "Describe the outing" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Create your account" })).toHaveAttribute(
    "href",
    "/login?mode=signup&from=%2Fpal",
  );
  expect(asks).toBe(5);

});

for (const proof of [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 900 },
] as const) {
  test(`captures ${proof.name} Pal-first landing proof`, async ({ page }) => {
    await page.setViewportSize({ width: proof.width, height: proof.height });
    await suppressFirstRun(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Tell your Pub Pal." })).toBeVisible();
    await expect(page.getByRole("link", { name: "Talk", exact: true }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Text", exact: true }).first()).toBeVisible();
    await mkdir(PROOF_DIR, { recursive: true });
    await page.screenshot({
      path: `${PROOF_DIR}/landing-${proof.name}-${proof.width}.png`,
      fullPage: false,
    });
  });
}
