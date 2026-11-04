import { expect, test } from "@playwright/test";

import { installNativeShell } from "@/e2e/helpers/nativeShell";

// Chromium models iOS typography with a fixed root and Android with a larger
// root. Native text scaling and WebView painting require separate native proof.
test.use({
  viewport: { width: 390, height: 844 },
  serviceWorkers: "block",
  isMobile: true,
  hasTouch: true,
  launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
});
test.setTimeout(90_000);

for (const platform of ["ios", "android"] as const) {
  for (const theme of ["light", "dark"] as const) {
    for (const state of ["active", "picked"] as const) {
      test(`${platform} text layout model contains the ${state} plan in ${theme}`, async ({ page, request }, testInfo) => {
        await installNativeShell(page, platform);
        await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
        const response = await request.get("/data/venues_slim.json");
        expect(response.ok()).toBe(true);
        const { rows } = await response.json() as { rows: Array<{ id: string; name: string }> };
        const venues = rows.slice(0, 3);
        const id = "00000000-0000-4000-8000-000000000085";
        const startTime = new Date().toISOString();
        await page.route(`**/api/plans/${id}`, (route) => route.fulfill({
          json: {
            plan: { id, startTime, title: "Geometry proof" },
            stops: venues.map((venue, order) => ({
              id: `stop-${order}`, venueId: venue.id, venueName: venue.name, order,
            })),
            members: [],
          },
        }));
        await page.addInitScript(({ theme, state, id, startTime }) => {
          localStorage.setItem("pubmax-theme", theme);
          localStorage.setItem("pubmax-tour-v1-done", "1");
          localStorage.setItem("pubmax-tour-v2-done", "1");
          localStorage.setItem("pubmax_onboarding_dismissed", "1");
          sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
          localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
          localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
          localStorage.setItem("pubmax:e2e-defer-shell:v1", "now");
          if (state === "active") {
            localStorage.setItem("pubmax_active_plan", JSON.stringify({
              version: 1, id, startTime, stopIndex: 0, role: "host",
              endingPreview: null, palContext: null,
            }));
          }
        }, { theme, state, id, startTime });
        await page.goto(state === "picked" ? `/map?mode=build&pubs=${venues[0]!.id}` : "/map");
        const card = page.locator(".mapPeek");
        const door = card.locator(".mobilePlanActivation.isActive");
        await expect(card).toHaveAttribute("data-state", "answer", { timeout: 60_000 });
        await expect(door.locator("strong")).toHaveText(state === "active" ? "3-stop plan" : "1 stop picked");
        await expect(door.locator("small")).toHaveText(state === "active" ? "Edit route" : "Add stops");
        await page.evaluate(() => document.fonts.ready);
        await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });

        for (const width of [320, 390]) {
          await page.setViewportSize({ width, height: 844 });
          for (const scale of [1, 1.3, 1.5, 2]) {
            const geometry = await card.evaluate(async (node, { scale, platform }) => {
              const root = document.documentElement;
              root.setAttribute("data-text-scale", scale >= 1.3 ? "large" : "");
              root.style.fontSize = platform === "android" ? `${scale * 100}%` : "100%";
              if (platform === "ios") root.style.setProperty("--native-text-layout-scale", String(scale));
              else root.style.removeProperty("--native-text-layout-scale");
              const elements = [node as HTMLElement, ...node.querySelectorAll<HTMLElement>("*")];
              for (const element of elements) {
                element.style.removeProperty("font-size");
                element.style.removeProperty("line-height");
              }
              const typography = elements.map((element) => {
                const style = getComputedStyle(element);
                return {
                  element,
                  font: parseFloat(style.fontSize) * (platform === "ios" ? scale : 1),
                  line: style.lineHeight === "normal" ? null : parseFloat(style.lineHeight) * (platform === "ios" ? scale : 1),
                };
              });
              for (const { element, font, line } of typography) {
                element.style.fontSize = `${font}px`;
                if (line !== null) element.style.lineHeight = `${line}px`;
              }
              await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
              const rect = (element: Element | Range) => {
                const box = element.getBoundingClientRect();
                return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, height: box.height };
              };
              const door = node.querySelector<HTMLElement>(".mobilePlanActivation")!;
              const labels = document.createRange();
              labels.selectNodeContents(door.querySelector("span")!);
              const control = (selector: string) => {
                const element = document.querySelector(selector);
                return element ? rect(element) : null;
              };
              return {
                rootFont: parseFloat(getComputedStyle(root).fontSize),
                card: rect(node),
                row: rect(node.querySelector(".mapPeekRow")!),
                door: rect(door),
                labels: rect(labels),
                price: rect(node.querySelector(".mapPeekPrice")!),
                name: rect(node.querySelector(".mapPeekName")!),
                near: control(".mobileMapLocateFab"),
                palDoor: control(".mobileMapPalDoor"),
                credit: control(".maplibregl-ctrl-attrib"),
                pal: control(".palSummon"),
                doorHit: door.contains(document.elementFromPoint(
                  (rect(door).left + rect(door).right) / 2,
                  (rect(door).top + rect(door).bottom) / 2,
                )),
              };
            }, { scale, platform });
            expect(geometry.rootFont).toBe(16 * (platform === "android" ? scale : 1));
            expect(geometry.labels.top).toBeGreaterThanOrEqual(geometry.door.top);
            expect(geometry.labels.bottom).toBeLessThanOrEqual(geometry.door.bottom);
            expect(geometry.labels.left).toBeGreaterThanOrEqual(geometry.door.left);
            expect(geometry.labels.right).toBeLessThanOrEqual(geometry.door.right);
            expect(geometry.row.top).toBeGreaterThan(geometry.card.top);
            expect(geometry.door.top - geometry.row.bottom).toBeGreaterThanOrEqual(4);
            expect(geometry.door.bottom).toBeLessThan(geometry.card.bottom);
            expect(geometry.price.bottom).toBeLessThanOrEqual(geometry.door.top);
            expect(geometry.name.bottom).toBeLessThanOrEqual(geometry.door.top);
            expect(geometry.door.height).toBeGreaterThanOrEqual(48);
            expect(geometry.doorHit).toBe(true);
            for (const control of [geometry.near, geometry.palDoor, geometry.credit, geometry.pal]) {
              if (control) expect(control.bottom).toBeLessThanOrEqual(geometry.card.top);
            }
            if (scale === 1) expect(geometry.card.height).toBe(112);
            if (scale === 2) {
              const name = `${platform}-${theme}-${state}-${width}-2x`;
              await testInfo.attach(`${name}-geometry`, {body: JSON.stringify(geometry), contentType: "application/json"});
              await testInfo.attach(name, {body: await page.screenshot(), contentType: "image/png"});
            }
          }
        }
        const restingHeight = await card.evaluate((node) => node.getBoundingClientRect().height);
        await door.click();
        const planner = page.locator('.mobileSheetPortal[data-sheet-kind="planner"]');
        await expect(planner).toBeVisible();
        await expect(card).toBeHidden();
        await expect(page.locator(".mobilePlanActivation")).toHaveCount(0);
        expect(await card.evaluate((node) => node.getBoundingClientRect().height)).toBe(restingHeight);
        await planner.locator(".surfaceNavHome").click();
        await expect(card).toBeVisible();
        expect(await card.evaluate((node) => node.getBoundingClientRect().height)).toBe(restingHeight);
        await card.getByRole("button", { name: "Show the pubs in this view as a list" }).click();
        const list = page.locator(".mapVenueList--open");
        await expect(list).toHaveCount(1);
        await expect(list).toBeVisible();
        await expect(page.locator(".mobilePlanActivation")).toHaveCount(0);
        expect(await card.evaluate((node) => node.getBoundingClientRect().height)).toBe(restingHeight);
        await list.locator(".surfaceNavHome").click();
        await expect(list).toHaveCount(0);
        await expect(door).toBeVisible();
        expect(await card.evaluate((node) => node.getBoundingClientRect().height)).toBe(restingHeight);
      });
    }
  }
}
