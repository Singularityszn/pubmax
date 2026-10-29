import { expect, test } from "@playwright/test";
import { installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";

for (const width of [320, 390]) {
  for (const rootSize of [16, 32]) {
    for (const native of [false, true]) {
      test(`${width}px root${rootSize} large-text dock${native ? " in native shell" : ""} keeps three labelled columns`, async ({ page }) => {
        await page.setViewportSize({ width, height: 568 });
        await page.goto("/privacy");
        const nav = page.getByRole("navigation", { name: "Primary", exact: true });
        await expect(nav).toBeVisible();
        await page.evaluate(({ rootSize, native }) => {
          document.documentElement.style.fontSize = `${rootSize}px`;
          document.documentElement.dataset.textScale = "large";
          if (native) document.documentElement.dataset.nativeShell = "ios";
        }, { rootSize, native });

        await expect.poll(() => nav.locator("ul").evaluate((list) => getComputedStyle(list).display)).toBe("grid");
        await expect.poll(() => nav.locator("ul").evaluate((list) =>
          getComputedStyle(list).gridTemplateColumns.split(" ").length,
        )).toBe(3);
        const links = nav.getByRole("link");
        await expect(links).toHaveCount(7);
        const rows = new Set<number>();
        for (const link of await links.all()) {
          const label = link.locator(".mobileTabLabel");
          await expect(label).toBeVisible();
          const geometry = await link.evaluate((element) => {
            const box = element.getBoundingClientRect();
            const label = element.querySelector<HTMLElement>(".mobileTabLabel")!;
            const text = label.getBoundingClientRect();
            const style = getComputedStyle(label);
            return {
              x: box.x, right: box.right, top: box.top, width: box.width, height: box.height,
              labelWidth: text.width, labelHeight: text.height,
              labelFits: text.left >= box.left && text.right <= box.right + 1 && label.scrollWidth <= label.clientWidth + 1,
              whiteSpace: style.whiteSpace, clipPath: style.clipPath,
            };
          });
          expect(geometry.width).toBeGreaterThanOrEqual(44);
          expect(geometry.height).toBeGreaterThanOrEqual(44);
          expect(geometry.x).toBeGreaterThanOrEqual(0);
          expect(geometry.right).toBeLessThanOrEqual(width);
          expect(geometry.labelWidth).toBeGreaterThan(1);
          expect(geometry.labelHeight).toBeGreaterThan(1);
          expect(geometry.labelFits).toBe(true);
          expect(geometry.whiteSpace).toBe("nowrap");
          expect(geometry.clipPath).toBe("none");
          rows.add(Math.round(geometry.top));
        }
        expect(rows.size).toBe(3);
        const pal = nav.locator(".palNavFace");
        const face = (await pal.boundingBox())!;
        const cell = (await nav.getByRole("link", { name: "Pub Pal", exact: true }).boundingBox())!;
        expect(face.y).toBeGreaterThanOrEqual(cell.y);
        expect(face.y + face.height).toBeLessThanOrEqual(cell.y + cell.height);
        await expect(nav.locator(".mobileTabHighlight")).toBeHidden();
        await expect.poll(() => page.evaluate(() => {
          const list = document.querySelector(".mobileTabList")!;
          return parseFloat(document.documentElement.style.getPropertyValue("--tabbar-measured-h"))
            >= Math.ceil(list.getBoundingClientRect().height + 6);
        })).toBe(true);
        const clearance = await page.evaluate(() => {
          const probe = document.body.appendChild(document.createElement("div"));
          probe.style.height = "var(--tabbar-h)";
          const reserved = probe.getBoundingClientRect().height;
          probe.remove();
          const dock = document.querySelector(".mobileTabBar")!.getBoundingClientRect();
          const list = document.querySelector(".mobileTabList")!.getBoundingClientRect();
          return {
            reserved, dockHeight: dock.height, listHeight: list.height, bottomGap: innerHeight - list.bottom,
            padding: parseFloat(getComputedStyle(document.body).paddingBottom),
            overflow: document.documentElement.scrollWidth - innerWidth,
          };
        });
        expect(clearance.reserved).toBeGreaterThanOrEqual(clearance.listHeight + 6);
        if (native) expect(clearance.reserved).toBeGreaterThanOrEqual(72);
        expect(clearance.padding).toBeGreaterThanOrEqual(clearance.dockHeight);
        expect(clearance.bottomGap).toBeGreaterThanOrEqual(6);
        expect(clearance.overflow).toBe(0);
      });
    }
  }
}

// Only this case needs classic scrollbars. Preserve the inherited launch options.
const classicScrollbarTest = test.extend({
  launchOptions: async ({ launchOptions }, provide) => {
    const ignoredDefaults = launchOptions.ignoreDefaultArgs;
    if (ignoredDefaults === true) {
      throw new Error("The 15px scrollbar case requires Chromium default arguments.");
    }
    await provide({
      ...launchOptions,
      ignoreDefaultArgs: [
        ...(Array.isArray(ignoredDefaults) ? ignoredDefaults : []),
        "--hide-scrollbars",
      ],
    });
  },
});

classicScrollbarTest("320px ordinary text keeps four columns beside a 15px scrollbar", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/privacy");
  await page.addStyleTag({ content: "html { overflow-y: scroll; scrollbar-gutter: stable; } ::-webkit-scrollbar { width: 15px; }" });
  const nav = page.getByRole("navigation", { name: "Primary", exact: true });
  await expect(nav).toBeVisible();
  expect(await page.evaluate(() => innerWidth - document.documentElement.clientWidth)).toBe(15);
  await expect.poll(() => nav.locator("ul").evaluate((list) =>
    getComputedStyle(list).gridTemplateColumns.split(" ").length,
  )).toBe(4);
  const targets = await nav.getByRole("link").evaluateAll((links) => links.map((link) => {
    const box = link.getBoundingClientRect();
    return { width: box.width, height: box.height, top: Math.round(box.top), right: box.right };
  }));
  expect(new Set(targets.map((target) => target.top)).size).toBe(2);
  for (const target of targets) {
    expect(target.width).toBeGreaterThanOrEqual(44);
    expect(target.height).toBeGreaterThanOrEqual(44);
    expect(target.right).toBeLessThanOrEqual(305);
  }
});

