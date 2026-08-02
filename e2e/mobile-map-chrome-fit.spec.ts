import { expect, test, type Locator, type Page } from "@playwright/test";

// Rendered geometry for the phone map chrome at 320, 390 and 430.
//
// Design judgement 2026-08-01, finding 2.3 collapsed that chrome to ONE bar.
// What used to stack here — a Near me / Tonight / Filters rail and a
// full-width category band — is gone: the category toggles live in the Filters
// sheet, Near me is a round map-edge FAB, and Tonight keeps its other two
// homes. So the measurements below are the bar, the map-edge lane and the plan
// pill, and the budget they may not exceed.

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 320, height: 568 },
] as const;

type Rect = {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
};

type ShellLayout = {
  topbar: Rect;
  utility: Rect;
  locate: Rect;
  plan: Rect;
  barControls: Array<Rect & { label: string }>;
  barClientWidth: number;
  barScrollWidth: number;
};

test.use({
  launchOptions: {
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  },
  video:
    process.env.PUBMAX_MOBILE_MAP_EVIDENCE === "1"
      ? { mode: "on", size: { width: 390, height: 844 } }
      : "off",
});

test.setTimeout(120_000);

async function openPhoneMap(
  page: Page,
  viewport: (typeof VIEWPORTS)[number],
  reducedMotion: "reduce" | "no-preference" = "reduce",
  path = "/map",
): Promise<void> {
  await page.setViewportSize(viewport);
  await page.emulateMedia({ reducedMotion });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition(success: PositionCallback) {
          success({
            coords: {
              latitude: 51.515,
              longitude: -0.09,
              accuracy: 10,
            },
          } as GeolocationPosition);
        },
      },
    });
  });

  const response = await page.goto(path);
  expect(response?.status()).toBe(200);
  await expect(page.locator(".mobileMapTopbar")).toBeVisible({
    timeout: 45_000,
  });
  // One bar: neither the old rail nor the map-floating category band.
  await expect(page.locator(".mobileMapRail")).toHaveCount(0);
  await expect(
    page.getByRole("group", { name: "Tonight arc venue types" }),
  ).toHaveCount(0);
  await expect(page.locator(".mobileMapLocateFab")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Describe your night" }),
  ).toBeVisible();
  await expect(page.locator(".mapLoading")).toBeHidden({ timeout: 45_000 });
}

async function shellLayout(page: Page): Promise<ShellLayout> {
  return page.evaluate(() => {
    const rect = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) throw new Error(`Missing ${selector}`);
      const box = element.getBoundingClientRect();
      return {
        top: box.top,
        right: box.right,
        bottom: box.bottom,
        left: box.left,
        width: box.width,
        height: box.height,
      };
    };
    const bar = document.querySelector<HTMLElement>(".mobileMapTopbar");
    if (!bar) throw new Error("Missing the phone map bar");

    return {
      topbar: rect(".mobileMapTopbar"),
      utility: rect(".mobileMapTflButton"),
      locate: rect(".mobileMapLocateFab"),
      plan: rect(".mobilePlanActivation"),
      barControls: [...bar.querySelectorAll<HTMLElement>("a, button")].map(
        (control) => {
          const box = control.getBoundingClientRect();
          return {
            label:
              control.getAttribute("aria-label") ??
              control.textContent?.replace(/\s+/g, " ").trim() ??
              "",
            top: box.top,
            right: box.right,
            bottom: box.bottom,
            left: box.left,
            width: box.width,
            height: box.height,
          };
        },
      ),
      barClientWidth: bar.clientWidth,
      barScrollWidth: bar.scrollWidth,
    };
  });
}

