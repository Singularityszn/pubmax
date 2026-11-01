import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";

import { ACCOUNTS, installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";
import { expectLayoutSettled } from "./helpers/layoutSettled";
import { expectMapLoadingFrameReleased } from "./helpers/mobileMapShell";

// These are fixture sessions, not live authentication or physical-device proof.
const path = "/map";
{
  test(`signed-in floating tablet header remains readable at 641px with root32`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 641, height: 900 });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await installAuthDoubles(page);
    await page.addInitScript(() => {
      localStorage.setItem("pubmax-theme", "light");
      localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
      localStorage.setItem("pubmax-tour-v1-done", "1");
      localStorage.setItem("pubmax_onboarding_dismissed", "1");
      sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });
    await seedSignedIn(page, "A");
    await page.goto(path);
    if (path === "/map") await expectMapLoadingFrameReleased(page);
    const nav = page.getByRole("navigation", { name: "Site navigation", exact: true });
    await expect(nav.getByRole("button", { name: `Account options for ${ACCOUNTS.A.name}`, exact: true })).toBeEnabled();
    // The desktop SiteNav uses navigationModel's literal /u/you.
    // The account-resolved mobile/profile link is a different public control.
    for (const [name, href] of [["Explore", "/map"], ["Plan", "/plan"], ["Spoons", "/spoons-value"], ["Social", "/social"], ["You", "/u/you"], ["Pub Pal", "/pal"]] as const) {
      const link = nav.getByRole("link", { name, exact: true });
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute("href", href);
    }
    await expect(nav.locator('.siteNavLinks a[href="/today"], .siteNavLinks a[href="/tonight"]')).toHaveCount(1);
    await expect(nav.getByRole("link", { name: "Activity", exact: true })).toHaveAttribute("href", "/activity");
    await expect(nav.getByRole("link", { name: "Messages", exact: true })).toHaveAttribute("href", "/messages");
    await expect(nav.getByRole("button", { name: "More pages", exact: true })).toBeVisible();
    await page.addStyleTag({ content: "html { font-size: 32px !important; }" });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await expectLayoutSettled(nav);
    const geometry = await nav.evaluate((element) => {
      const controls = Array.from(element.querySelectorAll<HTMLElement>("a, button"))
        .filter((control) => control.getClientRects().length > 0 && getComputedStyle(control).visibility !== "hidden")
        .map((control) => {
          const box = control.getBoundingClientRect();
          return { name: control.getAttribute("aria-label") ?? control.textContent?.trim(),
            left: box.left, right: box.right, top: box.top, bottom: box.bottom,
            width: box.width, height: box.height, fontSize: getComputedStyle(control).fontSize,
            centreOwned: control.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)) };
        });
      const overlaps = controls.flatMap((first, index) => controls.slice(index + 1).flatMap((second) => {
        const width = Math.min(first.right, second.right) - Math.max(first.left, second.left);
        const height = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top);
        return width > 0.5 && height > 0.5 ? [{ first: first.name, second: second.name, width, height }] : [];
      }));
      const labels = Array.from(element.querySelectorAll<HTMLElement>(".siteNavLinks a")).map((link) => {
        const box = link.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(link);
        const text = range.getBoundingClientRect();
        return { name: link.getAttribute("aria-label"), text: link.textContent?.trim(),
          fontSize: getComputedStyle(link).fontSize, clientWidth: link.clientWidth, scrollWidth: link.scrollWidth,
          box: { left: box.left, right: box.right, top: box.top, bottom: box.bottom },
          label: { left: text.left, right: text.right, top: text.top, bottom: text.bottom, width: text.width, height: text.height } };
      });
      const undersized = controls.filter((control) => control.width < 44 || control.height < 44);
      return { controls, labels, overlaps, undersized, dataTextScale: document.documentElement.getAttribute("data-text-scale"),
        clientWidth: document.documentElement.clientWidth, bodyClientWidth: document.body.clientWidth, bodyScrollWidth: document.body.scrollWidth,
        viewportHeight: innerHeight, rootFontSize: getComputedStyle(document.documentElement).fontSize,
        documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth };
    });
    const geometryPath = testInfo.outputPath("header-geometry.json");
    const screenshotPath = testInfo.outputPath("header.png");
    await writeFile(geometryPath, JSON.stringify(geometry, null, 2));
    await page.screenshot({ path: screenshotPath });
    await testInfo.attach("header-geometry", { path: geometryPath, contentType: "application/json" });
    await testInfo.attach("header", { path: screenshotPath, contentType: "image/png" });
    expect(geometry.rootFontSize).toBe("32px");
    expect(geometry.labels.map((label) => label.name)).toEqual(["Explore", "Tonight", "Plan", "Spoons", "Social", "You"]);
    for (const label of geometry.labels) {
      expect(label.label.width, `${label.name} visible label`).toBeGreaterThan(0);
      expect(label.scrollWidth, `${label.name} whole label`).toBeLessThanOrEqual(label.clientWidth);
      expect(label.label.left, `${label.name} label left`).toBeGreaterThanOrEqual(label.box.left - 0.5);
      expect(label.label.right, `${label.name} label right`).toBeLessThanOrEqual(label.box.right + 0.5);
      expect(label.label.top, `${label.name} label top`).toBeGreaterThanOrEqual(label.box.top - 0.5);
      expect(label.label.bottom, `${label.name} label bottom`).toBeLessThanOrEqual(label.box.bottom + 0.5);
    }
    expect(geometry.overlaps).toEqual([]);
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
    for (const control of geometry.controls) {
      expect(control.width, `${control.name} width`).toBeGreaterThanOrEqual(44);
      expect(control.height, `${control.name} height`).toBeGreaterThanOrEqual(44);
      expect(control.left, `${control.name} left`).toBeGreaterThanOrEqual(0);
      expect(control.right, `${control.name} right`).toBeLessThanOrEqual(geometry.viewportWidth);
      expect(control.top, `${control.name} top`).toBeGreaterThanOrEqual(0);
      expect(control.bottom, `${control.name} bottom`).toBeLessThanOrEqual(geometry.viewportHeight);
      expect(control.centreOwned, `${control.name} hit target`).toBe(true);
    }
  });
}
