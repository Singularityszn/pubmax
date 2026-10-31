import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

const stops = [
  { venueId: "venue-xjf3n0", venueName: "Arnos Arms" },
  { venueId: "venue-1f5ygjb", venueName: "The Bohemia" },
  { venueId: "venue-3h52h", venueName: "The Elephant Inn" },
];

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
        data: { type: "arrived", stopPosition: 0 },
      });
      expect(arrival.ok()).toBe(true);
      await page.addInitScript(() => {
        localStorage.setItem("pubmax-tour-v1-done", "1");
        localStorage.setItem("pubmax_onboarding_dismissed", "1");
        sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      });
      await page.goto(`/plan/${id}`);
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