async function tapRenderedCentre(
  page: Page,
  control: Locator,
  viewportWidth: number,
  label: string,
  scrollIntoView = true,
  visibleWithin?: Locator,
): Promise<void> {
  if (scrollIntoView) {
    await control.scrollIntoViewIfNeeded();
  }
  const box = await control.boundingBox();
  expect(box, `${label} has a rendered box`).not.toBeNull();
  if (!box) return;
  expect(box.width, `${label} width`).toBeGreaterThanOrEqual(44);
  expect(box.height, `${label} height`).toBeGreaterThanOrEqual(44);
  expect(box.x, `${label} left`).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, `${label} right`).toBeLessThanOrEqual(
    viewportWidth,
  );
  if (visibleWithin) {
    const containerBox = await visibleWithin.boundingBox();
    expect(containerBox, `${label} visible container has a box`).not.toBeNull();
    if (containerBox) {
      expect(box.x, `${label} clears its container left`).toBeGreaterThanOrEqual(
        containerBox.x,
      );
      expect(
        box.x + box.width,
        `${label} clears its container right`,
      ).toBeLessThanOrEqual(containerBox.x + containerBox.width);
    }
  }

  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const receivesTap = await control.evaluate(
    (button, point) => {
      const hit = document.elementFromPoint(point.x, point.y);
      return hit === button || (hit !== null && button.contains(hit));
    },
    centre,
  );
  expect(receivesTap, `${label} owns its centre point`).toBe(true);
  await page.mouse.click(centre.x, centre.y);
}

async function dismissSheet(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(page.locator(".mobileSheetPortal:visible")).toHaveCount(0);
}

for (const viewport of VIEWPORTS) {
  test(`${viewport.width}px phone chrome is one bar sharing the shell boundary`, async ({
    page,
  }) => {
    await openPhoneMap(page, viewport);
    const layout = await shellLayout(page);
    console.log(
      `mobile-map-chrome-layout ${viewport.width}px ${JSON.stringify(layout)}`,
    );

    for (const [name, box] of Object.entries({
      topbar: layout.topbar,
      plan: layout.plan,
    })) {
      expect(box.left, `${name} left is inside viewport`).toBeGreaterThanOrEqual(
        0,
      );
      expect(box.right, `${name} right is inside viewport`).toBeLessThanOrEqual(
        viewport.width,
      );
    }

    const shared = [layout.topbar, layout.plan];
    expect(
      new Set(shared.map(({ left }) => Math.round(left))).size,
      "stacked surfaces share one left edge",
    ).toBe(1);
    expect(
      new Set(shared.map(({ right }) => Math.round(right))).size,
      "stacked surfaces share one right edge",
    ).toBe(1);

    // The whole top chrome is the bar. Its budget is what one bar costs, not
    // what a three-row stack used to.
    expect(
      layout.topbar.bottom - layout.topbar.top,
      "phone top chrome height",
    ).toBeLessThanOrEqual(60);

    // The map-edge lane runs TfL at the top and Near me at the thumb, both
    // right-aligned and both clear of the bar.
    expect(layout.utility.top, "TfL clears the bar").toBeGreaterThan(
      layout.topbar.bottom,
    );
    expect(layout.locate.top, "Near me sits below TfL").toBeGreaterThan(
      layout.utility.bottom,
    );
    expect(layout.locate.bottom, "Near me clears the plan pill").toBeLessThanOrEqual(
      layout.plan.top,
    );
    expect(
      Math.round(layout.locate.right),
      "map-edge controls share one right edge",
    ).toBe(Math.round(layout.utility.right));

    // The bar never scrolls: every control is rendered, none is cut.
    expect(layout.barScrollWidth).toBeLessThanOrEqual(layout.barClientWidth);
    for (const control of layout.barControls) {
      expect(control.left, `${control.label} left is visible`).toBeGreaterThanOrEqual(
        layout.topbar.left,
      );
      expect(control.right, `${control.label} right is visible`).toBeLessThanOrEqual(
        layout.topbar.right,
      );
      expect(control.height, `${control.label} tap height`).toBeGreaterThanOrEqual(
        44,
      );
    }
  });

  test(`${viewport.width}px phone map controls receive their own taps`, async ({
    page,
  }) => {
    await openPhoneMap(page, viewport);
    const topbar = page.locator(".mobileMapTopbar");
    // No location is granted in this run, so the chip names what the map is
    // looking at rather than claiming the reader.
    const area = topbar.getByRole("button", { name: /^Area in view:/ });
    await tapRenderedCentre(page, area, viewport.width, "Area");
    await expect(
      page.locator('.mobileSheetPortal[data-sheet-kind="area"]:visible'),
    ).toHaveCount(1);
    await dismissSheet(page);

    const search = topbar.getByRole("button", { name: "Search the map" });
    await tapRenderedCentre(page, search, viewport.width, "Search");
    await expect(
      page.getByRole("combobox", { name: "Search pubs" }),
    ).toBeVisible();
    await tapRenderedCentre(page, search, viewport.width, "Close search");
    await expect(
      page.getByRole("combobox", { name: "Search pubs" }),
    ).toHaveCount(0);

    const more = topbar.getByRole("button", { name: "More map controls" });
    await tapRenderedCentre(page, more, viewport.width, "More map controls");
    await expect(
      page.locator('.mobileSheetPortal[data-sheet-kind="layers"]:visible'),
    ).toHaveCount(1);
    await dismissSheet(page);

    // Near me is the map-edge FAB now. Its state is its accessible name.
    const nearMe = page.getByRole("button", { name: "Near me" });
    await tapRenderedCentre(page, nearMe, viewport.width, "Near me", false);
    await expect(page.getByRole("button", { name: /^Nearby \d+$/ })).toBeVisible({
      timeout: 20_000,
    });
    if (await page.locator(".mobileSheetPortal:visible").count()) {
      await dismissSheet(page);
    }

    const filters = topbar.getByRole("button", { name: /^Filters/ });
    await tapRenderedCentre(page, filters, viewport.width, "Filters");
    const sheet = page.locator(
      '.mobileSheetPortal[data-sheet-kind="filters"]:visible',
    );
    await expect(sheet).toHaveCount(1);

    // The venue-type toggles have exactly one home on a phone: this sheet.
    const arc = sheet.getByRole("group", { name: "Tonight arc venue types" });
    await expect(arc).toHaveCount(1);
    const arcButtons = arc.locator(".tonightArcChip");
    expect(await arcButtons.count()).toBe(5);
    for (let index = 0; index < (await arcButtons.count()); index += 1) {
      const button = arcButtons.nth(index);
      const label =
        (await button.getAttribute("aria-label")) ??
        (await button.textContent())?.trim() ??
        `Tonight Arc control ${index + 1}`;
      const disabled = (await button.getAttribute("aria-disabled")) === "true";
      const pressedBefore = await button.getAttribute("aria-pressed");
      await tapRenderedCentre(page, button, viewport.width, label);
      if (disabled) {
        await expect(button).toHaveAttribute("aria-expanded", "true");
        await tapRenderedCentre(page, button, viewport.width, `Close ${label}`);
        await expect(button).toHaveAttribute("aria-expanded", "false");
      } else {
        await expect(button).toHaveAttribute(
          "aria-pressed",
          pressedBefore === "true" ? "false" : "true",
        );
      }
    }

    const wine = sheet
      .getByRole("group", { name: "Filter by drink shape" })
      .getByRole("button", { name: "Wine", exact: true });
    await tapRenderedCentre(page, wine, viewport.width, "Wine filter");
    await expect(
      sheet
        .getByRole("group", { name: "Filter by drink shape" })
        .getByRole("button", { name: "Wine (selected)" }),
    ).toHaveAttribute("aria-pressed", "true");
  });
}

