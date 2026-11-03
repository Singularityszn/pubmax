import { expect, test } from "@playwright/test";

import { ACCOUNTS, accessJwt, installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";
import { storeThemeChoice } from "./helpers/themeClock";

for (const theme of ["light", "dark"] as const) {
  test(`private turn order survives a return and refresh at 390px in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await storeThemeChoice(page, theme);
    const auth = await installAuthDoubles(page);
    await seedSignedIn(page, "A");
    const writes: string[] = [];
    await page.route("**/api/rounds/BCDFGH", async (route) => {
      const request = route.request();
      if (request.method() !== "GET") {
        writes.push(request.method());
        await route.fulfill({ status: 405, json: { error: "Read-only fixture" } });
        return;
      }
      const bearer = request.headers().authorization ?? "";
      const handle = bearer.endsWith("-B") || bearer === `Bearer ${accessJwt(ACCOUNTS.B)}`
        ? ACCOUNTS.B.handle : ACCOUNTS.A.handle;
      await route.fulfill({ json: {
        round: {
          id: "round-rota-browser", code: "BCDFGH", title: "Turn preview", createdByHandle: ACCOUNTS.A.handle,
          createdAt: "2026-11-01T12:00:00Z", closedAt: null,
        },
        members: Object.values(ACCOUNTS).map((account) => ({ handle: account.handle, joinedAt: "2026-11-01T12:00:00Z" })),
        stops: [], spends: [], viewerMemberHandle: handle,
      } });
    });
    await page.goto("/rounds/BCDFGH?wild=1&wildpreview=round-rota");
    const tracker = page.getByRole("region", { name: "Your turn order", exact: true });
    await expect(tracker).toBeVisible();
    await tracker.getByLabel("Add a name", { exact: true }).fill("Sam");
    await tracker.getByLabel("Add a name", { exact: true }).press("Enter");
    await tracker.getByLabel("Add a name", { exact: true }).fill("Priya");
    await tracker.getByLabel("Add a name", { exact: true }).press("Enter");
    await tracker.getByRole("button", { name: "Next person", exact: true }).focus();
    await page.keyboard.press("Space");
    await expect(tracker.locator(".roundRotaCurrent")).toContainText("Priya");

    await page.goto("/rounds");
    await page.goto("/rounds/BCDFGH");
    await expect(tracker.locator(".roundRotaCurrent")).toContainText("Priya");
    await page.reload();
    await expect(tracker.locator(".roundRotaCurrent")).toContainText("Priya");
    await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe("32px");
    expect(await tracker.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    for (const button of await tracker.getByRole("button").all()) {
      await button.scrollIntoViewIfNeeded();
      const box = await button.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }

    await auth.signedInAs("B");
    await page.goto("/rounds/BCDFGH");
    await expect(tracker).toBeVisible();
    await expect(tracker.getByText("Sam", { exact: true })).toHaveCount(0);
    await expect(tracker.getByText("Priya", { exact: true })).toHaveCount(0);
    await expect(tracker.locator(".roundRotaEmpty")).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem("pubmax:wild-round-rota:v1"))).toBeNull();
    await page.goto("/rounds/BCDFGH?wild=0");
    await expect(tracker).toHaveCount(0);
    expect(writes).toEqual([]);
  });
}
