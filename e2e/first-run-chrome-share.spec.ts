import { expect, test, type Page } from "@playwright/test";

import { LANDING_PRIMARY_NAME } from "./helpers/landingHero";
import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";

// THE FIRST SCREEN IS THE PRODUCT, NOT ITS CHROME.
//
// Site audit 13 Sep 2026, D3 and D19. At 390x844 the consent card (115px, two
// stacked buttons) and the dock took a fifth of the phone before the reader
// had done anything, and on the map the outing pill, the top chrome and the
// card lifted above the pill took 38 percent. In the iOS shell the dock
// floated 34px up and page content showed in the home-indicator strip under
// it. The release metric is the share of visitors who take a first action in
// 60 seconds, so chrome is measured here as a share of the viewport and held
// under a ceiling that can only come down.
//
// WHAT COUNTS AS CHROME. Every element that paints (a background, a border, an
// image, an icon or its own text) inside a fixed or sticky element, unioned on
// a 2px grid, so an empty transparent container counts for nothing and two
// overlapping controls count once. A painted box as large as the screen is the
// page itself (the map canvas), never chrome.

const PHONE = { width: 390, height: 844 } as const;
const HOME_CHROME_CEILING = 0.2;
const MAP_CHROME_CEILING = 0.3;
const CONSENT_ROW_HEIGHT = 56;
const HOME_INDICATOR_INSET = 34;
/** The dock's own base clearance under the pill (components/nav/mobileNav.css). */
const DOCK_BASE_CLEARANCE = 6;
/** A seed pub, opened by id so the first action needs no canvas pin tap. */
const ARNOS_ARMS_ID = "venue-xjf3n0";

test.use({ storageState: { cookies: [], origins: [] } });

/**
 * A stranger: no analytics decision, no spent prompt, no answer yet. The tour,
 * onboarding and map-arrival markers are answered for the same reason every
 * consent and map spec answers them, so the surface measured is the route's
 * default berth. The session keys are cleared once per tab, because the
 * second-route answer is carried across a navigation in sessionStorage.
 */
async function prepareStranger(
  page: Page,
  viewport: { width: number; height: number } = PHONE,
) {
  await page.setViewportSize(viewport);
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
    window.localStorage.removeItem("pubmaxx:analytics-consent:v1");
    const PREPARED = "pw:first-run-chrome-prepared";
    if (window.sessionStorage.getItem(PREPARED) !== null) return;
    window.sessionStorage.setItem(PREPARED, "1");
    window.sessionStorage.removeItem("pubmax:prompt-budget:v1");
    window.sessionStorage.removeItem("pubmax:consent-answer-moment:v1");
    window.sessionStorage.removeItem("pubmax:consent-first-route:v1");
  });
}

/** The first route is recorded once the card's effect has run, which is hydration. */
async function firstRouteRecorded(page: Page) {
  await expect
    .poll(
      () => page.evaluate(() => window.sessionStorage.getItem("pubmax:consent-first-route:v1")),
      { timeout: 30_000 },
    )
    .not.toBeNull();
}

async function openedPhoneMap(page: Page) {
  await expect(page.locator(".mobileMapTopbar")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole("button", { name: "Describe the outing" })).toBeVisible({
    timeout: 45_000,
  });
  await expect(page.locator(".mapLoading")).toBeHidden({ timeout: 45_000 });
}

type ChromeReading = { share: number; members: string[] };

