import { expect, test } from "@playwright/test";

import { NATIVE_FIRST_RUN_HANDOFF_KEY } from "@/lib/nativeFirstRun";

import { installNativeShell } from "./helpers/nativeShell";
import { ACCOUNTS, installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";

const CORE_ROUTES = [
  "/tonight", "/places", "/out", "/plan", "/u/qa_android",
  "/map", "/near", "/wall", "/pal/chat", "/moment",
] as const;

test.use({
  serviceWorkers: "block", isMobile: true, hasTouch: true,
  launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
});
test.setTimeout(90_000);
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v2-done", "1");
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
    sessionStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
  });
});

for (const scale of [1.3, 1.5, 2]) {
  test(`Android ${scale}x native text zoom keeps map figures inside their badges`, async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 840 });
    await installNativeShell(page, "android");
    await page.route("**/api/citymcp/status", (route) => route.fulfill({
      json: { signals: [{ headline: "Transport update", kind: "transport" }] },
    }));
    const observedAt = new Date().toISOString();
    await page.route("**/api/whats-on**", (route) => route.fulfill({
      json: {
        rows: [{
          id: "large-text-quiz", venueId: "venue-xjf3n0", placeName: "The Arnos Arms",
          kind: "quiz", title: "Pub quiz", startsAt: new Date(Date.now() + 3_600_000).toISOString(),
          source: { label: "Question One", url: "https://questionone.com/" },
          observedAt, confidence: "listed",
        }],
        asOf: observedAt, sourceObservedAt: observedAt, sourceFreshnessKind: "dataset-generated",
      },
    }));
    await page.goto("/map");
    await expect(page.locator("html")).toHaveAttribute("data-native-shell", "android");
    const badges = page.locator(".mobileMapTonightChipCount, .mobileMapTflButton .mobileMapCornerBadge");
    await expect(badges).toHaveCount(2);
    for (const badge of await badges.all()) await expect(badge).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const geometry = await badges.evaluateAll((elements, fontScale) => elements.map((element) => {
      const badge = element as HTMLElement;
      const style = getComputedStyle(badge);
      // Chromium has no WebView text zoom. Enlarge text alone, leaving rem
      // geometry unchanged, as Android does with the system font setting.
      badge.style.fontSize = `${parseFloat(style.fontSize) * fontScale}px`;
      if (style.lineHeight !== "normal") {
        badge.style.lineHeight = `${parseFloat(style.lineHeight) * fontScale}px`;
      }
      const range = document.createRange();
      range.selectNodeContents(badge);
      const box = badge.getBoundingClientRect();
      const text = range.getBoundingClientRect();
      return {
        label: badge.className, font: parseFloat(getComputedStyle(badge).fontSize),
        top: box.top, bottom: box.bottom, left: box.left, right: box.right,
        textTop: text.top, textBottom: text.bottom, textLeft: text.left, textRight: text.right,
      };
    }), scale);
    for (const box of geometry) {
      expect(box.font, box.label).toBeCloseTo(12 * scale);
      expect(box.textTop, box.label).toBeGreaterThanOrEqual(box.top - 1);
      expect(box.textBottom, box.label).toBeLessThanOrEqual(box.bottom + 1);
      expect(box.textLeft, box.label).toBeGreaterThanOrEqual(box.left - 1);
      expect(box.textRight, box.label).toBeLessThanOrEqual(box.right + 1);
    }
  });

  for (const route of CORE_ROUTES) {
    test(`Android ${scale}x text keeps ${route} inside the phone`, async ({ page }) => {
      await page.setViewportSize({ width: 412, height: 840 });
      await installNativeShell(page, "android");
      await page.addInitScript((fontScale) => {
        document.documentElement.style.fontSize = `${fontScale * 100}%`;
        document.documentElement.setAttribute("data-text-scale", "large");
        localStorage.setItem("pubmax-tour-v2-done", "1");
        localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
        localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
        sessionStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
      }, scale);
      await page.goto(route);
      await expect(page.locator("html")).toHaveAttribute("data-native-shell", "android");
      await expect(page.locator(".mobileTabBar")).toBeVisible();
      if (route === "/map") {
        await expect(page.locator(".mobileMapTopbar")).toBeVisible({ timeout: 60_000 });
      }
      await page.evaluate((fontScale) => {
        document.documentElement.style.fontSize = `${fontScale * 100}%`;
        document.documentElement.setAttribute("data-text-scale", "large");
      }, scale);
      await page.evaluate(() => document.fonts.ready);
      const geometry = await page.evaluate(() => ({
        font: parseFloat(getComputedStyle(document.documentElement).fontSize),
        viewport: innerWidth,
        document: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
      }));
      expect(geometry.font).toBeCloseTo(16 * scale);
      expect(geometry.viewport).toBe(412);
      expect(geometry.document, `document width on ${route}`).toBeLessThanOrEqual(413);
      expect(geometry.body, `body width on ${route}`).toBeLessThanOrEqual(413);
    });
  }
}

