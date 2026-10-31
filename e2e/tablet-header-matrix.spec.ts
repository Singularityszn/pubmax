import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";

import { ACCOUNTS, installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";
import { expectLayoutSettled } from "./helpers/layoutSettled";
import { expectMapLoadingFrameReleased } from "./helpers/mobileMapShell";
import { expectMapToolbarReady } from "./helpers/mapToolbar";

// This matrix uses fixture accounts and CSS text scaling, not native/device proof.
for (const width of [641, 768, 900]) {
  for (const rootSize of [16, 32]) {
    for (const path of ["/plan", "/map"]) {
      for (const theme of ["light", "dark"] as const) {
        for (const signedIn of [true, false]) {
          test(`${path} header at ${width}px root${rootSize} ${theme} ${signedIn ? "signed in" : "signed out"}`, async ({ page }, testInfo) => {
            test.setTimeout(90_000);
            await page.setViewportSize({ width, height: 900 });
            await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
            const auth = await installAuthDoubles(page);
            await page.addInitScript((chosenTheme) => {
              localStorage.setItem("pubmax-theme", chosenTheme);
              localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
              localStorage.setItem("pubmax-tour-v1-done", "1");
              localStorage.setItem("pubmax_onboarding_dismissed", "1");
              sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
              if (location.pathname === "/map") {
                localStorage.removeItem("pubmax:map-first-visit-arrival:v1");
                localStorage.removeItem("pubmax:map-chosen-area:v1");
              }
            }, theme);
            if (signedIn) await seedSignedIn(page, "A");
            else {
              await page.goto("/today");
              await auth.signedInAs(null);
            }
            await page.goto(path);
            const nav = page.getByRole("navigation", { name: "Site navigation", exact: true });
            if (signedIn) await expect(nav.getByRole("button", { name: `Account options for ${ACCOUNTS.A.name}`, exact: true })).toBeEnabled();
            else await expect(nav.getByRole("button", { name: "Sign in", exact: true }).or(nav.getByRole("link", { name: "Sign in", exact: true }))).toBeEnabled();
            for (const [name, href] of [["Map", "/map"], ["Plan", "/plan"], ["Social", "/social"], ["You", "/u/you"], ["Pub Pal", "/pal"]] as const) {
              await expect(nav.getByRole("link", { name, exact: true })).toHaveAttribute("href", href);
            }
            await expect(nav.locator('.siteNavLinks a[href="/today"], .siteNavLinks a[href="/tonight"]')).toHaveCount(1);
            await expect(nav.getByRole("link", { name: "Activity", exact: true })).toHaveCount(signedIn ? 1 : 0);
            await expect(nav.getByRole("link", { name: "Messages", exact: true })).toHaveCount(signedIn ? 1 : 0);
            await expect(nav.getByRole("button", { name: "More pages", exact: true })).toBeVisible();
            if (path === "/map") {
              await expectMapLoadingFrameReleased(page);
              await expectMapToolbarReady(page);
            }
            await page.addStyleTag({ content: `html { font-size: ${rootSize}px !important; }` });
            await page.evaluate(() => document.fonts.ready.then(() => undefined));
            await expectLayoutSettled(nav);
            if (path === "/map") {
              await expectLayoutSettled(page.locator(".mapToolbar"));
              const arrival = page.getByRole("complementary", { name: "First visit", exact: true });
              await expect(arrival).toBeVisible();
              await expect(arrival.getByRole("heading", { name: "Cheapest pints near you?", exact: true })).toBeVisible();
              await expect(arrival.getByText("Location is used only while the map is open.", { exact: true })).toBeVisible();
              await expectLayoutSettled(arrival);
            }
            const geometry = await page.evaluate(() => {
              const rect = (element: Element) => {
                const box = element.getBoundingClientRect();
                return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
              };
              const visible = (element: Element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
              const surface = (selector: string, controlSelector: string) => {
                const owner = document.querySelector<HTMLElement>(selector);
                if (!owner || !visible(owner)) return null;
                const controls = Array.from(owner.querySelectorAll<HTMLElement>(controlSelector)).filter(visible).map((control) => {
                  const box = rect(control);
                  const labels = [];
                  const walker = document.createTreeWalker(control, NodeFilter.SHOW_TEXT);
                  while (walker.nextNode()) {
                    const text = walker.currentNode;
                    if (!text.textContent?.trim()) continue;
                    let a11yOnly = false;
                    for (let ancestor = text.parentElement; ancestor; ancestor = ancestor.parentElement) {
                      const style = getComputedStyle(ancestor);
                      const box = ancestor.getBoundingClientRect();
                      const zeroClip = style.clip.replace(/[,\s]/g, "") === "rect(0px0px0px0px)";
                      if (style.position === "absolute" && box.width <= 1 && box.height <= 1
                        && (zeroClip || style.clipPath === "inset(50%)")) a11yOnly = true;
                      if (ancestor === control) break;
                    }
                    if (a11yOnly) continue;
                    const range = document.createRange();
                    range.selectNodeContents(text);
                    const label = range.getBoundingClientRect();
                    if (label.width > 1 && label.height > 1) labels.push({ text: text.textContent.trim(), left: label.left, right: label.right, top: label.top, bottom: label.bottom });
                  }
                  return { name: control.getAttribute("aria-label") ?? control.textContent?.trim(), href: control.getAttribute("href"), ...box,
                    clientWidth: control.clientWidth, scrollWidth: control.scrollWidth, fontSize: getComputedStyle(control).fontSize, labels,
                    centreOwned: control.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)) };
                });
                const overlaps = controls.flatMap((first, index) => controls.slice(index + 1).flatMap((second) => {
                  const width = Math.min(first.right, second.right) - Math.max(first.left, second.left);
                  const height = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top);
                  return width > 0.5 && height > 0.5 ? [{ first: first.name, second: second.name, width, height }] : [];
                }));
                return { ...rect(owner), controls, overlaps };
              };
              const bannerCopy = document.querySelector(".citySuggestBannerCopy");
              const bannerLines = [];
              if (bannerCopy && visible(bannerCopy)) {
                const range = document.createRange();
                range.selectNodeContents(bannerCopy);
                for (const line of range.getClientRects()) bannerLines.push({ left: line.left, right: line.right, top: line.top, bottom: line.bottom, width: line.width, height: line.height });
              }
              const arrivalText = Array.from(document.querySelectorAll<HTMLElement>(".mapArrivalCardTitle, .mapArrivalCardLead")).filter(visible).map((copy) => {
                const clippingAncestors = [];
                for (let ancestor: HTMLElement | null = copy; ancestor; ancestor = ancestor.parentElement) {
                  const style = getComputedStyle(ancestor);
                  const box = ancestor.getBoundingClientRect();
                  const clipsX = ["hidden", "clip", "auto", "scroll"].includes(style.overflowX);
                  const clipsY = ["hidden", "clip", "auto", "scroll"].includes(style.overflowY);
                  if (clipsX || clipsY) clippingAncestors.push({ clipsX, clipsY, left: box.left + ancestor.clientLeft,
                    right: box.left + ancestor.clientLeft + ancestor.clientWidth, top: box.top + ancestor.clientTop,
                    bottom: box.top + ancestor.clientTop + ancestor.clientHeight });
                }
                const range = document.createRange();
                range.selectNodeContents(copy);
                return { className: copy.className, text: copy.textContent?.trim(), ...rect(copy), fontSize: getComputedStyle(copy).fontSize,
                  clientWidth: copy.clientWidth, scrollWidth: copy.scrollWidth, clippingAncestors,
                  lines: Array.from(range.getClientRects()).map((line) => ({ left: line.left, right: line.right, top: line.top, bottom: line.bottom, width: line.width, height: line.height })) };
              });
              const heading = Array.from(document.querySelectorAll("main h1")).find(visible);
              return { url: location.pathname + location.search, rootFontSize: getComputedStyle(document.documentElement).fontSize,
                dataTextScale: document.documentElement.getAttribute("data-text-scale"), theme: document.documentElement.getAttribute("data-theme"),
                viewportWidth: innerWidth, viewportHeight: innerHeight, clientWidth: document.documentElement.clientWidth, documentWidth: document.documentElement.scrollWidth,
                bodyClientWidth: document.body.clientWidth, bodyScrollWidth: document.body.scrollWidth,
                nav: surface('nav[aria-label="Site navigation"]', "a, button"),
                toolbar: surface(".mapToolbar", ".mapToolbarRow input, .mapToolbarRow button, .mapToolbarRow a"),
                banner: surface(".citySuggestBanner", "button, a"), bannerLines,
                arrival: surface(".mapArrivalCard", "button, a"), arrivalText,
                bannerCopy: bannerCopy && visible(bannerCopy) ? { ...rect(bannerCopy), fontSize: getComputedStyle(bannerCopy).fontSize, clientWidth: bannerCopy.clientWidth, scrollWidth: bannerCopy.scrollWidth } : null,
                contentHeading: heading ? rect(heading) : null };
            });
            const geometryPath = testInfo.outputPath("matrix-geometry.json");
            const screenshotPath = testInfo.outputPath("matrix.png");
            await writeFile(geometryPath, JSON.stringify(geometry, null, 2));
            await page.screenshot({ path: screenshotPath });
            await testInfo.attach("matrix-geometry", { path: geometryPath, contentType: "application/json" });
            await testInfo.attach("matrix", { path: screenshotPath, contentType: "image/png" });
            expect(geometry.rootFontSize).toBe(`${rootSize}px`);
            expect(geometry.documentWidth).toBeLessThanOrEqual(width);
            expect(geometry.nav).not.toBeNull();
            if (path === "/map") {
              expect(geometry.toolbar).not.toBeNull();
              expect(geometry.arrival).not.toBeNull();
              expect(geometry.arrivalText).toHaveLength(2);
              expect(geometry.toolbar?.top).toBeGreaterThanOrEqual(geometry.nav?.bottom ?? Infinity);
              if (geometry.banner) expect(geometry.banner.top).toBeGreaterThanOrEqual(geometry.toolbar?.bottom ?? Infinity);
            } else if (geometry.contentHeading) expect(geometry.contentHeading.top).toBeGreaterThanOrEqual(geometry.nav?.bottom ?? Infinity);
            if (geometry.arrival) {
              for (const copy of geometry.arrivalText) {
                expect(copy.scrollWidth, `${copy.className} whole copy`).toBeLessThanOrEqual(copy.clientWidth);
                expect(copy.lines.length, `${copy.className} rendered lines`).toBeGreaterThan(0);
                for (const line of copy.lines) {
                  expect(line.left).toBeGreaterThanOrEqual(Math.max(copy.left, geometry.arrival.left) - 0.5);
                  expect(line.right).toBeLessThanOrEqual(Math.min(copy.right, geometry.arrival.right) + 0.5);
                  expect(line.top).toBeGreaterThanOrEqual(geometry.arrival.top - 0.5);
                  expect(line.bottom).toBeLessThanOrEqual(geometry.arrival.bottom + 0.5);
                  for (const clip of copy.clippingAncestors) {
                    if (clip.clipsX) {
                      expect(line.left).toBeGreaterThanOrEqual(clip.left - 0.5);
                      expect(line.right).toBeLessThanOrEqual(clip.right + 0.5);
                    }
                    if (clip.clipsY) {
                      expect(line.top).toBeGreaterThanOrEqual(clip.top - 0.5);
                      expect(line.bottom).toBeLessThanOrEqual(clip.bottom + 0.5);
                    }
                  }
                  expect(line.left).toBeGreaterThanOrEqual(0);
                  expect(line.right).toBeLessThanOrEqual(width);
                  expect(line.bottom).toBeLessThanOrEqual(900);
                  for (const control of geometry.arrival.controls) {
                    const overlapWidth = Math.min(line.right, control.right) - Math.max(line.left, control.left);
                    const overlapHeight = Math.min(line.bottom, control.bottom) - Math.max(line.top, control.top);
                    expect(overlapWidth > 0.5 && overlapHeight > 0.5, `${copy.className} line clears ${control.name}`).toBe(false);
                  }
                }
              }
            }
            for (const owner of [geometry.nav, geometry.toolbar, geometry.banner, geometry.arrival]) {
              if (!owner) continue;
              expect(owner.overlaps).toEqual([]);
              for (const control of owner.controls) {
                expect(control.width, `${control.name} width`).toBeGreaterThanOrEqual(44);
                expect(control.height, `${control.name} height`).toBeGreaterThanOrEqual(44);
                expect(control.centreOwned, `${control.name} hit target`).toBe(true);
                expect(control.left).toBeGreaterThanOrEqual(0);
                expect(control.right).toBeLessThanOrEqual(width);
                expect(control.top).toBeGreaterThanOrEqual(0);
                expect(control.bottom).toBeLessThanOrEqual(900);
                for (const label of control.labels) {
                  expect(label.left).toBeGreaterThanOrEqual(control.left - 0.5);
                  expect(label.right).toBeLessThanOrEqual(control.right + 0.5);
                  expect(label.top).toBeGreaterThanOrEqual(control.top - 0.5);
                  expect(label.bottom).toBeLessThanOrEqual(control.bottom + 0.5);
                }
              }
            }
          });
        }
      }
    }
  }
}
