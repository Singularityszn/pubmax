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

async function loadMap(
  page: Page,
  options: { reducedMotion?: "reduce" | "no-preference"; arrival?: string | null; url?: string } = {},
): Promise<void> {
  await page.emulateMedia({ reducedMotion: options.reducedMotion ?? "reduce" });
  const arrival = options.arrival === undefined ? "dismissed" : options.arrival;
  const storage = await page.context().storageState();
  for (const origin of storage.origins) {
    origin.localStorage = origin.localStorage.filter((entry) => entry.name !== "pubmax:map-first-visit-arrival:v1");
    if (arrival !== null) {
      origin.localStorage.push({ name: "pubmax:map-first-visit-arrival:v1", value: arrival });
    }
  }
  await page.context().setStorageState(storage);
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  });
  const response = await page.goto(options.url ?? "/map");
  expect(response?.status()).toBe(200);
  await expect(page.locator(".mapLoading")).toBeHidden({ timeout: 45_000 });
}

async function openMap(
  page: Page,
  options: { reducedMotion?: "reduce" | "no-preference"; arrival?: string | null; url?: string } = {},
): Promise<void> {
  await loadMap(page, options);
  await expect(page.locator(".mobileMapTopbar")).toBeVisible({ timeout: 45_000 });
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

// The label (an anchor's, or a lens category) rides the eyebrow row above the
// figure, so a walk time can never squeeze it to nothing. The eyebrow is at
// most two lines: "Cheapest in this view", never cut, and the label on its own
// line under it when it does not fit beside it. A lens category is never cut;
// only an anchor or dish name longer than its line may end in an ellipsis. The
// card keeps its fixed 112px. A pint answer has no label. One map load per
// width; every label and walk variant is laid into the same card and measured
// in turn.
const ANCHOR_LABELS = ["Three Sheets seasonal cocktail", "Roast Bone Marrow & Parsley Salad"];
const LAYOUT_LABELS = [...ANCHOR_LABELS, "Alcohol-free", "Soft drinks", "Cocktails", null];
for (const width of [320, 360, 390]) {
  test(`${width}px every label, with and without a walk, keeps the label, the figure and the name inside the card`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: PHONE.height });
    await openMap(page);
    const card = await answeredCard(page);
    for (const label of LAYOUT_LABELS) {
      for (const walk of [true, false]) {
        const variant = `${label ?? "pint"} ${walk ? "with" : "without"} a walk`;
        const layout = await card.evaluate(
          (element, { lineLabel, withWalk }) => {
            const eyebrow = element.querySelector<HTMLElement>(".mapPeekAnswer .mapPeekEyebrow")!;
            const line = element.querySelector<HTMLElement>(".mapPeekAnswer .mapPeekLine")!;
            eyebrow.innerHTML =
              "<span>Cheapest in this view</span>" +
              (lineLabel ? `<span class="mapPeekLabel">· ${lineLabel}</span>` : "");
            line.innerHTML =
              '<span class="mapPeekPrice">£12.00</span>' +
              '<span class="mapPeekName">The Marquis of Granby and Coach House</span>' +
              (withWalk ? '<span class="mapPeekWalk">12 min walk</span>' : "");
            const rect = (found: HTMLElement | null) => {
              if (!found) return null;
              const box = found.getBoundingClientRect();
              return {
                left: box.left,
                right: box.right,
                top: box.top,
                bottom: box.bottom,
                width: box.width,
                clipped: found.scrollWidth > found.clientWidth + 1,
              };
            };
            const answer = element.querySelector<HTMLElement>(".mapPeekAnswer")!;
            const prefix = eyebrow.firstElementChild as HTMLElement;
            const labelElement = eyebrow.querySelector<HTMLElement>(".mapPeekLabel");
            return {
              card: element.getBoundingClientRect().height,
              answer: rect(answer)!,
              door: rect(element.querySelector<HTMLElement>(".mobilePlanActivation")),
              prefix: rect(prefix)!,
              label: rect(labelElement),
              prefixEllipsis: getComputedStyle(prefix).textOverflow === "ellipsis",
              eyebrowLines: Math.round(eyebrow.getBoundingClientRect().height / parseFloat(getComputedStyle(eyebrow).lineHeight)),
              figure: rect(line.querySelector<HTMLElement>(".mapPeekPrice"))!,
              name: rect(line.querySelector<HTMLElement>(".mapPeekName"))!,
              walk: rect(line.querySelector<HTMLElement>(".mapPeekWalk")),
              eyebrowScroll: eyebrow.scrollWidth - eyebrow.clientWidth,
              lineScroll: line.scrollWidth - line.clientWidth,
            };
          },
          { lineLabel: label, withWalk: walk },
        );
        expect(layout.card, `${variant}: the card keeps its fixed height`).toBeCloseTo(112, 0);
        if (layout.door) {
          expect(layout.answer.bottom, `${variant}: the answer never paints over the door`).toBeLessThanOrEqual(layout.door.top + 0.5);
        }
        expect(layout.eyebrowLines, `${variant}: the eyebrow is at most two lines`).toBeLessThanOrEqual(2);
        expect(layout.prefixEllipsis, `${variant}: "Cheapest in this view" is never ellipsed`).toBe(false);
        expect(layout.prefix.clipped, `${variant}: "Cheapest in this view" is printed whole`).toBe(false);
        expect(layout.eyebrowScroll, `${variant}: the eyebrow row never overflows`).toBeLessThanOrEqual(1);
        expect(layout.lineScroll, `${variant}: the line never overflows`).toBeLessThanOrEqual(1);
        if (label === null) {
          expect(layout.label, `${variant}: a pint answer has no label`).toBeNull();
        } else {
          if (!ANCHOR_LABELS.includes(label)) {
            expect(layout.label!.clipped, `${variant}: a lens category is printed whole`).toBe(false);
          }
          expect(layout.label!.width, `${variant}: the label never shrinks to nothing`).toBeGreaterThanOrEqual(40);
          expect(layout.label!.right, variant).toBeLessThanOrEqual(layout.answer.right + 0.5);
          expect(layout.label!.bottom, `${variant}: the label sits above the figure`).toBeLessThanOrEqual(layout.figure.top + 1);
          const sameLine = Math.abs(layout.label!.top - layout.prefix.top) <= 1;
          if (!sameLine) {
            expect(layout.label!.top, `${variant}: a wrapped label starts on the line under the prefix`).toBeGreaterThanOrEqual(layout.prefix.bottom - 1);
          }
        }
        expect(layout.figure.clipped, `${variant}: the figure is never clipped`).toBe(false);
        expect(layout.figure.width, `${variant}: the figure is drawn`).toBeGreaterThan(30);
        expect(layout.figure.left, variant).toBeGreaterThanOrEqual(layout.answer.left);
        expect(layout.name.width, `${variant}: the name keeps room to be read`).toBeGreaterThanOrEqual(30);
        expect(layout.name.left, `${variant}: the name follows the figure`).toBeGreaterThanOrEqual(layout.figure.right);
        expect(layout.name.bottom, variant).toBeLessThanOrEqual(layout.answer.bottom + 1);
        if (layout.walk) {
          expect(layout.walk.right, `${variant}: nothing spills past the answer`).toBeLessThanOrEqual(layout.answer.right + 0.5);
        }
      }
    }
    // The card at its fixed height never reaches the controls stacked above
    // it, whatever its eyebrow carries.
    const clearance = await page.evaluate(() => {
      const box = (selector: string) => {
        const element = document.querySelector<HTMLElement>(selector);
        if (!element || getComputedStyle(element).visibility === "hidden") return null;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 ? { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right } : null;
      };
      return {
        card: box(".mapPeek"),
        nearMe: box(".mobileMapLocateFab"),
        create: box(".createFab"),
        credit: box(".maplibregl-ctrl-attrib"),
      };
    });
    expect(clearance.card, "the card is painted").not.toBeNull();
    expect(clearance.nearMe, "Near me is painted").not.toBeNull();
    expect(clearance.create, "the Create action is painted").not.toBeNull();
    for (const name of ["nearMe", "create", "credit"] as const) {
      const other = clearance[name];
      if (!other) continue;
      const overlap =
        clearance.card!.left < other.right &&
        other.left < clearance.card!.right &&
        clearance.card!.top < other.bottom &&
        other.top < clearance.card!.bottom;
      expect(overlap, `the card clears ${name}: ${JSON.stringify([clearance.card, other])}`).toBe(false);
    }
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
    // The root never takes taps (createFab.css); the button opts back in.
    await expect(fab.locator(".createFab")).not.toHaveCSS("pointer-events", "none");
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
    // Gone means no hit target either: a tap at its centre misses it.
    const fabHit = await fab.locator(".createFab").evaluate((button) => {
      const rect = button.getBoundingClientRect();
      const hit = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      );
      return !!hit && button.contains(hit);
    });
    expect(fabHit).toBe(false);
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