for (const width of [320, 390]) {
  test(`${width}px doubled root keeps three columns without explicit large-text mode`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/privacy");
    const nav = page.getByRole("navigation", { name: "Primary", exact: true });
    await expect(nav).toBeVisible();
    await page.evaluate(() => { document.documentElement.style.fontSize = "32px"; });
    await expect.poll(() => nav.locator("ul").evaluate((list) =>
      getComputedStyle(list).gridTemplateColumns.split(" ").length,
    )).toBe(3);
    for (const label of await nav.locator(".mobileTabLabel").all()) await expect(label).toBeVisible();
  });
}

for (const width of [320, 390, 641, 768, 900, 1440]) {
  test(`${width}px Spoons navigation opens searchable recorded costs`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/privacy");

    const nav = page.getByRole("navigation", { name: width <= 640 ? "Primary" : "Site navigation" });
    const spoons = nav.getByRole("link", { name: "Spoons", exact: true });
    await expect(spoons).toBeVisible();
    const covered = await nav.locator(width <= 640 ? "a" : ".siteNavLink").evaluateAll((links) =>
      links.filter((link) => {
        const box = link.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return !hit || !link.contains(hit);
      }).map((link) => link.textContent),
    );
    expect(covered).toEqual([]);
    const box = (await spoons.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    await expect(async () => {
      await spoons.click();
      await expect(page.getByRole("searchbox", { name: "Find a Spoons" })).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/spoons-value$/);
    await expect(nav.getByRole("link", { name: "Spoons", exact: true })).toHaveAttribute("aria-current", "page");

    const search = page.getByRole("searchbox", { name: "Find a Spoons" });
    await search.fill("Teignmouth");
    const rows = page.locator(".spoonsTable tbody tr");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("The Jolie Brise");
    await expect(rows.first()).toContainText("£9.96");
    await rows.first().locator("summary").click();
    await expect(rows.first()).toContainText("£8.97 total");
    await expect(rows.first()).toContainText("£0.99 total");
    await expect(rows.first()).toContainText("Source read 2026-08-30");
    await page.screenshot({ path: testInfo.outputPath(`spoons-costs-${width}.png`) });

    await search.fill("no-such-pub-for-this-search");
    await expect(page.getByText("No pubs match this search.")).toBeVisible();
    await page.getByRole("button", { name: "Show all pubs" }).click();
    await expect(rows).toHaveCount(805);
    await expect(search).toHaveValue("");
    await page.mouse.move(width / 2, 450);
    await page.mouse.wheel(0, 600);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
    expect(errors).toEqual([]);
  });
}

for (const width of [641, 768, 900]) {
  test(`${width}px signed-in navigation keeps every destination reachable`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await installAuthDoubles(page);
    await seedSignedIn(page, "A");
    await page.goto("/spoons-value");
    await expect(page.locator(".siteNavLinks .siteNavLink")).toHaveCount(6);
    const actions = page.locator(".siteNavActions");
    await expect(actions.getByRole("link", { name: "Activity", exact: true })).toBeVisible();
    await expect(actions.getByRole("link", { name: "Activity", exact: true })).toHaveAttribute("href", "/activity");
    await expect(actions.getByRole("link", { name: "Messages", exact: true })).toBeVisible();
    await expect(actions.getByRole("link", { name: "Messages", exact: true })).toHaveAttribute("href", "/messages");
    const blocked = await page.locator(".siteNavLinks .siteNavLink, .siteNavActions .siteNavBell").evaluateAll((links) =>
      links.filter((link) => {
        const box = link.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return !hit || !link.contains(hit) || link.scrollWidth > link.clientWidth + 1;
      }).map((link) => link.textContent),
    );
    expect(blocked).toEqual([]);
  });
}

