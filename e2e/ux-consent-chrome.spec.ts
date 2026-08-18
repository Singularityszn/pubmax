import { expect, test } from "@playwright/test";

const CONSENT_KEY = "pubmaxx:analytics-consent:v1";
const VIEWPORT = { width: 390, height: 844 };
// Every phone width this repo sweeps. The text column is the viewport minus the
// card insets, its padding, the fixed action column and the gap, so 320 is
// where the disclosure has the least room to wrap inside the 120px ceiling.
const PHONE_WIDTHS = [320, 360, 390] as const;

test.use({ storageState: { cookies: [], origins: [] } });

// max-height alone caps what boundingBox() reports, so the box height can never
// exceed 120 while that declaration stands. scrollHeight is the laid-out
// content, so it is what actually answers whether the card fits its ceiling.
async function consentFit(prompt: import("@playwright/test").Locator) {
  const box = await prompt.boundingBox();
  const scrollHeight = await prompt.evaluate((el) => el.scrollHeight);
  return { boxHeight: box?.height ?? 0, scrollHeight };
}

// Which element actually owns the tap at a control's centre. The prompt is
// tested FIRST, because the failure this answers is the banner lying over
// something else: a probe that claimed the control whenever the control was
// merely in the stack would report the covered case as owned.
async function pointOwner(
  page: import("@playwright/test").Page,
  box: { x: number; y: number; width: number; height: number },
  controlSelector: string,
) {
  return page.evaluate(
    ({ x, y, controlSelector }) => {
      const hit = document.elementFromPoint(x, y);
      if (!hit) return "nothing";
      if (hit.closest(".analyticsConsentPrompt")) return "prompt";
      if (hit.closest(controlSelector)) return "control";
      return hit.tagName.toLowerCase();
    },
    { x: box.x + box.width / 2, y: box.y + box.height / 2, controlSelector },
  );
}

async function prepareUndecidedConsent(
  page: import("@playwright/test").Page,
  viewport: { width: number; height: number } = VIEWPORT,
) {
  await page.setViewportSize(viewport);
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.removeItem("pubmaxx:analytics-consent:v1");
    window.sessionStorage.removeItem("pubmax:prompt-budget:v1");
  });
}

test("mobile consent never covers the tab bar, before or after dismiss", async ({ page }) => {
  test.setTimeout(60_000);
  await prepareUndecidedConsent(page);
  await page.goto("/map/london", { waitUntil: "domcontentloaded" });

  const prompt = page.getByLabel("Anonymous analytics choice");
  await expect(prompt).toBeVisible({ timeout: 30_000 });
  const fit = await consentFit(prompt);
  expect(fit.boxHeight).toBeLessThanOrEqual(120);
  expect(fit.scrollHeight).toBeLessThanOrEqual(120);

  const mapTab = page.getByRole("navigation", { name: "Primary" }).getByRole("link", {
    name: "Map",
    exact: true,
  });
  await expect(mapTab).toBeVisible();

  // WHILE the banner is up. Dismissing it unmounts the card, so an ownership
  // check that only runs afterwards is asking whether an absent element covers
  // anything: the offset shrinking or the card outgrowing its 120px ceiling
  // would put it over the tab bar with nothing failing.
  const coveredBox = await mapTab.boundingBox();
  expect(coveredBox).not.toBeNull();
  expect(await pointOwner(page, coveredBox!, ".mobileTabBar")).toBe("control");

  // The probe can say "prompt", so the assertion above is one the banner can
  // actually lose: its own centre is owned by the banner.
  const promptBox = await prompt.boundingBox();
  expect(promptBox).not.toBeNull();
  expect(await pointOwner(page, promptBox!, ".mobileTabBar")).toBe("prompt");

  await prompt.getByRole("button", { name: "No thanks" }).click();
  await expect(prompt).toBeHidden();

  const tabBox = await mapTab.boundingBox();
  expect(tabBox).not.toBeNull();
  expect(await pointOwner(page, tabBox!, ".mobileTabBar")).toBe("control");
});

test("mobile consent never covers the landing CTA, before or after dismiss", async ({ page }) => {
  test.setTimeout(60_000);
  await prepareUndecidedConsent(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const prompt = page.getByLabel("Anonymous analytics choice");
  await expect(prompt).toBeVisible();
  const fit = await consentFit(prompt);
  expect(fit.boxHeight).toBeLessThanOrEqual(120);
  expect(fit.scrollHeight).toBeLessThanOrEqual(120);

  const findMyPint = page.locator(".lpHeroActions").getByRole("link", { name: "Find my pint" });
  await expect(findMyPint).toBeVisible();

  // The root path renders no tab bar, so the card sits at the safe-area floor
  // here rather than above the bar. Find my pint is the ONE primary action on
  // this page, and it is checked while the banner is still up.
  const coveredBox = await findMyPint.boundingBox();
  expect(coveredBox).not.toBeNull();
  expect(await pointOwner(page, coveredBox!, ".lpHeroActions")).toBe("control");

  const promptBox = await prompt.boundingBox();
  expect(promptBox).not.toBeNull();
  expect(await pointOwner(page, promptBox!, ".lpHeroActions")).toBe("prompt");

  await prompt.getByRole("button", { name: "No thanks" }).click();
  await expect(prompt).toBeHidden();
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), CONSENT_KEY)).toBe(
    "denied",
  );

  const ctaBox = await findMyPint.boundingBox();
  expect(ctaBox).not.toBeNull();
  expect(await pointOwner(page, ctaBox!, ".lpHeroActions")).toBe("control");
});

for (const width of PHONE_WIDTHS) {
  test(`the whole disclosure and its privacy link fit the card @${width}`, async ({ page }) => {
    test.setTimeout(60_000);
    await prepareUndecidedConsent(page, { width, height: 844 });
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const prompt = page.getByLabel("Anonymous analytics choice");
    await expect(prompt).toBeVisible();

    // The sentence states what is collected and that it is never sold, so no
    // part of it may be dropped to make the card fit. A clamp hides text by
    // height rather than by visibility, so the paragraph is measured: laid-out
    // content taller than the box it is painted in means something was cut.
    const copy = prompt.locator("p");
    await expect(copy).toContainText(
      "PUBMAXXING uses optional analytics to see what people use. Never sold, no ads.",
    );
    const copyOverflow = await copy.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));
    expect(copyOverflow.scrollHeight).toBeLessThanOrEqual(copyOverflow.clientHeight + 1);

    // The banner is the one consent surface, so its route to /privacy may never
    // be what a height ceiling cuts.
    const privacy = prompt.getByRole("link", { name: "Privacy" });
    await expect(privacy).toBeVisible();
    await expect(privacy).toHaveAttribute("href", "/privacy");
    const privacyBox = await privacy.boundingBox();
    const promptBox = await prompt.boundingBox();
    expect(privacyBox).not.toBeNull();
    expect(promptBox).not.toBeNull();
    expect(privacyBox!.height).toBeGreaterThanOrEqual(44);
    expect(privacyBox!.y + privacyBox!.height).toBeLessThanOrEqual(
      promptBox!.y + promptBox!.height,
    );

    const fit = await consentFit(prompt);
    expect(fit.boxHeight).toBeLessThanOrEqual(120);
    expect(fit.scrollHeight).toBeLessThanOrEqual(120);
  });
}
