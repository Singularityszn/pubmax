import { expect, test, type CDPSession, type Page } from "@playwright/test";

// The phone map's bottom card: "Cheapest in this view", the plan door inside it,
// a pull up that opens List view. Rules: docs/rules/components-sheets-chrome-and-navigation.md,
// "THE PHONE MAP RESTS ON THREE LAYERS".

const PHONE = { width: 390, height: 844 };

test.use({
  viewport: PHONE,
  hasTouch: true,
  isMobile: true,
  launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
});
test.setTimeout(120_000);

async function openMap(
  page: Page,
  options: { reducedMotion?: "reduce" | "no-preference"; arrival?: string | null } = {},
): Promise<void> {
  await page.emulateMedia({ reducedMotion: options.reducedMotion ?? "reduce" });
  const arrival = options.arrival === undefined ? "dismissed" : options.arrival;
  await page.addInitScript((arrivalValue) => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    if (arrivalValue === null) {
      window.localStorage.removeItem("pubmax:map-first-visit-arrival:v1");
    } else {
      window.localStorage.setItem("pubmax:map-first-visit-arrival:v1", arrivalValue);
    }
  }, arrival);
  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);
  await expect(page.locator(".mobileMapTopbar")).toBeVisible({ timeout: 45_000 });
  await expect(page.locator(".mapLoading")).toBeHidden({ timeout: 45_000 });
}

/** A real touch drag through CDP, so the card sees pointer events with `pointerType: touch`. */
async function touchDrag(
  cdp: CDPSession,
  from: { x: number; y: number },
  to: { x: number; y: number },
  { steps = 12, stepMs = 16, hold = false }: { steps?: number; stepMs?: number; hold?: boolean } = {},
): Promise<void> {
  const send = (type: "touchStart" | "touchMove" | "touchEnd", point?: { x: number; y: number }) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: point ? [{ x: point.x, y: point.y }] : [],
    });
  await send("touchStart", from);
  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    await send("touchMove", { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
  if (hold) await new Promise((resolve) => setTimeout(resolve, 200));
  await send("touchEnd");
}

async function cardBox(page: Page) {
  const box = await page.locator(".mapPeek").boundingBox();
  expect(box, "the bottom card has a box").not.toBeNull();
  return box!;
}

async function answeredCard(page: Page) {
  const card = page.locator(".mapPeek");
  await expect(card).toBeVisible({ timeout: 45_000 });
  await expect(card).toHaveAttribute("data-state", "answer", { timeout: 45_000 });
  // The arrival turn and the first settled view can change which pub is
  // cheapest in view once. Wait for two identical reads a beat apart.
  let last = "";
  await expect(async () => {
    const now = (await card.locator(".mapPeekAnswer").innerText()).trim();
    const stable = now === last;
    last = now;
    expect(stable, "the answer has stopped changing").toBe(true);
  }).toPass({ timeout: 30_000, intervals: [1_500] });
  return card;
}

test("the card names the cheapest listed pub in view, and the door rides inside it", async ({ page }) => {
  await openMap(page);
  const card = await answeredCard(page);
  await expect(card.getByText("Cheapest in this view", { exact: true })).toBeVisible();
  await expect(card.locator(".mapPeekPrice")).toHaveText(/£\d+\.\d{2}/);
  await expect(card.locator(".mapPeekName")).not.toBeEmpty();
  // One surface: the plan door is a child and keeps its own label and 48px.
  const door = card.getByRole("button", { name: "Describe the outing" });
  await expect(door).toBeVisible();
  const doorBox = await door.boundingBox();
  expect(doorBox!.height).toBeGreaterThanOrEqual(48);
  const box = await cardBox(page);
  expect(box.height).toBeCloseTo(112, 0);
  expect(doorBox!.y).toBeGreaterThan(box.y);
  expect(doorBox!.y + doorBox!.height).toBeLessThan(box.y + box.height);
});

for (const width of [320, 390]) {
  test(`${width}px a long anchor answer keeps the figure whole and the name readable inside the card`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: PHONE.height });
    await openMap(page);
    const card = await answeredCard(page);
    // The card's own markup for the longest anchors in the data, laid out in
    // the same synchronous step that measures it, so a re-render cannot race it.
    const layout = await card.evaluate((element) => {
      const line = element.querySelector<HTMLElement>(".mapPeekLine")!;
      line.innerHTML =
        '<span class="mapPeekPrice"><span><span class="compactVenuePriceAnchor">Three Sheets seasonal cocktail · </span>£12.00</span>' +
        '<small class="mapPeekProvenance">Sep · threesheets-bar.com</small></span>' +
        '<span class="mapPeekName">The Marquis of Granby and Coach House</span>' +
        '<span class="mapPeekWalk">12 min walk</span>';
      const box = (selector: string) => element.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
      const answer = box(".mapPeekAnswer");
      const figure = document.createRange();
      const priceInner = element.querySelector(".mapPeekPrice > span")!;
      figure.selectNodeContents(priceInner.lastChild!);
      const figureRect = figure.getBoundingClientRect();
      return {
        card: element.getBoundingClientRect().height,
        answer: { left: answer.left, right: answer.right, top: answer.top, bottom: answer.bottom },
        figure: { left: figureRect.left, right: figureRect.right, width: figureRect.width },
        name: box(".mapPeekName"),
        walk: box(".mapPeekWalk"),
        lineScroll: line.scrollWidth - line.clientWidth,
      };
    });
    expect(layout.card).toBeCloseTo(112, 0);
    expect(layout.figure.width, "the figure is drawn").toBeGreaterThan(30);
    expect(layout.figure.left).toBeGreaterThanOrEqual(layout.answer.left);
    expect(layout.figure.right, "the figure stays inside the answer").toBeLessThanOrEqual(layout.answer.right);
    expect(layout.name.width, "the name keeps room to be read").toBeGreaterThanOrEqual(30);
    expect(layout.walk.right, "nothing spills past the answer").toBeLessThanOrEqual(layout.answer.right + 0.5);
    expect(layout.name.bottom).toBeLessThanOrEqual(layout.answer.bottom);
    expect(layout.lineScroll, "the line never overflows").toBeLessThanOrEqual(1);
  });
}