async function chromeShare(page: Page): Promise<ChromeReading> {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const CELL = 2;
    const cols = Math.ceil(vw / CELL);
    const rows = Math.ceil(vh / CELL);
    const covered = new Uint8Array(cols * rows);
    const members = new Set<string>();

    const clear = (color: string) =>
      color === "transparent"
      || /rgba\([^)]*,\s*0\)$/.test(color)
      || /\/\s*0\)$/.test(color);
    const paints = (el: Element, style: CSSStyleDeclaration) => {
      if (el instanceof SVGSVGElement || el instanceof HTMLImageElement) return true;
      if (!clear(style.backgroundColor) || style.backgroundImage !== "none") return true;
      if (Number.parseFloat(style.borderTopWidth) > 0 && !clear(style.borderTopColor)) return true;
      return Array.from(el.childNodes).some(
        (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() !== "",
      );
    };

    for (const root of Array.from(document.body.querySelectorAll("*"))) {
      const position = getComputedStyle(root).position;
      if (position !== "fixed" && position !== "sticky") continue;
      for (const el of [root, ...Array.from(root.querySelectorAll("*"))]) {
        if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
        const style = getComputedStyle(el);
        if (!paints(el, style)) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width * rect.height >= vw * vh * 0.9) continue;
        const left = Math.max(0, rect.left);
        const right = Math.min(vw, rect.right);
        const top = Math.max(0, rect.top);
        const bottom = Math.min(vh, rect.bottom);
        if (right <= left || bottom <= top) continue;
        members.add(root.classList[0] ?? root.tagName.toLowerCase());
        for (let y = Math.floor(top / CELL); y < Math.ceil(bottom / CELL); y += 1) {
          for (let x = Math.floor(left / CELL); x < Math.ceil(right / CELL); x += 1) {
            covered[y * cols + x] = 1;
          }
        }
      }
    }

    let count = 0;
    for (const cell of covered) count += cell;
    return { share: count / covered.length, members: [...members].sort() };
  });
}

/** Fixed bars that run across the foot of the screen, by their first class. */
async function footBars(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    return Array.from(document.body.querySelectorAll("*"))
      .filter((el) => {
        if (getComputedStyle(el).position !== "fixed") return false;
        if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
        const rect = el.getBoundingClientRect();
        return rect.width >= vw * 0.8 && rect.height < vh * 0.5 && rect.top >= vh / 2 && rect.top < vh;
      })
      .map((el) => el.classList[0] ?? el.tagName.toLowerCase());
  });
}

/** The visible controls that share the foot of the phone map with the card. */
async function footControlBoxes(page: Page) {
  return page.evaluate(() =>
    Array.from(
      document.querySelectorAll(
        ".mobileTabList, .mobilePlanActivation, .palSummon, .mobileMapLocateFab, .maplibregl-ctrl-bottom-right",
      ),
    )
      .filter((el) => el.checkVisibility({ opacityProperty: true, visibilityProperty: true }))
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          name: el.classList[0] ?? el.tagName.toLowerCase(),
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          left: rect.left,
        };
      })
      .filter((box) => box.bottom > box.top && box.right > box.left));
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

