import AxeBuilder from "@axe-core/playwright";

import { expect, test } from "@playwright/test";

for (const width of [390, 768, 1440]) {
  for (const theme of ["light", "dark"] as const) {
    test(`London journal and requested film at ${width}px in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await page.addInitScript((value) => localStorage.setItem("pubmax-theme", value), theme);
      const mediaRequests: string[] = [];
      page.on("request", (request) => {
        if (request.url().endsWith("/london.mp4")) mediaRequests.push(request.url());
      });
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "What a pint costs, pub by pub." })).toBeVisible();
      const journal = page.getByRole("region", { name: "Around London" });
      await journal.scrollIntoViewIfNeeded();
      await expect(journal.getByRole("link")).toHaveCount(4);
      await expect(journal.getByRole("link", { name: /The Crown Tavern/ }))
        .toHaveAttribute("href", "/map?sel=venue-13sug69");
      await expect(journal.locator("img").first()).toBeVisible();
      const film = page.getByRole("region", { name: "London, day to night" });
      const play = film.getByRole("button", { name: /Play London film/ });
      await play.scrollIntoViewIfNeeded();
      await expect(play).toBeVisible();
      await expect(film.locator("video")).toHaveCount(0);
      expect(mediaRequests).toEqual([]);
      const frame = await film.locator(".lpFilmFrame").boundingBox();
      await play.focus();
      await expect(async () => {
        if (await play.isVisible()) await play.press("Enter");
        await expect(film.locator("video")).toBeVisible({ timeout: 1_000 });
      }).toPass({ timeout: 20_000 });
      const video = film.locator("video");
      await expect(video).toBeFocused();
      await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0);
      expect(await video.evaluate((element: HTMLVideoElement) => element.duration)).toBeCloseTo(12, 1);
      expect(await video.evaluate((element: HTMLVideoElement) => element.controls && !element.loop)).toBe(true);
      expect(mediaRequests.length).toBeGreaterThan(0);
      const playingFrame = await film.locator(".lpFilmFrame").boundingBox();
      expect(playingFrame?.height).toBeCloseTo(frame?.height ?? 0, 0);
      await video.evaluate((element: HTMLVideoElement) => element.pause());
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
  }
}

test("film failure preserves an accessible retry", async ({ page }) => {
  await page.route("**/landing/london-film/london.mp4", (route) => route.abort());
  await page.goto("/");
  const film = page.getByRole("region", { name: "London, day to night" });
  await film.getByRole("button", { name: /Play London film/ }).click();
  await expect(film.getByRole("status")).toContainText("The film could not load");
  await expect(film.getByRole("button", { name: /Try the film again/ })).toBeVisible();
});

// Playback and retry may move focus once. A preferred-city update must not move it again.
for (const failed of [false, true]) {
  for (const update of ["same-tab", "cross-tab"] as const) {
    test(`film preserves focus and scroll after a ${update} city update while ${failed ? "awaiting retry" : "playing"}`, async ({ page, context }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.addInitScript(() => localStorage.removeItem("pubmax:preferredCity:v1"));
      if (failed) await page.route("**/landing/london-film/london.mp4", (route) => route.abort());
      await page.goto("/");
      const film = page.getByRole("region", { name: "London, day to night" });
      await film.getByRole("button", { name: /Play London film/ }).click();
      const target = failed ? film.getByRole("button", { name: /Try the film again/ }) : film.locator("video");
      await expect(target).toBeFocused();
      const elsewhere = page.getByRole("link", { name: "Pick your city", exact: true });
      await elsewhere.scrollIntoViewIfNeeded();
      await elsewhere.focus();
      const scrollY = await page.evaluate(() => window.scrollY);
      if (update === "same-tab") {
        await page.evaluate(() => {
          localStorage.setItem("pubmax:preferredCity:v1", "manchester");
          window.dispatchEvent(new Event("pubmax:preferred-city"));
        });
      } else {
        const otherTab = await context.newPage();
        try {
          await otherTab.goto("/privacy");
          await otherTab.evaluate(() => localStorage.setItem("pubmax:preferredCity:v1", "manchester"));
        } finally {
          await otherTab.close();
        }
      }
      // The changed destination proves the LandingPage subscription rendered the update.
      await expect(page.getByRole("navigation", { name: "Landing navigation" }).getByRole("link", { name: "Map", exact: true })).toHaveAttribute("href", "/map/manchester");
      await expect(elsewhere).toBeFocused();
      expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(scrollY, 0);
      if (failed) {
        await page.unroute("**/landing/london-film/london.mp4");
        await target.click();
        await expect(film.locator("video")).toBeFocused();
        await expect.poll(() => film.locator("video").evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(0);
      }
    });
  }
}

test("optional explanations stay available by keyboard", async ({ page }) => {
  await page.goto("/about");
  const press = page.locator("details").filter({ has: page.getByText("Press details and downloads", { exact: true }) });
  await expect(press).not.toHaveAttribute("open");
  await press.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(press).toHaveAttribute("open");
  await expect(press.getByRole("link", { name: "PNG (512px)" })).toBeVisible();
});

for (const width of [390, 768, 1440]) {
  for (const theme of ["light", "dark"] as const) {
    test(`Discover coverage badges have readable contrast at ${width}px in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme });
      await page.addInitScript((value) => localStorage.setItem("pubmax-theme", value), theme);
      await page.goto("/social?tab=discover");
      const coverage = page.locator(".nightAreaCoverage");
      await expect(coverage.getByText("Plan a crawl", { exact: true }).first()).toBeVisible();
      const result = await new AxeBuilder({ page })
        .include(".nightAreaCoverage")
        .withRules(["color-contrast"])
        .analyze();
      expect(result.violations).toEqual([]);
    });
  }
}