test("tapping the answer opens that pub, and the card stands down behind its sheet", async ({ page }) => {
  await openMap(page);
  const card = await answeredCard(page);
  // Read the name and tap in ONE synchronous step: the answer can move with
  // the view, and the pub it opens must be the one it said at the tap.
  const name = await card.locator(".mapPeekAnswer").evaluate((button) => {
    const said = button.querySelector(".mapPeekName")?.textContent?.trim() ?? "";
    (button as HTMLButtonElement).click();
    return said;
  });
  expect(name.length).toBeGreaterThan(0);
  await expect(page.locator(".mobileSharedSheet").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".mobileSharedSheet").first()).toContainText(name);
  // Hidden, not unmounted: the map-edge column must not jump behind the sheet.
  await expect(card).toBeHidden();
  await expect(card).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Describe the outing" })).toHaveCount(0);
});

test("List opens List view sorted cheapest, and its first row is the card's own answer", async ({ page }) => {
  await openMap(page);
  const card = await answeredCard(page);
  const price = (await card.locator(".mapPeekPrice").innerText()).match(/£\d+\.\d{2}/)?.[0] ?? "";
  expect(price).not.toBe("");
  const name = (await card.locator(".mapPeekName").innerText()).trim();
  await card.getByRole("button", { name: "Show the pubs in this view as a list" }).click();
  const list = page.locator(".mapVenueList--open");
  await expect(list).toBeVisible();
  await expect(list.getByRole("button", { name: "Cheapest" })).toHaveAttribute("aria-pressed", "true");
  const first = list.locator(".mapVenueListItem").first();
  await expect(first).toContainText(name);
  await expect(first).toContainText(price);
  // Nothing floats over the list: the card is covered, not painted or hit.
  await expect(card).toBeHidden();
  await expect(page.getByRole("button", { name: "Describe the outing" })).toHaveCount(0);
});

