import { expect, test, type Locator, type Page } from "@playwright/test";

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
  rail: Rect;
  arc: Rect;
  utility: Rect;
  plan: Rect;
  railButtons: Array<Rect & { label: string }>;
  railOverflowX: string;
  railClientWidth: number;
  railScrollWidth: number;
  arcOverflowX: string;
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

  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);
  await expect(page.locator(".mobileMapTopbar")).toBeVisible({
    timeout: 45_000,
  });
  await expect(page.locator(".mobileMapRail")).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Tonight arc venue types" }),
  ).toBeVisible({ timeout: 45_000 });
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
    const rail = document.querySelector<HTMLElement>(".mobileMapRail");
    const arcRow = document.querySelector<HTMLElement>(".tonightArcRow");
    if (!rail || !arcRow) throw new Error("Missing mobile map rows");

    return {
      topbar: rect(".mobileMapTopbar"),
      rail: rect(".mobileMapRail"),
      arc: rect(".tonightArcChips"),
      utility: rect(".mobileMapUtilityCorner > button"),
      plan: rect(".mobilePlanActivation"),
      railButtons: [...rail.querySelectorAll<HTMLElement>("button")].map(
        (button) => {
          const box = button.getBoundingClientRect();
          return {
            label:
              button.getAttribute("aria-label") ??
              button.textContent?.replace(/\s+/g, " ").trim() ??
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
      railOverflowX: getComputedStyle(rail).overflowX,
      railClientWidth: rail.clientWidth,
      railScrollWidth: rail.scrollWidth,
      arcOverflowX: getComputedStyle(arcRow).overflowX,
    };
  });
}

async function tapRenderedCentre(
  page: Page,
  control: Locator,
  viewportWidth: number,
  label: string,
): Promise<void> {
  await control.scrollIntoViewIfNeeded();
  const box = await control.boundingBox();
  expect(box, `${label} has a rendered box`).not.toBeNull();
  if (!box) return;
  expect(box.width, `${label} width`).toBeGreaterThanOrEqual(44);
  expect(box.height, `${label} height`).toBeGreaterThanOrEqual(44);
  expect(box.x, `${label} left`).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, `${label} right`).toBeLessThanOrEqual(
    viewportWidth,
  );

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
  test(`${viewport.width}px phone chrome shares one boundary and fits 164px`, async ({
    page,
  }) => {
    await openPhoneMap(page, viewport);
    const layout = await shellLayout(page);
    console.log(
      `mobile-map-chrome-layout ${viewport.width}px ${JSON.stringify(layout)}`,
    );

    for (const [name, box] of Object.entries({
      topbar: layout.topbar,
      rail: layout.rail,
      arc: layout.arc,
      plan: layout.plan,
    })) {
      expect(box.left, `${name} left is inside viewport`).toBeGreaterThanOrEqual(
        0,
      );
      expect(box.right, `${name} right is inside viewport`).toBeLessThanOrEqual(
        viewport.width,
      );
    }

    const shared = [layout.topbar, layout.rail, layout.arc, layout.plan];
    expect(
      new Set(shared.map(({ left }) => Math.round(left))).size,
      "stacked surfaces share one left edge",
    ).toBe(1);
    expect(
      new Set(shared.map(({ right }) => Math.round(right))).size,
      "stacked surfaces share one right edge",
    ).toBe(1);

    const chromeTop = Math.min(
      layout.topbar.top,
      layout.rail.top,
      layout.arc.top,
      layout.utility.top,
    );
    const chromeBottom = Math.max(
      layout.topbar.bottom,
      layout.rail.bottom,
      layout.arc.bottom,
      layout.utility.bottom,
    );
    expect(chromeBottom - chromeTop, "phone chrome height").toBeLessThanOrEqual(
      164,
    );

    expect(layout.railOverflowX).toBe("auto");
    expect(layout.arcOverflowX).toBe("auto");
    for (const button of layout.railButtons) {
      expect(button.left, `${button.label} left is visible`).toBeGreaterThanOrEqual(
        layout.rail.left,
      );
      expect(button.right, `${button.label} right is visible`).toBeLessThanOrEqual(
        layout.rail.right,
      );
      expect(button.height, `${button.label} tap height`).toBeGreaterThanOrEqual(
        44,
      );
    }
  });

  test(`${viewport.width}px phone map controls receive their own taps`, async ({
    page,
  }) => {
    await openPhoneMap(page, viewport);
    const topbar = page.locator(".mobileMapTopbar");
    const area = topbar.getByRole("button", { name: /^Area:/ });
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

    const pal = topbar.getByRole("button", { name: "Open Pub Pal" });
    await tapRenderedCentre(page, pal, viewport.width, "Pub Pal");
    await expect(
      page.locator('.mobileSheetPortal[data-sheet-kind="pub-pal"]:visible'),
    ).toHaveCount(1);
    await dismissSheet(page);

    const more = topbar.getByRole("button", { name: "More map controls" });
    await tapRenderedCentre(page, more, viewport.width, "More map controls");
    await expect(
      page.locator('.mobileSheetPortal[data-sheet-kind="layers"]:visible'),
    ).toHaveCount(1);
    await dismissSheet(page);

    const arc = page.getByRole("group", {
      name: "Tonight arc venue types",
    });
    const arcButtons = arc.locator(".tonightArcChip");
    const arcButtonCount = await arcButtons.count();
    expect(arcButtonCount).toBe(5);
    for (let index = 0; index < arcButtonCount; index += 1) {
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

    const rail = page.getByRole("navigation", {
      name: "Contextual map controls",
    });

    const nearMe = rail.getByRole("button", { name: "Near me" });
    await tapRenderedCentre(page, nearMe, viewport.width, "Near me");
    await expect(rail.getByRole("button", { name: "Nearby" })).toBeVisible({
      timeout: 20_000,
    });
    if (await page.locator(".mobileSheetPortal:visible").count()) {
      await dismissSheet(page);
    }

    const tonight = rail.getByRole("button", { name: /^Tonight/ });
    await tapRenderedCentre(page, tonight, viewport.width, "Tonight");
    await expect(
      page.locator('.mobileSheetPortal[data-sheet-kind="tonight"]:visible'),
    ).toHaveCount(1);
    await dismissSheet(page);

    const filters = rail.getByRole("button", { name: /^Filters/ });
    await tapRenderedCentre(page, filters, viewport.width, "Filters");
    const sheet = page.locator(
      '.mobileSheetPortal[data-sheet-kind="filters"]:visible',
    );
    await expect(sheet).toHaveCount(1);
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

test("390px recorded map journey reaches Filters and a painted pin", async ({
  page,
}) => {
  const viewport = VIEWPORTS[0];
  await openPhoneMap(page, viewport, "no-preference");
  await page.waitForTimeout(500);

  const filters = page
    .getByRole("navigation", { name: "Contextual map controls" })
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
    for (let y = 190; y <= 670 && !pinOpened && !cameraAdvanced; y += 20) {
      for (let x = 20; x <= 340; x += 20) {
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
