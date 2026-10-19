import { expect, test, type Page } from "@playwright/test";

import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";

// THE OPENING PRICES BEFORE THE MAP ENGINE (lib/mapOpeningPreview.ts).
//
// The prerendered /map document draws the discs a cold first visit's first
// frame will draw, and stands down when the engine reveals its own. These hold
// the document's discs to the engine's: the same clusters at the same places,
// shown from the first paint, gone from the reveal, and never shown on a visit
// whose first frame is not the one they were drawn for.

type Disc = { id: number; x: number; y: number };
type Reveal = { discs: Disc[]; painted: Disc[]; donuts: { x: number; y: number }[]; moved: boolean };
type Handoff = { loadingFrameUp: boolean; ground: { left: number; top: number; right: number; bottom: number } | null };

/** A cold first visit: the project's browser state, minus nothing it needs. */
async function coldFirstVisit(page: Page) {
  await installDeterministicMapBasemap(page);
  await page.addInitScript(() => {
    const target = window as Window & { __reveal?: unknown; __handoff?: Handoff | null; __groundSeen?: Handoff["ground"] };
    target.__reveal = null;
    target.__handoff = null;
    target.__groundSeen = null;
    // What was on screen at the handoff: whether the map's loading frame still
    // covered the canvas, and where the basemap picture lay while it showed.
    new MutationObserver(() => {
      const state = document.documentElement.dataset.mapPreview;
      const picture = document.querySelector<HTMLElement>(".mapOpeningGroundPicture");
      const ground = document.querySelector<HTMLElement>(".mapOpeningGround");
      if (state === "on" && picture && ground && getComputedStyle(ground).display !== "none") {
        const r = picture.getBoundingClientRect();
        target.__groundSeen = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      }
      if (state === "done" && !target.__handoff) {
        target.__handoff = {
          loadingFrameUp: Boolean(document.querySelector(".mapLoading")),
          ground: target.__groundSeen ?? null,
        };
      }
    }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-map-preview"] });
    window.addEventListener("pubmax:pins-visible", () => {
      // Read in the same task the reveal runs in: the frame both are about.
      const discs = [...document.querySelectorAll<HTMLElement>(".mapOpeningPreviewDisc")].map((el) => {
        const r = el.getBoundingClientRect();
        return { id: Number(el.dataset.clusterId), x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      // The engine's discs fade in over their entrance; read them once they
      // are painted, for as long as the camera is still the opening one.
      const started = performance.now();
      const read = () => {
        const probe = (window as Window & {
          __pubmaxPaintedMapTapPoints?: () => { kind: string; id: string; x: number; y: number }[];
        }).__pubmaxPaintedMapTapPoints;
        const painted = (probe?.() ?? [])
          .filter((p) => p.kind === "cluster")
          .map((p) => ({ id: Number(p.id), x: p.x, y: p.y }));
        const donuts = [...document.querySelectorAll<HTMLElement>(".donut-cluster-marker")].map((el) => {
          const r = el.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        });
        const moved = performance.getEntriesByName("pubmax:camera-intent:arrival").length > 0;
        if (painted.length + donuts.length === 0 && !moved && performance.now() - started < 3000) {
          window.setTimeout(read, 50);
          return;
        }
        target.__reveal = { discs, painted, donuts, moved };
      };
      window.setTimeout(read, 50);
    });
  });
}

async function readReveal(page: Page): Promise<Reveal> {
  await page.waitForFunction(() => (window as Window & { __reveal?: unknown }).__reveal, null, {
    timeout: 60_000,
  });
  return page.evaluate(() => (window as unknown as { __reveal: Reveal }).__reveal);
}

test.describe("the document's opening prices", () => {
  test("ship in the prerendered /map document, with no script of their own", async ({ request }) => {
    const html = await (await request.get("/map")).text();
    expect(html).toContain('class="mapOpeningPreview"');
    expect(html).toMatch(/elementtiming="map-first-price"[^>]*>£\d/);
    // The pre-paint gate is the shared theme-init block, not a new script.
    expect(html).toContain("pubmax:first-pins-seen:v1");
  });

  test("show from the first paint on a phone and hand over to the engine's discs in place", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await coldFirstVisit(page);
    await page.goto("/map");
    await expect(page.locator("html")).toHaveAttribute("data-map-preview", /on|done/);
    const reveal = await readReveal(page);

    // Every disc the engine painted on screen is a disc the document drew, at
    // the same place, read before the arrival turn moves the camera on.
    expect(reveal.moved, "the camera moved before the engine's discs were painted").toBe(false);
    expect(reveal.painted.length).toBeGreaterThan(0);
    for (const painted of reveal.painted) {
      const twin = reveal.discs.find((disc) => disc.id === painted.id);
      expect(twin, `cluster ${painted.id}`).toBeDefined();
      expect(Math.abs(twin!.x - painted.x), `x of ${painted.id}`).toBeLessThan(1.5);
      expect(Math.abs(twin!.y - painted.y), `y of ${painted.id}`).toBeLessThan(1.5);
    }
    // The other direction, that the document draws no disc the engine would
    // not, is not read off this probe: it reports only marks a tap could reach,
    // so a disc behind the chrome is missing from it. That half is the frame
    // check's (frameMatchesPreview, __tests__/mapOpeningPreview.test.ts): the
    // preview stands down before the reveal if the engine's discs differ.

    // The preview has stood down, and the handoff was the reveal: no earlier
    // (a resize is not a camera move), and in the frame the loading frame
    // lifted off the canvas rather than while it still covered it.
    await expect(page.locator("html")).toHaveAttribute("data-map-preview", "done");
    await expect(page.locator(".mapOpeningPreview")).toBeHidden();
    await expect(page.locator(".mapOpeningGround")).toBeHidden();
    const [done, visible] = await page.evaluate(() => [
      performance.getEntriesByName("pubmax:opening-preview-done")[0]?.startTime ?? null,
      performance.getEntriesByName("pubmax:pins-visible")[0]?.startTime ?? null,
    ]);
    expect(done).not.toBeNull();
    expect(done!).toBeGreaterThanOrEqual(visible! - 1);
    const handoff = await page.evaluate(() => (window as unknown as { __handoff: Handoff | null }).__handoff);
    expect(handoff?.loadingFrameUp, "the loading frame still covered the canvas at the handoff").toBe(false);
    // The basemap picture under the discs reached past every edge of the
    // screen while it showed, so no edge of it was ever on screen.
    expect(handoff?.ground, "the basemap picture never showed").not.toBeNull();
    expect(handoff!.ground!.left).toBeLessThanOrEqual(0);
    expect(handoff!.ground!.top).toBeLessThanOrEqual(0);
    expect(handoff!.ground!.right).toBeGreaterThanOrEqual(390);
    expect(handoff!.ground!.bottom).toBeGreaterThanOrEqual(844);
  });

  test("stand down on a desktop no later than the engine's reveal, aligned if the camera has not moved", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await coldFirstVisit(page);
    await page.goto("/map");
    const reveal = await readReveal(page);
    await expect(page.locator("html")).toHaveAttribute("data-map-preview", "done");
    const marks = await page.evaluate(() => ({
      done: performance.getEntriesByName("pubmax:opening-preview-done")[0]?.startTime ?? null,
      visible: performance.getEntriesByName("pubmax:pins-visible")[0]?.startTime ?? null,
      arrival: performance.getEntriesByName("pubmax:camera-intent:arrival")[0]?.startTime ?? null,
    }));
    expect(marks.done).not.toBeNull();
    // At the reveal, or before it if the arrival turn ran first; never while
    // the loading frame still covered the canvas.
    const handoff = await page.evaluate(() => (window as unknown as { __handoff: Handoff | null }).__handoff);
    if (marks.done! > marks.visible! + 1) expect(handoff?.loadingFrameUp).toBe(false);
    // A desktop is wider than any picture of the opening streets, so it never
    // showed one.
    expect(handoff?.ground ?? null).toBeNull();
    // Where the camera was still the opening one at the reveal, the desktop's
    // own discs stand where the document's stood.
    if (!reveal.moved && (marks.arrival === null || marks.arrival > marks.visible!)) {
      for (const donut of reveal.donuts) {
        const twin = reveal.discs.find(
          // A DOM marker is placed on whole pixels, the document's disc is not.
          (disc) => Math.abs(disc.x - donut.x) < 2.5 && Math.abs(disc.y - donut.y) < 2.5,
        );
        expect(twin, `donut at ${donut.x},${donut.y}`).toBeDefined();
      }
    }
  });

  test("never show for a returning visitor, whose map opens elsewhere", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installDeterministicMapBasemap(page);
    await page.addInitScript(() => window.localStorage.setItem("pubmax:first-pins-seen:v1", "1"));
    await page.goto("/map");
    await expect(page.locator(".mapOpeningPreview")).toBeHidden();
    expect(await page.locator("html").getAttribute("data-map-preview")).toBeNull();
  });

  test("never show for a link that names another view", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installDeterministicMapBasemap(page);
    await page.goto("/map?lens=wine");
    await expect(page.locator(".mapOpeningPreview")).toBeHidden();
    expect(await page.locator("html").getAttribute("data-map-preview")).toBeNull();
  });

  test("leave with a cut, not a fade, for a reader who asked for less motion", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await coldFirstVisit(page);
    await page.goto("/map");
    await readReveal(page);
    await expect(page.locator("html")).toHaveAttribute("data-map-preview", "done");
    const duration = await page
      .locator(".mapOpeningPreview")
      .evaluate((el) => getComputedStyle(el).transitionDuration);
    // The app's global reduced-motion rule clamps every transition to 0.01 ms.
    expect(duration.split(",").every((value) => Number.parseFloat(value) <= 0.001)).toBe(true);
  });
});
