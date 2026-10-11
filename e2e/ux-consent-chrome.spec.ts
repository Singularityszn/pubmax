import { expect, test } from "@playwright/test";

import { LANDING_PRIMARY_NAME } from "./helpers/landingHero";
import { installNativeShell } from "./helpers/nativeShell";

const CONSENT_KEY = "pubmaxx:analytics-consent:v1";
const VIEWPORT = { width: 390, height: 844 };
// The card is one row (site audit 13 Sep 2026, D3): the sentence beside both
// choices, 44px controls in a 56px strip. e2e/first-run-chrome-share.spec.ts
// owns the row's own shape; every coverage case below re-asks the ceiling.
const CONSENT_ROW_CEILING = 56;
// Every phone width this repo sweeps. The text column is the viewport minus the
// card insets, its padding, both inline choices and the gap, so 320 is where
// the disclosure has the least room to wrap inside the 56px ceiling.
const PHONE_WIDTHS = [320, 360, 390] as const;

test.use({ storageState: { cookies: [], origins: [] } });

// max-height alone caps what boundingBox() reports, so the box height can never
// exceed the ceiling while that declaration stands. scrollHeight is the laid-out
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
  await installNativeShell(page);
  await page.addInitScript(() => {
    window.sessionStorage.setItem(
      "pubmax:nativeFirstRun:handoff:v1",
      String(Date.now()),
    );
    window.localStorage.removeItem("pubmaxx:analytics-consent:v1");
    window.sessionStorage.removeItem("pubmax:prompt-budget:v1");
    // The first-run surface is this spec's subject, not the card's wait, so
    // the answer moment is seeded here too (see prepareUndecidedConsent).
    window.sessionStorage.setItem(
      "pubmax:consent-answer-moment:v1",
      "venue-sheet",
    );
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
    // THE CARD WAITS FOR THE PRODUCT TO ANSWER (lib/consentAnswerMoment.ts).
    // Every test below is about the card's GEOMETRY once it is on screen, so
    // each one seeds the answer that ends that wait rather than driving a pub
    // sheet open first. The timing rule itself is
    // e2e/consent-after-first-answer.spec.ts, which seeds nothing.
    window.sessionStorage.setItem(
      "pubmax:consent-answer-moment:v1",
      "venue-sheet",
    );
  });
}

test("mobile consent never covers the tab bar, before or after dismiss", async ({ page }) => {
  test.setTimeout(60_000);
  await prepareUndecidedConsent(page);
  // A COLD map gives its lower edge to the First visit card once the pins
  // reveal, and the card takes consent down behind it
  // (lib/mapFirstVisitArrival.ts). This test is about consent over the tab
  // bar, so the map has already had its first visit.
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
  });
  await page.goto("/map/london", { waitUntil: "domcontentloaded" });

  const prompt = page.getByLabel("Anonymous analytics choice");
  await expect(prompt).toBeVisible({ timeout: 30_000 });
  const fit = await consentFit(prompt);
  expect(fit.boxHeight).toBeLessThanOrEqual(CONSENT_ROW_CEILING);
  expect(fit.scrollHeight).toBeLessThanOrEqual(CONSENT_ROW_CEILING);

  const mapTab = page.getByRole("navigation", { name: "Primary" }).getByRole("link", {
    name: "Map",
    exact: true,
  });
  await expect(mapTab).toBeVisible();

  // WHILE the banner is up. Dismissing it unmounts the card, so an ownership
  // check that only runs afterwards is asking whether an absent element covers
  // anything: the offset shrinking or the card outgrowing its 56px ceiling
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
  expect(fit.boxHeight).toBeLessThanOrEqual(CONSENT_ROW_CEILING);
  expect(fit.scrollHeight).toBeLessThanOrEqual(CONSENT_ROW_CEILING);

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