test("320px keeps the whole place name and the map-edge lane tappable", async ({
  page,
}) => {
  const viewport = VIEWPORTS[2];
  await openPhoneMap(page, viewport, "reduce", "/map?drink=wine");

  const topbar = page.locator(".mobileMapTopbar");
  // The wordmark yields its column at 360px and below, so the place name is
  // read whole rather than cut (design judgement 2026-08-01, finding 2.3).
  await expect(topbar.locator(".mobileMapBrand")).toBeHidden();
  const areaName = topbar.locator(".mobileMapAreaLabel");
  const areaFit = await areaName.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(
    areaFit.scrollWidth,
    "the place name is not truncated at 320px",
  ).toBeLessThanOrEqual(areaFit.clientWidth);

  const filters = topbar.getByRole("button", {
    name: "Filters: drinks active",
  });
  await expect(filters.locator(".mobileMapTopbarBadge")).toHaveText("1");
  await tapRenderedCentre(
    page,
    filters,
    viewport.width,
    "Active Filters",
    false,
    topbar,
  );
  await expect(
    page.locator('.mobileSheetPortal[data-sheet-kind="filters"]:visible'),
  ).toHaveCount(1);
  await dismissSheet(page);

  const nearMe = page.getByRole("button", { name: "Near me" });
  await tapRenderedCentre(page, nearMe, viewport.width, "Near me", false);
  await expect(page.getByRole("button", { name: /^Nearby \d+$/ })).toBeVisible({
    timeout: 20_000,
  });
  if (await page.locator(".mobileSheetPortal:visible").count()) {
    await dismissSheet(page);
  }

  const safeAreaRight = 32;
  const chromium = await page.context().newCDPSession(page);
  await chromium.send("Emulation.setSafeAreaInsetsOverride", {
    insets: { top: 0, right: safeAreaRight, bottom: 0, left: 0 },
  });
  await page.evaluate(async () => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
  });

  const safeAreaLayout = await page.evaluate(() => {
    const box = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) throw new Error(`Missing ${selector}`);
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width };
    };
    return {
      tfl: box(".mobileMapTflButton"),
      locate: box(".mobileMapLocateFab"),
    };
  });
  expect(safeAreaLayout.tfl.right).toBe(viewport.width - safeAreaRight);
  expect(
    Math.round(safeAreaLayout.locate.right),
    "both map-edge controls honour the safe-area inset",
  ).toBe(viewport.width - safeAreaRight);
});