test.describe("short phone Drink sheet", () => {
  test.use({ isMobile: true, hasTouch: true });
  test("touch scrolling reaches lower content without moving the map shell", async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto("/map?drink=soft-drink");
    const open = page.getByRole("button", { name: /Drink shown on the map/ });
    const sheet = page.locator('.mobileSheetPortal[data-sheet-kind="drink"]');
    await expect(async () => {
      await open.click();
      await expect(sheet).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 30_000 });
    await sheet.getByRole("button", { name: "Spoons value", exact: true }).click();
    await expect(sheet.locator(".spoonsValueLensLegend")).toBeVisible();
    const body = sheet.locator(".mobileSharedSheetBody");
    await expect.poll(() => body.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeGreaterThan(0);
    const box = (await body.boundingBox())!;
    const cdp = await context.newCDPSession(page);
    const x = box.x + box.width / 2;
    const start = box.y + box.height * 0.8;
    const travel = box.height * 0.6;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: start }] });
    for (let step = 1; step <= 12; step += 1) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: start - travel * step / 12 }] });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await page.screenshot({ path: testInfo.outputPath("drink-touch-scroll-320.png") });
    await cdp.detach();
  });
});

for (const width of [390, 1440]) {
  test(`${width}px Drink exposes Lucia and opens the existing price list`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/map?drink=soft-drink");
    const open = width <= 640
      ? page.getByRole("button", { name: /Drink shown on the map/ })
      : page.locator(".mapToolbarDrinkLaneBtn").first();
    const lucia = page.getByRole("link", { name: /Lucia 🐐/ });
    await expect(async () => {
      await open.click();
      await expect(lucia).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 30_000 });
    if (width <= 640) {
      await expect(page.locator(".mobileSharedSheet")).toHaveClass(/sheet-full/);
    }
    await page.screenshot({ path: testInfo.outputPath(`lucia-drink-${width}.png`) });
    await lucia.click();
    await expect(page).toHaveURL(/\/soft-drinks-and-water\?sub=soft-drink-lucia-special$/);
    await expect(page.getByRole("tab", { name: "Lucia 🐐", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("link", { name: "Open the map", exact: true })).toHaveAttribute(
      "href", "/map?drink=soft-drink&sub=soft-drink-lucia-special",
    );
  });
}
