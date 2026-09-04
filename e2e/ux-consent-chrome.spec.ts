import { expect, test } from "@playwright/test";

import { LANDING_PRIMARY_NAME } from "./helpers/landingHero";

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

// The first-run surface is native-only and every one of its blocks is sized to
// the viewport, so the ordinary body foot padding cannot lift it out of a fixed
// bottom card's way. prepareUndecidedConsent below dismisses onboarding on
// purpose; this route is the one place that marker may not be set, so it gets
// its own preparation: a Capacitor bridge (the ONE probe lib/nativePlatform.ts
// reads) plus the one-time eligibility handoff the native root issues before
// it replaces `/` with /onboarding. The handoff is written here rather than
// earned by booting `/` because the ROOT decision is another spec's subject
// (e2e/mobile-first-run-onboarding.spec.ts) and a redirect that has not landed
// yet would fail this one for a reason it does not own. The surface the gate
// then mounts is the same surface either way.
async function prepareFirstRunOnboarding(
  page: import("@playwright/test").Page,
  viewport: { width: number; height: number },
) {
  await page.setViewportSize(viewport);
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.addInitScript(() => {
    Object.defineProperty(window, "Capacitor", {
      configurable: true,
      value: { isNativePlatform: () => true, getPlatform: () => "ios" },
    });
    window.sessionStorage.setItem(
      "pubmax:nativeFirstRun:handoff:v1",
      String(Date.now()),
    );
    window.localStorage.removeItem("pubmaxx:analytics-consent:v1");
    window.sessionStorage.removeItem("pubmax:prompt-budget:v1");
  });
}

type Box = { x: number; y: number; width: number; height: number };

/** Do two rendered rectangles share any area at all. */
function boxesOverlap(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width
    && b.x < a.x + a.width
    && a.y < b.y + b.height
    && b.y < a.y + a.height
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

  const planTonight = page.locator(".lpHero .screenActions").getByRole("link", { name: LANDING_PRIMARY_NAME });
  await expect(planTonight).toBeVisible();

  // Landing mounts the same phone tab bar as every other route, so the consent
  // card sits above the bar rather than on the safe-area floor. The receipt
  // door is the ONE primary action on this page, and it is checked while the
  // banner is still up.
  const coveredBox = await planTonight.boundingBox();
  expect(coveredBox).not.toBeNull();
  expect(await pointOwner(page, coveredBox!, ".lpHero .screenActions")).toBe("control");

  const promptBox = await prompt.boundingBox();
  expect(promptBox).not.toBeNull();
  expect(await pointOwner(page, promptBox!, ".lpHero .screenActions")).toBe("prompt");

  await prompt.getByRole("button", { name: "No thanks" }).click();
  await expect(prompt).toBeHidden();
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), CONSENT_KEY)).toBe(
    "denied",
  );

  const ctaBox = await planTonight.boundingBox();
  expect(ctaBox).not.toBeNull();
  expect(await pointOwner(page, ctaBox!, ".lpHero .screenActions")).toBe("control");
});

test("mobile consent never covers Today last-train while visible", async ({ page }) => {
  test.setTimeout(60_000);
  await prepareUndecidedConsent(page);
  await page.goto("/today", { waitUntil: "domcontentloaded" });

  const prompt = page.getByLabel("Anonymous analytics choice");
  await expect(prompt).toBeVisible({ timeout: 30_000 });

  const lastTrain = page.locator(".todayButton").first();
  await expect(lastTrain).toBeVisible();
  await lastTrain.scrollIntoViewIfNeeded();

  const coveredBox = await lastTrain.boundingBox();
  expect(coveredBox).not.toBeNull();
  expect(await pointOwner(page, coveredBox!, ".todayButton")).toBe("control");
});

test("mobile consent never covers Plan primary action while visible", async ({ page }) => {
  test.setTimeout(60_000);
  await prepareUndecidedConsent(page);
  await page.goto("/plan", { waitUntil: "domcontentloaded" });

  const prompt = page.getByLabel("Anonymous analytics choice");
  await expect(prompt).toBeVisible({ timeout: 30_000 });

  // /plan opens on describe-first, whose ONE painted action is "Sort it".
  // The rule this test owns is about the ROUTE's primary action, so it is read
  // off the Screen's own [data-primary-action] marker rather than named copy
  // alone: the marker is what makes exactly one control the primary, and a
  // later rename of the label cannot quietly leave the rule untested.
  const planPrimary = page
    .locator("[data-primary-action]")
    .getByRole("button", { name: "Sort it", exact: true });
  await expect(planPrimary).toBeVisible();
  await planPrimary.scrollIntoViewIfNeeded();

  const coveredBox = await planPrimary.boundingBox();
  expect(coveredBox).not.toBeNull();
  expect(await pointOwner(page, coveredBox!, "button")).toBe("control");
});