// A KEYBOARD READER REACHES /social's FORM WITHOUT SCROLLING BY HAND. The
// browser only scrolls a focused control into view past the root's
// scroll-padding, so a page rule that sets its own padding must still keep
// the card's lane in it, or Tab parks the Handle field under the card.
test("mobile consent never covers a control keyboard focus lands on in /social", async ({ page }) => {
  test.setTimeout(90_000);
  await prepareUndecidedConsent(page);
  await page.goto("/social", { waitUntil: "domcontentloaded" });

  const prompt = page.getByLabel("Anonymous analytics choice");
  await expect(prompt).toBeVisible({ timeout: 30_000 });
  // A document load streams the page into a hidden segment before React swaps
  // it in, so for that window the document holds two `.socialPage` mains. The
  // painted one is the page a reader can Tab through.
  const socialPage = page.locator(".socialPage:visible");
  await expect(socialPage).toBeVisible({ timeout: 30_000 });
  // The viewer check answers after first paint, and its answer re-lays the
  // rail above the Handle field by about 150px. A field focused before that
  // is pushed under the card with no scroll, so Tab walks the settled page.
  await expect(socialPage.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 30_000 });

  const covered: string[] = [];
  for (let press = 0; press < 60; press += 1) {
    await page.keyboard.press("Tab");
    const hit = await page.evaluate(() => {
      const focused = document.activeElement as HTMLElement | null;
      const card = document.querySelector(".analyticsConsentPrompt");
      if (!focused || focused === document.body || !card || card.contains(focused)) return null;
      if (focused.closest(".mobileTabBar")) return null;
      const box = focused.getBoundingClientRect();
      const lane = card.getBoundingClientRect();
      if (box.height === 0 || box.bottom <= lane.top || box.top >= lane.bottom) return null;
      return `${focused.tagName.toLowerCase()} "${focused.getAttribute("aria-label") ?? focused.textContent?.trim().slice(0, 40)}" ${Math.round(box.top)}-${Math.round(box.bottom)} under ${Math.round(lane.top)}`;
    });
    if (hit) covered.push(hit);
  }
  expect(covered).toEqual([]);
});

// EVERY PHONE IS A HEIGHT, AND THE SHORT ONES ARE WHERE THIS CARD BITES.
//
// The coverage tests above run at 390x844, which is where the card has the most
// room to be harmless. PlanAstra measured the two shorter phones this repo
// already sweeps for width: at 320x568 the card sat over the landing's
// next-cheapest rail, and at 360x640 it covered Tonight's quiet-night copy and
// the one door under it. The card is fixed and the first screen is short, so
// what has to hold at every height is that the reader can always reach past it:
// the reserved foot lane is what makes that true, and this is its rendered
// proof rather than a reading of the padding it comes from.
const PHONE_HEIGHTS = [568, 640, 844, 932] as const;

for (const height of PHONE_HEIGHTS) {
  test(`the consent card leaves the landing's foot reachable @390x${height}`, async ({ page }) => {
    test.setTimeout(60_000);
    await prepareUndecidedConsent(page, { width: 390, height });
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const prompt = page.getByLabel("Anonymous analytics choice");
    await expect(prompt).toBeVisible({ timeout: 30_000 });
    // The ceiling is a height contract, so it is re-asked at every height: a
    // card that wrapped to a fifth line on a short phone would take the lane
    // the foot reserve was sized against.
    const fit = await consentFit(prompt);
    expect(fit.boxHeight).toBeLessThanOrEqual(CONSENT_ROW_CEILING);
    expect(fit.scrollHeight).toBeLessThanOrEqual(CONSENT_ROW_CEILING);
    // The rail is the row the report found under the card, so it has to exist
    // before the sweep below can mean anything.
    await expect(page.locator(".lpRailLink").last()).toBeVisible({ timeout: 30_000 });

    // WHAT THE RESERVE PROMISES. The card is fixed and a short phone's first
    // screen is short, so it will always sit over something at rest; what has
    // to hold is that a reader can reach PAST it. At the bottom of the scroll
    // nothing tappable may be left under it. `scrollIntoViewIfNeeded` is not
    // the way to ask: it does not move an element that is inside the viewport
    // and under an overlay, which is the exact case this owns.
    const covered = await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight);
      const controls = Array.from(
        document.querySelectorAll<HTMLElement>("main a, main button, footer a, footer button"),
      );
      return controls
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          if (rect.height <= 0) return false;
          const x = rect.x + rect.width / 2;
          const y = rect.y + rect.height / 2;
          if (y < 0 || y > window.innerHeight) return false;
          const hit = document.elementFromPoint(x, y);
          return Boolean(hit?.closest(".analyticsConsentPrompt"));
        })
        .map((element) => (element.textContent ?? "").trim().slice(0, 40));
    });
    expect(covered).toEqual([]);

    // The probe can still answer "prompt", so the sweep above is one the card
    // can lose.
    const promptBox = await prompt.boundingBox();
    expect(promptBox).not.toBeNull();
    expect(await pointOwner(page, promptBox!, ".lpRailLink")).toBe("prompt");
  });

  test(`the consent card leaves the tab bar tappable @390x${height}`, async ({ page }) => {
    test.setTimeout(60_000);
    await prepareUndecidedConsent(page, { width: 390, height });
    await page.goto("/tonight", { waitUntil: "domcontentloaded" });

    const prompt = page.getByLabel("Anonymous analytics choice");
    await expect(prompt).toBeVisible({ timeout: 30_000 });

    const mapTab = page.getByRole("navigation", { name: "Primary" }).getByRole("link", {
      name: "Map",
      exact: true,
    });
    await expect(mapTab).toBeVisible();
    const tabBox = await mapTab.boundingBox();
    expect(tabBox).not.toBeNull();
    expect(await pointOwner(page, tabBox!, ".mobileTabBar")).toBe("control");
  });
}

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
      "PUBMAXX analytics show us what people use. Never sold, no ads.",
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
    expect(fit.boxHeight).toBeLessThanOrEqual(CONSENT_ROW_CEILING);
    expect(fit.scrollHeight).toBeLessThanOrEqual(CONSENT_ROW_CEILING);
  });
}