for (const width of [320, 390]) {
  for (const theme of ["light", "dark"] as const) {
    for (const scale of [1, 2]) {
      test(`navigation labels have separate space at ${width}px and ${scale * 100}% in ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 844 });
        await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
        await page.addInitScript((value) => localStorage.setItem("pubmax-theme", value), theme);
        await page.goto("/about");
        const dock = page.getByRole("navigation", { name: "Primary", exact: true });
        await expect(dock).toBeVisible();
        const baselineFont = await dock.locator(".mobileTabLabelText").first().evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
        await page.evaluate((value) => {
          document.documentElement.style.fontSize = `${value * 100}%`;
        }, scale);
        // Reduced motion keeps a near-zero font transition. Measure the
        // enlarged labels after that transition, not in its initial frame.
        await expect.poll(() => dock.locator(".mobileTabLabelText").first().evaluate(
          (element) => parseFloat(getComputedStyle(element).fontSize),
        )).toBeCloseTo(baselineFont * scale, 1);
        await page.evaluate(() => document.fonts.ready);
        const labels = await dock.locator(".mobileTabLabelText").evaluateAll((elements) => elements.map((element) => {
          const link = element.closest("a")!;
          const control = link.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(element);
          const text = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
          return {
            text: element.textContent,
            href: link.getAttribute("href"),
            name: link.getAttribute("aria-label"),
            fontSize: parseFloat(getComputedStyle(element).fontSize),
            control: { left: control.left, right: control.right, top: control.top, bottom: control.bottom, width: control.width, height: control.height },
            rects: text.map((rect) => ({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom })),
          };
        }));
        expect(labels.map((label) => label.text)).toEqual(["Map", "Tonight", "Pal", "Plan", "Social", "You"]);
        expect(labels.find((label) => label.text === "Tonight")?.href).toBe("/tonight");
        expect(labels.find((label) => label.text === "Pal")?.href).toBe("/pal");
        for (const label of labels) {
          expect(label.name).toBeTruthy();
          expect(label.fontSize).toBeCloseTo(baselineFont * scale, 1);
          expect(label.control.width).toBeGreaterThanOrEqual(44);
          expect(label.control.height).toBeGreaterThanOrEqual(44);
          expect(label.control.left).toBeGreaterThanOrEqual(0);
          expect(label.control.right).toBeLessThanOrEqual(width);
          expect(label.control.bottom).toBeLessThanOrEqual(844 - 6);
          expect(label.rects.length, label.text ?? "").toBeGreaterThan(0);
          for (const rect of label.rects) {
            expect(rect.left, label.text ?? "").toBeGreaterThanOrEqual(label.control.left - 0.5);
            expect(rect.right, label.text ?? "").toBeLessThanOrEqual(label.control.right + 0.5);
            expect(rect.top).toBeGreaterThanOrEqual(label.control.top - 0.5);
            expect(rect.bottom).toBeLessThanOrEqual(label.control.bottom + 0.5);
            for (const sibling of labels.filter((other) => other !== label)) {
              for (const other of sibling.rects) {
                const overlapX = Math.min(rect.right, other.right) - Math.max(rect.left, other.left);
                const overlapY = Math.min(rect.bottom, other.bottom) - Math.max(rect.top, other.top);
                expect(overlapX > 0.5 && overlapY > 0.5, `${label.text} overlaps ${sibling.text}`).toBe(false);
              }
            }
          }
        }
        const clearance = await page.evaluate(() => ({
          reserved: parseFloat(getComputedStyle(document.body).paddingBottom),
          height: document.querySelector(".mobileTabBar")!.getBoundingClientRect().height,
        }));
        expect(clearance.reserved).toBeGreaterThanOrEqual(clearance.height);
      });
    }
  }
}

test("Southwark page paints the credited founder photograph", async ({ page }) => {
  await page.goto("/borough/southwark");
  const photograph = page.locator(".boroughPhoto");
  await expect(photograph).toContainText("Southwark. Photo: the PUBMAXX founder");
  const image = photograph.getByRole("img", { name: "The Shard seen down a Southwark street under a mackerel sky, London" });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
  expect(await image.evaluate((element: HTMLImageElement) => element.currentSrc)).toMatch(/\/landing\/london-collage\/southwark-shard-(640|1280)\.(avif|webp)$/);
});

for (const width of [320, 390, 768, 1440]) {
  for (const theme of ["light", "dark"] as const) {
    test(`Historic filters fit at ${width}px and 200% text in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await page.addInitScript((value) => localStorage.setItem("pubmax-theme", value), theme);
      await page.goto("/historic");
      const filters = page.getByRole("region", { name: "Filter and sort historic pubs" });
      const borough = page.getByRole("combobox", { name: "Borough", exact: true });
      await expect(borough).toBeVisible();
      const baselineFont = await borough.evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
      await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
      await expect.poll(() => borough.evaluate((element) => parseFloat(getComputedStyle(element).fontSize)))
        .toBeCloseTo(baselineFont * 2, 1);
      for (const control of await filters.getByRole("combobox").all()) {
        const bounds = await control.boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
        expect(bounds!.height).toBeGreaterThanOrEqual(44);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await borough.focus();
      await expect(borough).toBeFocused();
    });
  }
}