for (const reducedMotion of ["reduce", "no-preference"] as const) {
  test(`a pull up past the commit distance opens the list (${reducedMotion})`, async ({ page }) => {
    await openMap(page, { reducedMotion });
    await answeredCard(page);
    const cdp = await page.context().newCDPSession(page);
    const box = await cardBox(page);
    const from = { x: box.x + box.width / 2, y: box.y + 22 };
    await touchDrag(cdp, from, { x: from.x, y: from.y - 120 });
    await expect(page.locator(".mapVenueList--open")).toBeVisible({ timeout: 10_000 });
    // Closing the list finds the card home, not parked where the finger left
    // it, and the Create action back and tappable.
    await page.keyboard.press("Escape");
    await expect(page.locator(".mapVenueList--open")).toHaveCount(0);
    const card = page.locator(".mapPeek");
    await expect(card).toBeVisible();
    await expect(card).not.toHaveAttribute("data-dragging", "true");
    expect(Math.abs((await cardBox(page)).y - box.y)).toBeLessThan(1);
    const fab = page.locator(".createFabRoot");
    await expect(fab).toHaveCSS("opacity", "1", { timeout: 5_000 });
    await expect(fab).not.toHaveCSS("pointer-events", "none");
  });

  test(`a short pull follows the finger and springs back without opening anything (${reducedMotion})`, async ({
    page,
  }) => {
    await openMap(page, { reducedMotion });
    const card = await answeredCard(page);
    const rest = await cardBox(page);
    const cdp = await page.context().newCDPSession(page);
    const from = { x: rest.x + rest.width / 2, y: rest.y + 22 };
    const send = (type: "touchStart" | "touchMove" | "touchEnd", y?: number) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: y === undefined ? [] : [{ x: from.x, y }],
      });
    await send("touchStart", from.y);
    for (let step = 1; step <= 6; step += 1) {
      await send("touchMove", from.y - step * 5);
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
    // The Create action steps out of the card's way while it travels (it lives
    // in another stacking context, so the card cannot pass over it).
    const fab = page.locator(".createFabRoot");
    await expect(fab).toHaveCSS("opacity", "0", { timeout: 5_000 });
    // 1:1 with the finger while it is held (30px up), within a frame of slack.
    const held = await cardBox(page);
    expect(rest.y - held.y).toBeGreaterThan(24);
    expect(rest.y - held.y).toBeLessThanOrEqual(31);
    await new Promise((resolve) => setTimeout(resolve, 200));
    await send("touchEnd");
    await expect
      .poll(async () => Math.abs((await cardBox(page)).y - rest.y), { timeout: 5_000 })
      .toBeLessThan(1);
    await expect(page.locator(".mapVenueList--open")).toHaveCount(0);
    await expect(card).toBeVisible();
    await expect(fab).toHaveCSS("opacity", "1", { timeout: 5_000 });
  });
}

test("a flick opens the list even when the distance is short", async ({ page }) => {
  await openMap(page);
  await answeredCard(page);
  // Pointer events dispatched back to back in the page: 44px (under the 56px
  // commit distance) in about a frame is a flick however slow the runner's
  // compositor is. A CDP touch drag cannot promise that, because the browser
  // aligns touch moves to frames, and SwiftShader frames are slow.
  await page.locator(".mapPeek").evaluate((card) => {
    const rect = card.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + 22;
    const fire = (type: string, dy: number) =>
      card.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: 7,
          pointerType: "touch",
          isPrimary: true,
          clientX: x,
          clientY: y - dy,
        }),
      );
    fire("pointerdown", 0);
    for (const dy of [12, 24, 36, 44]) fire("pointermove", dy);
    fire("pointerup", 44);
  });
  await expect(page.locator(".mapVenueList--open")).toBeVisible({ timeout: 10_000 });
});