for (const scale of [1.3, 1.5, 2]) {
  test(`Android ${scale}x text keeps day words and the photo size whole`, async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 840 });
    await installNativeShell(page, "android");
    await page.addInitScript((fontScale) => {
      document.documentElement.style.fontSize = `${fontScale * 100}%`;
      document.documentElement.setAttribute("data-text-scale", "large");
    }, scale);
    const applyScale = async () => {
      await page.evaluate((fontScale) => {
        document.documentElement.style.fontSize = `${fontScale * 100}%`;
        document.documentElement.setAttribute("data-text-scale", "large");
      }, scale);
      await page.evaluate(() => document.fonts.ready);
    };
    await page.goto("/out");
    await expect(page.locator(".outDayChip")).toHaveCount(3);
    await applyScale();
    const chips = await page.locator(".outDayChip").evaluateAll((elements) => elements.map((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const lines = new Set([...range.getClientRects()].map((box) => Math.round(box.top))).size;
      return { text: element.textContent, lines };
    }));
    for (const chip of chips) expect(chip, chip.text ?? "").toMatchObject({ lines: 1 });

    await page.goto("/moment");
    const hint = page.locator(".momentMediaPickerLine").filter({ hasText: "MB" });
    await expect(hint).toHaveCount(1);
    await applyScale();
    const figure = await hint.evaluate((element) => {
      const lineCount = (range: Range) => new Set([...range.getClientRects()].map((box) => Math.round(box.top))).size;
      const whole = document.createRange();
      whole.selectNodeContents(element);
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const match = /\d+(?:\.\d)?\s*MB/.exec(node.textContent ?? "");
        if (!match) continue;
        const range = document.createRange();
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        return { text: match[0], lines: lineCount(range), hintLines: lineCount(whole) };
      }
      return null;
    });
    expect(figure).toMatchObject({ text: "4\u00a0MB", lines: 1 });
    if (scale === 2) expect(figure!.hintLines).toBeGreaterThan(1);
  });
}

for (const platform of ["android", "ios"] as const) {
  for (const scale of [1.3, 1.5, 2]) {
    test(`${platform} signed-out header icons scale together at ${scale}x text`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: platform === "android" ? 412 : 390, height: 844 });
      await installNativeShell(page, platform);
      await installAuthDoubles(page);
      await page.goto("/places");
      await expect(page.locator("html")).toHaveAttribute("data-native-shell", platform);
      const header = page.locator(".siteNavBar");
      await expect(header.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
      await expect(header.locator('[data-auth-resolved="true"]')).toBeVisible();
      await page.evaluate((fontScale) => {
        document.documentElement.style.fontSize = `${fontScale * 100}%`;
        document.documentElement.setAttribute("data-text-scale", "large");
      }, scale);
      await page.evaluate(() => document.fonts.ready);
      const screenshot = testInfo.outputPath("signed-out-header.png");
      await header.screenshot({ path: screenshot });
      await testInfo.attach("signed-out header", { path: screenshot, contentType: "image/png" });
      const icons = header.locator(".siteNavBell svg:visible, .themeToggle svg:visible, .authCompactTrigger svg:visible");
      await expect(icons).toHaveCount(4);
      for (const size of await icons.evaluateAll((elements) => elements.map((element) => {
        const box = element.getBoundingClientRect();
        return { width: box.width, height: box.height };
      }))) {
        expect(size.width).toBeCloseTo(20 * scale);
        expect(size.height).toBeCloseTo(20 * scale);
      }
    });
  }

  for (const scale of [1.3, 1.5, 2]) {
    test(`${platform} owner profile reflows at ${scale}x text`, async ({ page }) => {
      const width = platform === "android" ? 412 : 390;
      await page.setViewportSize({ width, height: 844 });
      await installNativeShell(page, platform);
      await page.addInitScript(() => {
        document.documentElement.style.fontSize = "200%";
        document.documentElement.setAttribute("data-text-scale", "large");
        localStorage.setItem("pubmax-tour-v2-done", "1");
        localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
      });
      await installAuthDoubles(page);
      await seedSignedIn(page, "A");
      await page.goto(`/u/${ACCOUNTS.A.handle}`);
      await expect(page.locator(".youProfileIdentity")).toBeVisible();
      await page.evaluate((fontScale) => {
        document.documentElement.style.fontSize = `${fontScale * 100}%`;
        document.documentElement.setAttribute("data-text-scale", "large");
      }, scale);
      await page.evaluate(() => document.fonts.ready);
      const geometry = await page.evaluate(() => ({
        viewport: innerWidth,
        document: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
        actions: [...document.querySelectorAll(".youProfileIdentity .profileActions > *")]
          .map((element) => {
            const box = element.getBoundingClientRect();
            return { left: box.left, right: box.right, width: box.width, height: box.height };
          }),
        stats: [...document.querySelectorAll(".youProfileIdentity .profileStat")]
          .map((element) => element.getBoundingClientRect().right),
      }));
      expect(geometry.viewport).toBe(width);
      expect(geometry.document).toBeLessThanOrEqual(width + 1);
      expect(geometry.body).toBeLessThanOrEqual(width + 1);
      expect(geometry.actions).toHaveLength(3);
      for (const box of geometry.actions) {
        expect(box.left).toBeGreaterThanOrEqual(0);
        expect(box.right).toBeLessThanOrEqual(width + 1);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
      for (const right of geometry.stats) expect(right).toBeLessThanOrEqual(width + 1);
    });
  }
}