// Every phone width the first-run surface is reviewed at. 430x932 is the
// iPhone 17 Pro the simulator proof was shot on, which is where the card was
// found lying across the reviewed-area rows and the "Use London" button.
// 320x568 is the first-generation SE, and 360x640 the entry Android tier:
// verify-preview-4 (5 Sep 2026) found the card over "Use London" at both,
// because the lane-reduced surface was 428 and 500px tall against a panel laid
// out at 553px and this sweep ran one height only.
const ONBOARDING_VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 320, height: 844 },
  { width: 360, height: 640 },
  { width: 360, height: 844 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
] as const;

for (const viewport of ONBOARDING_VIEWPORTS) {
  test(`consent never covers first-run onboarding @${viewport.width}x${viewport.height}`, async ({ page }) => {
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
    // On a short phone the action row is sticky to the surface's foot and the
    // rows scroll up behind it (app/onboarding/onboarding.css, the short
    // phone), so a row is owed reachability by scroll and a box clear of the
    // card, never a place under the action at rest.
    for (const row of await rows.all()) {
      await row.scrollIntoViewIfNeeded();
      await expect(row).toBeInViewport({ ratio: 1 });
      const rowBox = await row.boundingBox();
      expect(rowBox).not.toBeNull();
      expect(boxesOverlap(promptBox!, rowBox!)).toBe(false);
      expect(boxesOverlap(primaryBox!, rowBox!)).toBe(false);
    }
    await expect(primary).toBeInViewport({ ratio: 1 });

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
    // The SCROLL is retried beside the assertion, not taken once in front of
    // it. Answering the card releases the reserved lane and brings the
    // photograph band back, and that reflow can land AFTER a one-shot
    // scrollIntoViewIfNeeded has already settled: the button then drifts back
    // under the fold and toBeInViewport, which re-reads but never re-scrolls,
    // waits out its whole budget against a stale offset. That is what made
    // this case fail at 360 about one run in three.
    // scrollIntoViewIfNeeded settles on a fractional offset, so the last half
    // pixel is the scroller's rounding rather than a covered control.
    await expect(async () => {
      await primary.scrollIntoViewIfNeeded();
      await expect(primary).toBeInViewport({ ratio: 0.99, timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
  });
}

// THE QUESTIONS AFTER THE LONDON CONFIRM LIVE UNDER THE SAME CARD. The budget,
// the location ask, the patch picker and the result each paint one primary, and
// the card outranks every other prompt on a first launch, so every one of those
// screens owes what the London screen owes above: the primary is on screen at
// rest, clear of the card, and a tap at its centre reaches it. The patch picker
// is the tall one, which is why it is walked at the short phones too.
for (const viewport of ONBOARDING_VIEWPORTS) {
  test(`consent never covers the first-run questions @${viewport.width}x${viewport.height}`, async ({ page }) => {
    test.setTimeout(90_000);
    await prepareFirstRunOnboarding(page, viewport);
    await page.goto("/onboarding", { waitUntil: "domcontentloaded" });

    const prompt = page.getByLabel("Anonymous analytics choice");
    await expect(prompt).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Use London" }).click();

    async function expectPrimaryClearOfCard(name: string) {
      const primary = page.getByRole("button", { name });
      await expect(primary).toBeVisible();
      await expect(primary).toBeInViewport({ ratio: 1 });
      const promptBox = await prompt.boundingBox();
      const primaryBox = await primary.boundingBox();
      expect(promptBox).not.toBeNull();
      expect(primaryBox).not.toBeNull();
      expect(boxesOverlap(promptBox!, primaryBox!)).toBe(false);
      expect(await pointOwner(page, primaryBox!, ".firstRunPrimary")).toBe("control");
    }

    // Budget.
    await expect(page.getByRole("heading", { name: "What's a fair pint to you?" })).toBeVisible();
    await expectPrimaryClearOfCard("Continue");
    await page.getByRole("button", { name: "£6 or less" }).click();
    await page.getByRole("button", { name: "Continue" }).click();

    // Location ask, then the picker it opens.
    await expect(page.getByRole("heading", { name: "Find the cheapest pint near you." })).toBeVisible();
    await expectPrimaryClearOfCard("Use my location");
    await page.getByRole("button", { name: "Pick a London patch instead" }).click();
    await expectPrimaryClearOfCard("Use my location");
    await page.getByRole("button", { name: "Soho" }).click();

    // Result.
    await expect(page.getByRole("button", { name: "That looks right" })).toBeVisible({ timeout: 45_000 });
    await expectPrimaryClearOfCard("That looks right");
  });
}

// ONE CONSENT CONTROL ON ANY SCREEN, and on the signed-out profile that count
// is ZERO. `/u/you` used to print a second Allow / No thanks pair inside its
// own "On this device" panel while the route rule already withheld the docked
// card, so a stranger met the analytics question twice in one column of copy.
// The pair is gone (components/profile/PubmaxxAccountHub.tsx); the settings
// block is the SIGNED-IN control, where a decision can be reversed, and a
// signed-out reader is caught by the docked card on the next route instead
// (lib/consentSurfaceRoutes.ts, lib/consentAnswerMoment.ts).
const CONSENT_ONCE_VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
] as const;

for (const viewport of CONSENT_ONCE_VIEWPORTS) {
  test(`/u/you asks for the analytics decision no more than once @${viewport.width}`, async ({ page }) => {
    test.setTimeout(60_000);
    await prepareUndecidedConsent(page, viewport);
    await page.goto("/u/you", { waitUntil: "domcontentloaded" });

    // The account hub is a dynamic import, so its own copy is awaited before
    // anything is called absent: a page checked before the chunk landed would
    // pass this test for the wrong reason.
    await expect(
      page.getByRole("heading", { name: "On this device" }),
    ).toBeVisible({ timeout: 30_000 });

    // Neither control is on this screen: the panel's pair is gone and the
    // route rule withholds the docked card.
    await expect(page.locator("#analytics-settings")).toHaveCount(0);
    await expect(page.getByLabel("Anonymous analytics choice")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Allow", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "No thanks", exact: true })).toHaveCount(0);

    // The ask is DEFERRED rather than lost: nothing is stored here, so the
    // next route still meets an undecided reader.
    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key), CONSENT_KEY))
      .toBe(null);
  });

  test(`the docked card still answers on the next route @${viewport.width}`, async ({ page }) => {
    test.setTimeout(60_000);
    await prepareUndecidedConsent(page, viewport);
    await page.goto("/u/you", { waitUntil: "domcontentloaded" });
    await page.goto("/tonight", { waitUntil: "domcontentloaded" });

    const prompt = page.getByLabel("Anonymous analytics choice");
    await expect(prompt).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Allow", exact: true })).toHaveCount(1);
    await prompt.getByRole("button", { name: "No thanks" }).click();
    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key), CONSENT_KEY))
      .toBe("denied");
  });
}