test("the landing's first paint spends under a fifth of the phone on chrome @390x844", async ({ page }) => {
  test.setTimeout(90_000);
  await prepareStranger(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(
    page.locator(".lpHero .screenActions").getByRole("link", { name: LANDING_PRIMARY_NAME }),
  ).toBeVisible({ timeout: 30_000 });
  await firstRouteRecorded(page);
  await page.waitForTimeout(1_500);

  await expect(page.getByLabel("Anonymous analytics choice")).toHaveCount(0);
  const reading = await chromeShare(page);
  expect(
    reading.share,
    `landing chrome ${percent(reading.share)} from ${reading.members.join(", ")}`,
  ).toBeLessThan(HOME_CHROME_CEILING);
  // The dock is the one fixed bar across the foot on first paint.
  expect(await footBars(page)).toEqual(["mobileTabBar"]);
});

test("the phone map with its sheet closed spends under 30 percent on chrome @390x844", async ({ page }) => {
  test.setTimeout(180_000);
  await prepareStranger(page);
  await installDeterministicMapBasemap(page);
  await page.goto("/map", { waitUntil: "domcontentloaded" });
  await openedPhoneMap(page);
  await page.waitForTimeout(1_500);

  const reading = await chromeShare(page);
  expect(
    reading.share,
    `map chrome ${percent(reading.share)} from ${reading.members.join(", ")}`,
  ).toBeLessThan(MAP_CHROME_CEILING);
});

// On the phone map the card never greets a stranger, and once the reader has
// taken a first action it takes the outing pill's slot on the dock rather than
// stacking above it (components/mobile/mobileMapShell.css).
test("on the phone map the consent card waits for a first action, then takes the outing pill's slot @390x844", async ({ page }) => {
  test.setTimeout(180_000);
  await prepareStranger(page);
  await installDeterministicMapBasemap(page);

  await page.goto("/map", { waitUntil: "domcontentloaded" });
  await openedPhoneMap(page);
  await firstRouteRecorded(page);
  await page.waitForTimeout(1_500);

  const prompt = page.getByLabel("Anonymous analytics choice");
  const pill = page.locator(".mobilePlanActivation");
  await expect(prompt).toHaveCount(0);
  await expect(pill).toBeVisible();
  // The wait costs the session nothing: the slot is unspent until the card paints.
  expect(
    await page.evaluate(() => window.sessionStorage.getItem("pubmax:prompt-budget:v1")),
  ).toBeNull();

  // The first action: the reader opens a pub, which is the product answering.
  await page.goto(`/map?sel=${ARNOS_ARMS_ID}`, { waitUntil: "domcontentloaded" });
  const venueSheet = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
  await expect(venueSheet).toBeVisible({ timeout: 45_000 });
  await expect
    .poll(() => page.evaluate(() => window.sessionStorage.getItem("pubmax:consent-answer-moment:v1")))
    .toBe("venue-sheet");
  await expect(async () => {
    await venueSheet.getByRole("button", { name: "Close pub detail" }).click();
    await expect(venueSheet).toHaveCount(0, { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });

  // One element at the foot: the pill has stepped down and the card overlaps nothing.
  await expect(prompt).toBeVisible({ timeout: 30_000 });
  await expect(pill).toHaveCount(1);
  await expect(pill).toBeHidden();
  const card = await prompt.boundingBox();
  expect(card).not.toBeNull();
  for (const control of await footControlBoxes(page)) {
    const rows = Math.min(card!.y + card!.height, control.bottom) - Math.max(card!.y, control.top);
    const columns = Math.min(card!.x + card!.width, control.right) - Math.max(card!.x, control.left);
    expect(rows > 0.5 && columns > 0.5, `the card overlaps ${control.name}`).toBe(false);
  }
  const reading = await chromeShare(page);
  expect(
    reading.share,
    `map chrome with the card up ${percent(reading.share)} from ${reading.members.join(", ")}`,
  ).toBeLessThan(MAP_CHROME_CEILING);

  // The choice gives the pill back.
  await prompt.getByRole("button", { name: "No thanks", exact: true }).click();
  await expect(prompt).toHaveCount(0);
  await expect(pill).toBeVisible();
});

for (const width of [320, 360, 390] as const) {
  test(`the consent card is one 56px row with both choices beside the sentence @${width}x844`, async ({ page }) => {
    test.setTimeout(90_000);
    await prepareStranger(page, { width, height: 844 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await firstRouteRecorded(page);
    await page.goto("/tonight", { waitUntil: "domcontentloaded" });

    const prompt = page.getByLabel("Anonymous analytics choice");
    await expect(prompt).toBeVisible({ timeout: 30_000 });

    const card = await prompt.boundingBox();
    expect(card).not.toBeNull();
    expect(card!.height).toBeLessThanOrEqual(CONSENT_ROW_HEIGHT + 0.5);
    expect(await prompt.evaluate((el) => el.scrollHeight)).toBeLessThanOrEqual(CONSENT_ROW_HEIGHT);

    const sentence = await prompt.locator("p").boundingBox();
    const allow = await prompt.getByRole("button", { name: "Allow" }).boundingBox();
    const decline = await prompt.getByRole("button", { name: "No thanks" }).boundingBox();
    expect(sentence && allow && decline).toBeTruthy();
    // One row: both choices share a top edge and sit beside the sentence.
    expect(Math.abs(allow!.y - decline!.y)).toBeLessThanOrEqual(1);
    expect(Math.min(allow!.x, decline!.x)).toBeGreaterThanOrEqual(sentence!.x + sentence!.width - 1);
    for (const control of [allow!, decline!]) {
      expect(control.height).toBeGreaterThanOrEqual(44);
      expect(control.y).toBeGreaterThanOrEqual(card!.y - 0.5);
      expect(control.y + control.height).toBeLessThanOrEqual(card!.y + card!.height + 0.5);
    }

    // The route to the privacy notice keeps a full tap target and owns its own centre.
    const privacy = prompt.getByRole("link", { name: "Privacy" });
    await expect(privacy).toBeVisible();
    const privacyBox = await privacy.boundingBox();
    expect(privacyBox!.height).toBeGreaterThanOrEqual(44);
    const ownsCentre = await page.evaluate(
      ({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('a[href="/privacy"]')),
      { x: privacyBox!.x + privacyBox!.width / 2, y: privacyBox!.y + privacyBox!.height / 2 },
    );
    expect(ownsCentre).toBe(true);

    // With the card up the phone is still mostly page.
    const reading = await chromeShare(page);
    expect(
      reading.share,
      `chrome with the card up ${percent(reading.share)} from ${reading.members.join(", ")}`,
    ).toBeLessThan(HOME_CHROME_CEILING);
  });
}

test("the dock paints the home-indicator strip under it and keeps its tap row @390x844", async ({ page }) => {
  test.setTimeout(90_000);
  await prepareStranger(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setSafeAreaInsetsOverride", {
    insets: { top: 47, bottom: HOME_INDICATOR_INSET },
  });
  await page.goto("/tonight", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".mobileTabList")).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => window.scrollTo(0, 400));
  await page.waitForTimeout(300);

  const geometry = await page.evaluate(() => {
    const bar = document.querySelector(".mobileTabBar")!;
    const list = document.querySelector(".mobileTabList")!;
    const main = document.querySelector("main");
    return {
      vh: window.innerHeight,
      barBottom: bar.getBoundingClientRect().bottom,
      listBottom: list.getBoundingClientRect().bottom,
      paddingBottom: getComputedStyle(bar).paddingBottom,
      mainBottom: main?.getBoundingClientRect().bottom ?? 0,
    };
  });
  // Preconditions: the emulated inset reached the stylesheet, and the page
  // really runs on under the dock, so an empty strip proves the paint.
  expect(geometry.paddingBottom).toBe(`${DOCK_BASE_CLEARANCE + HOME_INDICATOR_INSET}px`);
  expect(geometry.mainBottom).toBeGreaterThan(geometry.vh);

  // The tap row stays where it was, and the bar reaches the bottom edge.
  expect(
    Math.abs(geometry.listBottom - (geometry.vh - DOCK_BASE_CLEARANCE - HOME_INDICATOR_INSET)),
  ).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.barBottom - geometry.vh)).toBeLessThanOrEqual(1);

  // Nothing of the page shows in the strip: the strip reads the same with the
  // page hidden as with it painted behind.
  const top = Math.ceil(geometry.listBottom) + 1;
  const strip = { x: 0, y: top, width: PHONE.width, height: geometry.vh - top };
  const withPage = await page.screenshot({ clip: strip, animations: "disabled" });
  await page.addStyleTag({ content: "main, main * { visibility: hidden !important; }" });
  await page.waitForTimeout(100);
  const withoutPage = await page.screenshot({ clip: strip, animations: "disabled" });
  expect(withPage.equals(withoutPage), "page content shows through the home-indicator strip").toBe(true);
});