test("a tap on the door still plans, and a drag that starts on it does not", async ({ page }) => {
  await openMap(page);
  const card = await answeredCard(page);
  const door = card.getByRole("button", { name: "Describe the outing" });
  const doorBox = (await door.boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  await touchDrag(
    cdp,
    { x: doorBox.x + doorBox.width / 2, y: doorBox.y + 24 },
    { x: doorBox.x + doorBox.width / 2, y: doorBox.y - 100 },
  );
  await expect(page.locator(".mapVenueList--open")).toBeVisible({ timeout: 10_000 });
  // The drag opened the list; it did not also open the planner.
  await expect(page.locator(".mobilePlannerSheet, .planComposer")).toHaveCount(0);
});

test("the credit is a control on the map and copy under the Key", async ({ page }) => {
  await openMap(page);
  await expect(page.locator(".maplibregl-ctrl-attrib-button")).toBeVisible();
  await page.locator(".mobileMapTopbar").getByRole("button", { name: "More map controls" }).click();
  const credits = page.locator(".mobileMapCredits");
  await expect(credits).toBeVisible({ timeout: 20_000 });
  await expect(credits).toContainText("OpenStreetMap contributors (ODbL)");
  await expect(credits.getByRole("link", { name: "OpenStreetMap" })).toHaveAttribute(
    "href",
    "https://www.openstreetmap.org/copyright",
  );
});

test("the first-visit ask offers both answers side by side, and an answer holds for 30 days", async ({ page }) => {
  await openMap(page, { arrival: null });
  const ask = page.locator(".mapArrivalCard");
  await expect(ask).toBeVisible({ timeout: 45_000 });
  const primary = ask.getByRole("button", { name: "Use my location" });
  const secondary = ask.getByRole("button", { name: "Choose an area" });
  await expect(primary).toBeVisible();
  await expect(secondary).toBeVisible();
  const [a, b] = [(await primary.boundingBox())!, (await secondary.boundingBox())!];
  expect(Math.abs(a.y - b.y), "side by side on one row").toBeLessThan(2);
  expect(a.height).toBeGreaterThanOrEqual(44);
  expect(b.height).toBeGreaterThanOrEqual(44);
  await expect(ask.getByText("Location is used only while the map is open.")).toBeVisible();
  // The card and the bottom card never share the foot of the map.
  await expect(page.locator(".mapPeek")).toHaveCount(0);
  await ask.getByRole("button", { name: "Close" }).click();
  await expect(ask).toHaveCount(0);
  const stored = await page.evaluate(() => window.localStorage.getItem("pubmax:map-first-visit-arrival:v1"));
  expect(stored).toMatch(/^dismissed:\d+$/);
  await expect(page.locator(".mapPeek")).toBeVisible({ timeout: 20_000 });

  // 31 days on, the ask may be made once more.
  await page.evaluate(() =>
    window.localStorage.setItem(
      "pubmax:map-first-visit-arrival:v1",
      `dismissed:${Date.now() - 31 * 24 * 60 * 60 * 1000}`,
    ),
  );
  await page.reload();
  await expect(page.locator(".mapArrivalCard")).toBeVisible({ timeout: 45_000 });
});

test("safe-area insets keep the card above the tab bar and under no notch", async ({ page }) => {
  await openMap(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setSafeAreaInsetsOverride", {
    insets: { top: 47, bottom: 34, left: 0, right: 0 },
  });
  await answeredCard(page);
  const card = await cardBox(page);
  const bar = await page.locator(".mobileTabBar").boundingBox();
  expect(bar, "tab bar is painted").not.toBeNull();
  expect(card.y + card.height, "card clears the tab bar").toBeLessThanOrEqual(bar!.y);
  const top = await page.locator(".mobileMapTopbar").boundingBox();
  expect(top!.y, "the bar clears the top inset").toBeGreaterThanOrEqual(47);
  expect(card.y, "the card sits below the chip row").toBeGreaterThan(top!.y + top!.height);
});