test("an interrupted return still settles and restores Create after a tap or cancellation", async ({ page }) => {
  await openMap(page, { reducedMotion: "no-preference" });
  const card = await answeredCard(page);
  const fab = page.locator(".createFabRoot");
  for (const release of ["pointerup", "pointercancel"]) {
    await card.evaluate(async (element, releaseType) => {
      const fire = (type: string, y: number) => element.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientY: y,
      }));
      fire("pointerdown", 500);
      fire("pointermove", 470);
      fire("pointercancel", 470);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      fire("pointerdown", 470);
      fire(releaseType, 470);
    }, release);
    await expect(card).not.toHaveAttribute("data-dragging", "true", { timeout: 5000 });
    expect(await card.evaluate((element) => (element as HTMLElement).style.transform)).toBe("");
    await expect(fab).toHaveCSS("opacity", "1");
    expect(await fab.locator(".createFab").evaluate((button) => {
      const rect = button.getBoundingClientRect();
      return button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    })).toBe(true);
    await expect(page.locator(".mapVenueList--open")).toHaveCount(0);
  }
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

  await page.reload();
  await expect(page.locator(".mobileMapTopbar")).toBeVisible({ timeout: 45_000 });
  expect(await page.evaluate(() => window.localStorage.getItem("pubmax:map-first-visit-arrival:v1")))
    .toBe(stored);
  await expect(ask).toHaveCount(0);
  await expect(page.locator(".mapPeek")).toBeVisible({ timeout: 20_000 });

  // 31 days on, the ask may be made once more.
  const expired = await page.evaluate(() => {
    const value = `dismissed:${Date.now() - 31 * 24 * 60 * 60 * 1000}`;
    window.localStorage.setItem("pubmax:map-first-visit-arrival:v1", value);
    return value;
  });
  await page.reload();
  expect(await page.evaluate(() => window.localStorage.getItem("pubmax:map-first-visit-arrival:v1")))
    .toBe(expired);
  await expect(page.locator(".mapArrivalCard")).toBeVisible({ timeout: 45_000 });
});