test("390px recorded map journey reaches Filters and a painted pin", async ({
  page,
}) => {
  const viewport = VIEWPORTS[0];
  await openPhoneMap(page, viewport, "no-preference");
  await page.waitForTimeout(500);

  const filters = page
    .locator(".mobileMapTopbar")
    .getByRole("button", { name: /^Filters/ });
  await tapRenderedCentre(page, filters, viewport.width, "Filters");
  const filtersSheet = page.locator(
    '.mobileSheetPortal[data-sheet-kind="filters"]:visible',
  );
  await expect(filtersSheet).toHaveCount(1);

  const wine = filtersSheet
    .getByRole("group", { name: "Filter by drink shape" })
    .getByRole("button", { name: "Wine", exact: true });
  await tapRenderedCentre(page, wine, viewport.width, "Wine filter");
  await expect(
    filtersSheet.getByRole("button", { name: "Wine (selected)" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(500);

  const closeFilters = filtersSheet.locator(".mobileSharedSheetClose");
  await tapRenderedCentre(
    page,
    closeFilters,
    viewport.width,
    "Close Filters",
  );
  await expect(filtersSheet).toHaveCount(0);
  await page.waitForTimeout(500);

  const venueSheet = page.locator(
    '.mobileSheetPortal[data-sheet-kind="venue"]:visible',
  );
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();

  await page.evaluate(() => {
    const testWindow = window as typeof window & {
      __mobileMapCameraIntentCount?: number;
    };
    testWindow.__mobileMapCameraIntentCount = 0;
    window.addEventListener("pubmax:camera-intent", () => {
      testWindow.__mobileMapCameraIntentCount =
        (testWindow.__mobileMapCameraIntentCount ?? 0) + 1;
    });
  });

  let cameraIntentCount = 0;
  let pinOpened = false;
  for (let cameraStage = 0; cameraStage < 7 && !pinOpened; cameraStage += 1) {
    let cameraAdvanced = false;
    for (let y = 110; y <= 670 && !pinOpened && !cameraAdvanced; y += 20) {
      for (let x = 20; x <= 300; x += 20) {
        await page.mouse.click(x, y);
        await page.waitForTimeout(40);
        if (await venueSheet.count()) {
          pinOpened = true;
          break;
        }
        const nextCameraIntentCount = await page.evaluate(
          () =>
            (
              window as typeof window & {
                __mobileMapCameraIntentCount?: number;
              }
            ).__mobileMapCameraIntentCount ?? 0,
        );
        if (nextCameraIntentCount > cameraIntentCount) {
          cameraIntentCount = nextCameraIntentCount;
          cameraAdvanced = true;
          break;
        }
      }
    }
    if (cameraAdvanced) {
      await page.waitForTimeout(850);
    }
  }
  expect(pinOpened, "a painted map pin receives its own tap").toBe(true);
  await expect(venueSheet).toHaveCount(1);
  await page.waitForTimeout(1_200);
});
