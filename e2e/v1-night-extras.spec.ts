import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { storeThemeChoice } from "./helpers/themeClock";

const stops = [
  { venueId: "venue-xjf3n0", venueName: "Arnos Arms" },
  { venueId: "venue-1f5ygjb", venueName: "The Bohemia" },
  { venueId: "venue-3h52h", venueName: "The Elephant Inn" },
];

test.describe("Night mode readability", () => {
  test.use({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  for (const theme of ["light", "dark"] as const) {
    test(`table details and clues remain readable in ${theme} theme`, async ({ page }, testInfo) => {
      await storeThemeChoice(page, theme);
      const created = await page.request.post("/api/plans", {
        headers: { "idempotency-key": randomUUID() },
        data: { title: "Night readability", creatorName: "Host", startTime: new Date(Date.now() + 3_600_000).toISOString(), stops },
      });
      expect(created.status()).toBe(201);
      const host = await created.json();
      const id = host.plan.plan.id;
      const arrival = await page.request.post(`/api/plans/${id}/actions`, {
        headers: { "idempotency-key": randomUUID(), authorization: `Bearer ${host.memberToken}` },
        data: { type: "arrived", stopPosition: 0, expectedRouteRevision: host.plan.plan.routeRevision, venueId: stops[0].venueId },
      });
      expect(arrival.status()).toBe(201);
      await page.goto(`/plan/${id}`);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      const night = page.getByRole("dialog", { name: "Night mode", exact: true });
      await expect(night).toBeVisible();
      const beacon = night.getByRole("region", { name: "Find our table", exact: true });
      await beacon.getByLabel("Where to find you").fill("Upstairs beside the window");
      await beacon.getByRole("button", { name: "Set table sign", exact: true }).click();
      await expect(beacon.locator(".tableBeacon__sign")).toContainText("Upstairs beside the window");
      await beacon.getByRole("heading", { name: "Find our table" }).scrollIntoViewIfNeeded();
      const tableShot = testInfo.outputPath(`night-table-${theme}.png`);
      await page.screenshot({ path: tableShot });
      await testInfo.attach(`night-table-${theme}`, { path: tableShot, contentType: "image/png" });
      await night.locator("summary").filter({ hasText: "Clues and mystery stops" }).click();
      await expect(night.getByRole("heading", { name: "London clue hunt" })).toBeVisible();

      // WCAG AA requires 4.5:1 for normal text. A light-page palette on the
      // fixed dark Night surface must fail even when every control still works.
      const contrasts = await night.evaluate((root) => {
        const luminance = (colour: string) => {
          const channels = colour.match(/[\d.]+/g)!.slice(0, 3).map((value) => {
            const channel = Number(value) / 255;
            return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
        };
        return [".tableBeacon h3", ".tableBeacon__sign p", ".tableBeacon__privacy", ".tableBeacon__links a", ".tableBeacon textarea", ".tableBeacon button", ".planClues h3", ".planClues > p", ".planClues button"].flatMap((selector) =>
          Array.from(root.querySelectorAll(selector)).map((element) => {
            let surface: Element | null = element;
            while (surface && getComputedStyle(surface).backgroundColor === "rgba(0, 0, 0, 0)") surface = surface.parentElement;
            if (!surface) throw new Error(`No painted background for ${selector}`);
            const ink = luminance(getComputedStyle(element).color);
            const paper = luminance(getComputedStyle(surface).backgroundColor);
            return { selector, ratio: (Math.max(ink, paper) + 0.05) / (Math.min(ink, paper) + 0.05) };
          }),
        );
      });
      await night.getByRole("region", { name: "London clue hunt" }).scrollIntoViewIfNeeded();
      const clueShot = testInfo.outputPath(`night-clues-${theme}.png`);
      await page.screenshot({ path: clueShot });
      await testInfo.attach(`night-clues-${theme}`, { path: clueShot, contentType: "image/png" });
      await testInfo.attach("text-contrast", { body: JSON.stringify(contrasts, null, 2), contentType: "application/json" });
      expect(contrasts.length).toBeGreaterThanOrEqual(7);
      for (const sample of contrasts) expect(sample.ratio, `${theme}: ${sample.selector}`).toBeGreaterThanOrEqual(4.5);
    });
  }
});

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test.describe(`V1 night extras at ${viewport.width}px`, () => {
    test.use({ viewport });
    test("host settings, guest reveals, table finding and stranger refusal", async ({ page, browser }, testInfo) => {
      const created = await page.request.post("/api/plans", {
        headers: { "idempotency-key": randomUUID() },
        data: { title: "A night with surprises", creatorName: "Host", startTime: new Date(Date.now() + 3_600_000).toISOString(), stops },
      });
      expect(created.status()).toBe(201);
      const host = await created.json();
      const id: string = host.plan.plan.id;
      const arrival = await page.request.post(`/api/plans/${id}/actions`, {
        headers: { "idempotency-key": randomUUID(), authorization: `Bearer ${host.memberToken}` },
        data: {
          type: "arrived",
          stopPosition: 0,
          expectedRouteRevision: host.plan.plan.routeRevision,
          venueId: host.plan.stops.find((stop: { position: number }) => stop.position === 0).venueId,
        },
      });
      expect(arrival.ok()).toBe(true);
      await page.addInitScript(() => {
        localStorage.setItem("pubmax-tour-v1-done", "1");
        localStorage.setItem("pubmax_onboarding_dismissed", "1");
        sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      });
      await page.goto(`/plan/${id}`);
      if (viewport.width < 768) {
        await page.getByRole("button", { name: "View full plan", exact: true }).click();
      }
      await page.getByRole("button", { name: "Turn on mystery envelopes" }).click();
      await expect(page.getByRole("button", { name: "Open stop 2", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Open stop 2", exact: true }).click();
      await expect(page.getByRole("button", { name: "Open stop 2", exact: true })).toHaveCount(0);
      const beacon = page.getByRole("region", { name: "Find our table", exact: true });
      await beacon.getByLabel("Where to find you").fill("Upstairs, beside the window");
      await beacon.getByRole("button", { name: "Set table sign", exact: true }).click();
      await beacon.getByRole("button", { name: "Show table sign full screen" }).click();
      await expect(page.getByRole("dialog", { name: "Star at Arnos Arms" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog", { name: "Star at Arnos Arms" })).toHaveCount(0);
      await expect(beacon.getByRole("button", { name: "Show table sign full screen" })).toBeFocused();
      await testInfo.attach("host-plan", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });

      const canonical = await (await page.request.get(`/api/plans/${id}`)).json();
      const guestContext = await browser.newContext({ viewport });
      try {
        const guestPage = await guestContext.newPage();
        const base = new URL(page.url()).origin;
        const joined = await guestContext.request.post(`${base}/api/plans/${id}/join`, {
          headers: { "idempotency-key": randomUUID() }, data: { name: "Guest", inviteToken: canonical.inviteToken },
        });
        expect(joined.ok()).toBe(true);
        await guestPage.goto(`${base}/plan/${id}`);
        if (viewport.width < 768) {
          await guestPage.getByRole("button", { name: "View full plan", exact: true }).click();
        }
        await expect(guestPage.getByRole("button", { name: "Open stop 2", exact: true })).toBeVisible();
        await expect(guestPage.getByRole("button", { name: "Turn off mystery envelopes" })).toHaveCount(0);
        await expect(guestPage.getByRole("region", { name: "Find our table", exact: true }).getByText("Upstairs, beside the window", { exact: true })).toBeVisible();
        await guestPage.getByRole("button", { name: "Show full route" }).click();
        await expect(guestPage.getByRole("button", { name: /^Open stop/ })).toHaveCount(0);
      } finally { await guestContext.close(); }

      const stranger = await browser.newContext();
      try {
        const base = new URL(page.url()).origin;
        expect((await stranger.request.get(`${base}/api/plans/${id}/beacon`)).status()).toBe(404);
        expect((await stranger.request.get(`${base}/api/plans/${id}/presentation`)).status()).toBe(403);
      } finally { await stranger.close(); }
      const after = await (await page.request.get(`/api/plans/${id}`)).json();
      expect(after.plan.routeRevision).toBe(canonical.plan.routeRevision);
      expect(after.actions).toEqual(canonical.actions);
    });
  });
}