test("Android chrome and checkbox labels have 48px touch targets", async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 840 });
  await installNativeShell(page, "android");
  await installAuthDoubles(page);
  await seedSignedIn(page, "A");
  await page.goto("/places");
  await expect(page.locator("html")).toHaveAttribute("data-native-shell", "android");
  const controls = page.locator(".siteNavBar .siteNavBell:visible, .siteNavBar .themeToggle:visible, .siteNavBar .authCompactTrigger:visible, .mobileTabBar .mobileTab:visible");
  await expect(controls).toHaveCount(10);
  for (const box of await controls.evaluateAll((elements) => elements.map((element) => {
    const box = element.getBoundingClientRect();
    return { width: box.width, height: box.height };
  }))) {
    expect(box.width).toBeGreaterThanOrEqual(48);
    expect(box.height).toBeGreaterThanOrEqual(48);
  }
  await page.goto("/map");
  const filters = page.locator(".mobileMapTopbar").getByRole("button", { name: /^Filters/ });
  await expect(filters).toBeVisible({ timeout: 60_000 });
  await expect(async () => {
    const box = await filters.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(48);
    expect(box!.height).toBeGreaterThanOrEqual(48);
    await page.touchscreen.tap(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await expect(page.locator(".mobileMapSavedOnly label")).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  const saved = page.locator(".mobileMapSavedOnly label");
  const box = await saved.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(48);
  await saved.click();
  await expect(saved.locator("input")).toBeChecked();

  await page.goto("/pal");
  await expect(async () => {
    await page.getByRole("button", { name: "Meet your Pub Pal" }).click();
    await expect(page.getByRole("checkbox", { name: /^I confirm I'm 18 or over/ })).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  const adult = page.locator(".palToggleRow").filter({ hasText: "I confirm" });
  const adultBox = await adult.boundingBox();
  expect(adultBox!.width).toBeGreaterThanOrEqual(48);
  expect(adultBox!.height).toBeGreaterThanOrEqual(48);
  await adult.click();
  await expect(adult.locator("input")).toBeChecked();
});

for (const route of ["/map", "/pubs", "/discover", "/pint-index", "/onboarding"]) {
  test(`Android readable small text on ${route}`, async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 840 });
    await installNativeShell(page, "android");
    if (route === "/onboarding") {
      await page.addInitScript((key) => {
        sessionStorage.setItem(key, String(Date.now()));
      }, NATIVE_FIRST_RUN_HANDOFF_KEY);
    }
    await page.goto(route);
    await expect(page.locator("html")).toHaveAttribute("data-native-shell", "android");
    if (route === "/discover") {
      await expect(page).toHaveURL(/\/social\?tab=discover$/);
    } else {
      await expect(page).toHaveURL(new RegExp(`${route}$`));
    }
    if (route === "/onboarding") {
      await expect(page.getByRole("heading", { name: "London is ready." })).toBeVisible();
    }
    if (route === "/map") {
      await expect(page.locator(".mobileMapTopbar")).toBeVisible({ timeout: 60_000 });
    }
    await page.evaluate(() => document.fonts.ready);
    const unreadable = await page.evaluate(() => [...document.querySelectorAll("body *")]
      .filter((element) => {
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return box.width > 0 && box.height > 0 && style.visibility !== "hidden" &&
          [...element.childNodes].some((node) => node.nodeType === 3 && node.textContent?.trim()) &&
          parseFloat(style.fontSize) < 11;
      })
      .map((element) => ({ class: element.className.toString(), text: element.textContent?.slice(0, 50), font: getComputedStyle(element).fontSize })));
    expect(unreadable).toEqual([]);
  });
}
