import { test, expect, type Page } from "@playwright/test";

// The pub replaces the left list column. Controls and banners stay within the
// map lane without overlapping each other. Conditions fill the toolbar row.

function stableVenueIdFromKey(key: string): string {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `venue-${(hash >>> 0).toString(36)}`;
}

function normaliseVenueKeyPart(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

const ARNOS_ARMS_ID = stableVenueIdFromKey(
  [
    normaliseVenueKeyPart("Arnos Arms"),
    normaliseVenueKeyPart("338 Bowes Road, Arnos Grove, London, N11 1AN"),
    (51.6162).toFixed(5),
    (-0.132117).toFixed(5),
  ].join("|"),
);

type ChromeGeometry = {
  drawerRight: number;
  mapLeft: number;
  mapRight: number;
  controls: { label: string; left: number; right: number; top: number; bottom: number }[];
  overlaps: string[];
  ghosts: string[];
};

async function readChromeGeometry(page: Page): Promise<ChromeGeometry> {
  return page.evaluate(() => {
    const drawer = document.querySelector<HTMLElement>(".mapDrawer.right.open")!;
    const drawerRight = drawer.getBoundingClientRect().right;
    const map = document.querySelector<HTMLElement>(".mapStage")!.getBoundingClientRect();
    const mapLeft = map.left;
    const mapRight = map.right;
    const bar = document.querySelector<HTMLElement>(".mapToolbar")!;

    const controls = Array.from(
      bar.querySelectorAll<HTMLElement>("input, select, button, a[href]"),
    )
      .filter((node) => {
        const box = node.getBoundingClientRect();
        return box.width > 0 && box.height > 0;
      })
      .map((node) => {
        const box = node.getBoundingClientRect();
        return {
          label: (
            node.getAttribute("aria-label") ||
            node.textContent ||
            node.getAttribute("placeholder") ||
            node.tagName
          )
            .trim()
            .slice(0, 40),
          left: box.left,
          right: box.right,
          top: box.top,
          bottom: box.bottom,
        };
      });

    const overlaps: string[] = [];
    for (let i = 0; i < controls.length; i += 1) {
      for (let j = i + 1; j < controls.length; j += 1) {
        const a = controls[i];
        const b = controls[j];
        const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (x > 0.5 && y > 0.5) {
          overlaps.push(
            `"${a.label}" [${Math.round(a.left)}-${Math.round(a.right)}] over ` +
              `"${b.label}" [${Math.round(b.left)}-${Math.round(b.right)}]`,
          );
        }
      }
    }

    // Nothing the map floats over its own surface may reach under the sheet.
    const ghosts: string[] = [];
    for (const selector of [".mapToolbar", ".cityStatusStack", ".citySuggestBanner"]) {
      const node = document.querySelector<HTMLElement>(selector);
      if (!node) continue;
      const box = node.getBoundingClientRect();
      if (box.width > 0 && (box.left < mapLeft - 1 || box.right > mapRight + 1)) {
        ghosts.push(`${selector} [${Math.round(box.left)}-${Math.round(box.right)}] outside map [${Math.round(mapLeft)}-${Math.round(mapRight)}]`);
      }
    }

    return { drawerRight, mapLeft, mapRight, controls, overlaps, ghosts };
  });
}

test.describe("desktop venue sheet keeps the map chrome out of its lane (D3)", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });
    await page.route("**/api/tonight-conditions**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          summary: {
            dateLabel: "Thursday 23 Jul",
            factsLine: "Feels like 21°C, cloudy, 10% chance of rain, 9 mph wind, sunset 21:08, daylight.",
            stale: false,
            checkedLabel: "Checked 20 minutes ago",
            drinkLine: "Warm and dry. Beer garden weather.",
            drinkSuggestion: "a cold lager or cider",
            venueClaim: null,
          },
        }),
      }),
    );
  });

  for (const { width, height } of [
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ]) {
    test(`no control sits in another control's box at ${width}x${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      const response = await page.goto(`/map?sel=${ARNOS_ARMS_ID}`, {
        waitUntil: "domcontentloaded",
      });
      expect(response?.status()).toBe(200);

      await expect(page.locator(".mapToolbar")).toBeVisible({ timeout: 30_000 });
      await expect(page.locator(".mapDrawer.right.open")).toBeVisible({ timeout: 30_000 });

      await expect
        .poll(async () => (await readChromeGeometry(page)).controls.length, {
          timeout: 20_000,
        })
        .toBeGreaterThan(1);

      const geometry = await readChromeGeometry(page);
      expect(geometry.overlaps, geometry.overlaps.join(" | ")).toEqual([]);
      expect(geometry.ghosts, geometry.ghosts.join(" | ")).toEqual([]);

      expect(geometry.mapLeft).toBeGreaterThanOrEqual(geometry.drawerRight - 1);
      // Every control the bar still shows stays inside the free map lane.
      for (const control of geometry.controls) {
        expect(control.left, control.label).toBeGreaterThanOrEqual(geometry.mapLeft - 1);
        expect(
          control.right,
          `${control.label} reaches ${Math.round(control.right)}`,
        ).toBeLessThanOrEqual(geometry.mapRight + 1);
      }
    });
  }
});
