import { test, expect, type Page } from "@playwright/test";
import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";

// Synthetic WebGL context-loss recovery. Real iOS backgrounding is not
// lab-reachable; this proves the canvas module (a) preventDefaults the DOM
// event so the browser may restore, (b) marks recovery state on the map
// container, and (c) never replaces a painted map with silent grey.

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await installDeterministicMapBasemap(page);
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

async function sceneBuildCount(page: Page): Promise<number> {
  return page.evaluate(() => performance.getEntriesByName("pubmax:map-scene-built").length);
}

test("/map preventDefaults webglcontextlost and arms recovery without full fallback", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);

  const canvas = page.locator(".maplibreMap canvas").first();
  await expect(canvas).toBeVisible({ timeout: 25_000 });
  // Wait for recovery wiring (style load + construct listeners).
  await expect
    .poll(
      async () =>
        page.locator(".maplibreMap").getAttribute("data-webgl-recovery"),
      { timeout: 30_000 },
    )
    .toBe("listening");
  await expect.poll(() => sceneBuildCount(page)).toBeGreaterThan(0);
  const beforeLoss = await sceneBuildCount(page);

  const result = await page.evaluate(() => {
    const el = document.querySelector(".maplibreMap canvas");
    if (!el) return { ok: false, reason: "no-canvas" as const };
    const event = new Event("webglcontextlost", {
      cancelable: true,
      bubbles: true,
    });
    el.dispatchEvent(event);
    const recovery = document
      .querySelector(".maplibreMap")
      ?.getAttribute("data-webgl-recovery");
    return {
      ok: true as const,
      defaultPrevented: event.defaultPrevented,
      recovery,
    };
  });

  expect(result.ok).toBe(true);
  if (result.ok) {
    // (a) preventDefault so the browser is allowed to restore the context.
    expect(result.defaultPrevented).toBe(true);
    // Recovery schedule is armed immediately.
    expect(result.recovery).toBe("recovering");
  }

  // Canvas stays mounted — no silent unmount / full-fallback swap on a
  // synthetic loss that the browser can still restore.
  await expect(canvas).toBeVisible();
  await expect(page.locator(".mapFallback")).toHaveCount(0);

  // MapLibre 6 destroys its style even for a synthetic loss. Complete the
  // restoration sequence and require the rebuilt scene, not just a live GL.
  await canvas.evaluate((element) => element.dispatchEvent(new Event("webglcontextrestored")));
  await expect(page.locator(".maplibreMap")).toHaveAttribute("data-webgl-recovery", "restored", { timeout: 5_000 });
  await expect.poll(() => sceneBuildCount(page)).toBeGreaterThan(beforeLoss);
  await expect(page.locator(".mapFallback")).toHaveCount(0);
  await expect(canvas).toBeVisible();
});

test("/map dispatches webglcontextrestored → recovery marker and live canvas", async ({
  page,
}) => {
  test.setTimeout(45_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/map");
  const canvas = page.locator(".maplibreMap canvas").first();
  await expect(canvas).toBeVisible({ timeout: 25_000 });
  await expect
    .poll(
      async () =>
        page.locator(".maplibreMap").getAttribute("data-webgl-recovery"),
      { timeout: 30_000 },
    )
    .toBe("listening");
  await expect.poll(() => sceneBuildCount(page)).toBeGreaterThan(0);
  const beforeLoss = await sceneBuildCount(page);

  await page.evaluate(() => {
    const el = document.querySelector(".maplibreMap canvas");
    if (!el) return;
    el.dispatchEvent(
      new Event("webglcontextlost", { cancelable: true, bubbles: true }),
    );
    el.dispatchEvent(
      new Event("webglcontextrestored", { cancelable: true, bubbles: true }),
    );
  });

  await expect
    .poll(
      async () =>
        page.locator(".maplibreMap").getAttribute("data-webgl-recovery"),
      { timeout: 5_000 },
    )
    .toBe("restored");

  await expect.poll(() => sceneBuildCount(page)).toBeGreaterThan(beforeLoss);
  await expect(canvas).toBeVisible();
  await expect(page.locator(".mapFallback")).toHaveCount(0);
});

test("/map restores context while the first scene build is pending", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const mark = performance.mark.bind(performance);
    let injected = false;
    performance.mark = (name, options) => {
      const entry = mark(name, options);
      if (name === "pubmax:map-style-load" && !injected) {
        injected = true;
        queueMicrotask(() => {
          const canvas = document.querySelector(".maplibreMap canvas");
          if (!canvas) throw new Error("No canvas for pending-scene context loss");
          document.documentElement.dataset.testContextLossSceneCount = String(
            performance.getEntriesByName("pubmax:map-scene-built").length,
          );
          canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
          canvas.dispatchEvent(new Event("webglcontextrestored"));
        });
      }
      return entry;
    };
  });
  await page.goto("/map");
  await expect(page.locator("html")).toHaveAttribute("data-test-context-loss-scene-count", "0");
  await expect(page.locator(".maplibreMap")).toHaveAttribute("data-webgl-recovery", "restored", { timeout: 5_000 });
  await expect.poll(() => sceneBuildCount(page)).toBeGreaterThan(0);
  await expect(page.locator(".maplibreMap canvas").first()).toBeVisible();
  await expect(page.locator(".mapFallback")).toHaveCount(0);
});