test("mobile consent never covers /pubs Book a table while visible", async ({ page }) => {
  test.setTimeout(60_000);
  await prepareUndecidedConsent(page);
  await page.goto("/pubs", { waitUntil: "domcontentloaded" });

  const prompt = page.getByLabel("Anonymous analytics choice");
  await expect(prompt).toBeVisible({ timeout: 30_000 });

  const bookLink = page.locator(".pubsBookLink").first();
  await expect(bookLink).toBeVisible({ timeout: 30_000 });
  await bookLink.scrollIntoViewIfNeeded();

  const coveredBox = await bookLink.boundingBox();
  expect(coveredBox).not.toBeNull();
  expect(await pointOwner(page, coveredBox!, ".pubsBookLink")).toBe("control");
});

for (const width of PHONE_WIDTHS) {
  test(`the whole disclosure and its privacy link fit the card @${width}`, async ({ page }) => {
    test.setTimeout(60_000);
    await prepareUndecidedConsent(page, { width, height: 844 });
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const prompt = page.getByLabel("Anonymous analytics choice");
    await expect(prompt).toBeVisible();

    // The sentence states what is collected and that it is never sold, so no
    // part of it may be dropped to make the card fit. Whether the WHOLE card
    // stayed inside its ceiling is consentFit's scrollHeight above; what this
    // one owns is that the sentence itself is still all there.
    // Painted product chrome names the BRAND, never the app (lib/brandNaming.ts),
    // so this banner reads PUBMAXX beside a wordmark that reads the same.
    // __tests__/analyticsConsentPrompt.test.ts owns that wording.
    const copy = prompt.locator("p");
    await expect(copy).toContainText(
      "PUBMAXX uses optional analytics to see what people use. Never sold, no ads.",
    );

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

// Every phone width the first-run surface is reviewed at. 430x932 is the
// iPhone 17 Pro the simulator proof was shot on, which is where the card was
// found lying across the reviewed-area rows and the "Use London" button.
const ONBOARDING_VIEWPORTS = [
  { width: 320, height: 844 },
  { width: 360, height: 844 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
] as const;

for (const viewport of ONBOARDING_VIEWPORTS) {
  test(`consent never covers first-run onboarding @${viewport.width}`, async ({ page }) => {
    test.setTimeout(60_000);
    await prepareFirstRunOnboarding(page, viewport);
    await page.goto("/onboarding", { waitUntil: "domcontentloaded" });

    const prompt = page.getByLabel("Anonymous analytics choice");
    await expect(prompt).toBeVisible({ timeout: 30_000 });

    const rows = page.locator(".firstRunAreaList article");
    await expect(rows.first()).toBeVisible();
    const primary = page.getByRole("button", { name: "Use London" });
    await expect(primary).toBeVisible();

    const promptBox = await prompt.boundingBox();
    expect(promptBox).not.toBeNull();

    // The card may share no area with a reviewed row or with the ONE primary
    // action. Geometry rather than a tap probe, because a row is a passive
    // block: a probe that only asked who owns a point would pass over a row
    // half-hidden behind the card.
    const rowBoxes = await rows.evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }),
    );
    expect(rowBoxes.length).toBeGreaterThan(0);
    for (const rowBox of rowBoxes) {
      expect(boxesOverlap(promptBox!, rowBox)).toBe(false);
    }
    const primaryBox = await primary.boundingBox();
    expect(primaryBox).not.toBeNull();
    expect(boxesOverlap(promptBox!, primaryBox!)).toBe(false);

    // Not-covered is not the whole promise. The surface holds its own scroller
    // while the card is up, so an action laid out past its end is off screen
    // with nothing saying so: on a 390pt phone the button sat at 768px inside
    // a 704px surface and no reviewer would ever have found it.
    await expect(primary).toBeInViewport({ ratio: 1 });
    for (const row of await rows.all()) {
      await expect(row).toBeInViewport({ ratio: 1 });
    }

    // The tap at the button's own centre reaches the button.
    expect(await pointOwner(page, primaryBox!, ".firstRunPrimary")).toBe("control");
    // ...and the probe is one this card can lose: its own centre is its own.
    expect(await pointOwner(page, promptBox!, ".firstRunPrimary")).toBe("prompt");

    // Answering the card gives the surface its full height back, so the lane
    // stops being reserved and the designed photograph band returns. At the
    // narrowest widths that pushes the action below the fold again, which is
    // the surface's own composition rather than anything this card does: what
    // is owed here is that the action is still REACHABLE once the card is
    // gone, on a surface that scrolls to it.
    await prompt.getByRole("button", { name: "No thanks" }).click();
    await expect(prompt).toBeHidden();
    // scrollIntoViewIfNeeded settles on a fractional offset, so the last half
    // pixel is the scroller's rounding rather than a covered control.
    await primary.scrollIntoViewIfNeeded();
    await expect(primary).toBeInViewport({ ratio: 0.99 });
  });
}
