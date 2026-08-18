import { expect, test } from "@playwright/test";

const CONSENT_KEY = "pubmaxx:analytics-consent:v1";
const VIEWPORT = { width: 390, height: 844 };

test.use({ storageState: { cookies: [], origins: [] } });

async function prepareUndecidedConsent(page: import("@playwright/test").Page) {
  await page.setViewportSize(VIEWPORT);
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.removeItem("pubmaxx:analytics-consent:v1");
    window.sessionStorage.removeItem("pubmax:prompt-budget:v1");
  });
}

test("mobile consent stays within 120px and clears the tab bar after dismiss", async ({ page }) => {
  test.setTimeout(60_000);
  await prepareUndecidedConsent(page);
  await page.goto("/map/london", { waitUntil: "domcontentloaded" });

  const prompt = page.getByLabel("Anonymous analytics choice");
  await expect(prompt).toBeVisible({ timeout: 30_000 });
  const promptBox = await prompt.boundingBox();
  expect(promptBox?.height ?? 0).toBeLessThanOrEqual(120);

  await prompt.getByRole("button", { name: "No thanks" }).click();
  await expect(prompt).toBeHidden();

  const mapTab = page.getByRole("navigation", { name: "Primary" }).getByRole("link", {
    name: "Map",
    exact: true,
  });
  await expect(mapTab).toBeVisible();
  const tabBox = await mapTab.boundingBox();
  expect(tabBox).not.toBeNull();
  const owner = await page.evaluate(
    ({ x, y }) => {
      const hit = document.elementFromPoint(x, y);
      if (!hit) return "nothing";
      if (hit.closest(".mobileTabBar")) return "tab";
      if (hit.closest(".analyticsConsentPrompt")) return "prompt";
      return hit.tagName.toLowerCase();
    },
    { x: tabBox!.x + tabBox!.width / 2, y: tabBox!.y + tabBox!.height / 2 },
  );
  expect(owner).toBe("tab");
});

test("mobile consent does not cover the landing primary CTA after dismiss", async ({ page }) => {
  test.setTimeout(60_000);
  await prepareUndecidedConsent(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const prompt = page.getByLabel("Anonymous analytics choice");
  await expect(prompt).toBeVisible();
  const promptBox = await prompt.boundingBox();
  expect(promptBox?.height ?? 0).toBeLessThanOrEqual(120);

  await prompt.getByRole("button", { name: "No thanks" }).click();
  await expect(prompt).toBeHidden();
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), CONSENT_KEY)).toBe(
    "denied",
  );

  const findMyPint = page.locator(".lpHeroActions").getByRole("link", { name: "Find my pint" });
  await expect(findMyPint).toBeVisible();
  const ctaBox = await findMyPint.boundingBox();
  expect(ctaBox).not.toBeNull();
  const owner = await page.evaluate(
    ({ x, y }) => {
      const hit = document.elementFromPoint(x, y);
      if (!hit) return "nothing";
      if (hit.closest(".lpHeroActions")) return "cta";
      if (hit.closest(".analyticsConsentPrompt")) return "prompt";
      return hit.tagName.toLowerCase();
    },
    { x: ctaBox!.x + ctaBox!.width / 2, y: ctaBox!.y + ctaBox!.height / 2 },
  );
  expect(owner).toBe("cta");
});