for (const theme of ["light", "dark"] as const) {
  test(`${theme} Coffee keeps Vintage Cafe listed without a whole-view comparison claim`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.route("**/api/price-submit?drinkCategory=coffee", (route) => route.fulfill({
      json: { prices: [], truncated: false, degraded: false },
    }));
    const coffeeRead = page.waitForResponse("**/api/price-submit?drinkCategory=coffee");
    await openMap(page, { url: "/map?drink=coffee&sel=venue-osm-n12110401801" });
    expect((await coffeeRead).ok()).toBe(true);
    const cafe = page.locator('[data-coffee-pilot-cafe="venue-osm-n12110401801"]');
    const sheet = page.getByRole("dialog", { name: "Vintage Cafe", exact: true });
    await expect(sheet.getByRole("heading", { name: "Vintage Cafe" })).toBeVisible();
    await expect(cafe.locator("li").filter({ hasText: "Flat white" })).toContainText("£3.45");
    await page.screenshot({ path: testInfo.outputPath(`390-${theme}-coffee-listed.png`) });
    await sheet.getByRole("button", { name: "Close venue detail", exact: true }).click();
    await expect(cafe).toHaveCount(0);
    await expect(page.locator(".mapPeek")).toHaveCount(0);
    await expect(page.getByText("No listed price here yet", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Show the pubs in this view as a list" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Describe the outing", exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`390-${theme}-coffee-map.png`) });
    await page.getByRole("button", { name: "Drink shown on the map: Coffee. Choose another drink" }).click();
    const drinkSheet = page.locator('.mobileSheetPortal[data-sheet-kind="drink"]');
    await drinkSheet.getByRole("button", { name: "Pints", exact: true }).click();
    await drinkSheet.locator(".surfaceNavHome").click();
    await expect(drinkSheet).toHaveCount(0);
    const card = await answeredCard(page);
    await expect(card.locator(".mapPeekName")).not.toHaveText("Vintage Cafe");
    await expect(card).toHaveCSS("height", "112px");
    await page.screenshot({ path: testInfo.outputPath(`390-${theme}-pub-map.png`) });
  });
}

test("safe-area insets keep the card above the tab bar and under no notch", async ({ page }) => {
  // Set before the page loads. Set after it, the inset failed to reach the
  // topbar in about half of runs on a loaded host (measured 10, not 47).
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setSafeAreaInsetsOverride", {
    insets: { top: 47, bottom: 34, left: 0, right: 0 },
  });
  await openMap(page);
  await answeredCard(page);
  const card = await cardBox(page);
  const bar = await page.locator(".mobileTabBar").boundingBox();
  expect(bar, "tab bar is painted").not.toBeNull();
  expect(card.y + card.height, "card clears the tab bar").toBeLessThanOrEqual(bar!.y);
  const top = await page.locator(".mobileMapTopbar").boundingBox();
  expect(top!.y, "the bar clears the top inset").toBeGreaterThanOrEqual(47);
  expect(card.y, "the card sits below the chip row").toBeGreaterThan(top!.y + top!.height);
});

test.describe("on a desktop map", () => {
  const DESKTOP = { width: 1440, height: 900 };
  test.use({ viewport: DESKTOP, hasTouch: false, isMobile: false });

  test("the card is a phone surface, so no answer or List control hides behind a desktop map", async ({
    page,
  }) => {
    await loadMap(page);
    await expect(page.locator(".maplibregl-canvas")).toBeVisible({ timeout: 45_000 });
    // The same map answers at phone width, so the view has landed and only
    // the width decides whether the card is there.
    await page.setViewportSize(PHONE);
    await answeredCard(page);
    await page.setViewportSize(DESKTOP);
    await expect(page.locator(".mapPeek")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Show the pubs in this view as a list" })).toHaveCount(0);
  });
});
