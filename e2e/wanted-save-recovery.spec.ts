import { expect, test } from "@playwright/test";
import { stubSocialAuthProviders } from "./helpers/authDoubles";

test.beforeEach(async ({ page }) => {
  await stubSocialAuthProviders(page);
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
  });
});

for (const width of [1280, 390]) {
  test(`Wanted sign-in form aligns with its status at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/api/auth/session", (route) => route.fulfill({ json: { hint: null } }));
    await page.goto("/map?sel=venue-16pnwmm");
    const wrap = page.locator(".wantedSaveWrap").first();
    const save = wrap.getByRole("button", { name: /for a night$/ });
    const status = wrap.getByRole("status");
    await expect(async () => {
      await save.click();
      await expect(status).toHaveText("Sign in to save for a night.", { timeout: 1_000 });
    }).toPass({ timeout: 60_000 });
    const label = wrap.locator("label", { hasText: "Continue with email" });
    await expect(label).toBeVisible();
    const statusBox = await status.boundingBox();
    const labelBox = await label.boundingBox();
    expect(Math.abs(labelBox!.x - statusBox!.x)).toBeLessThan(1);
    await wrap.getByRole("textbox", { name: "Continue with email" }).fill("person@example.test");
    await expect(wrap.getByRole("button", { name: "Email me a link" })).toBeEnabled();
  });
}

test("Wanted explains an unresolved session and lets the viewer retry", async ({ page }) => {
  let wantedPosts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/wanted") {
      wantedPosts += 1;
    }
  });
  await page.route("**/api/auth/session", (route) => route.abort("connectionreset"));
  const failedSession = page.waitForEvent("requestfailed", {
    predicate: (request) => new URL(request.url()).pathname === "/api/auth/session",
  });
  await page.goto("/map?sel=venue-16pnwmm");
  await failedSession;
  const wrap = page.locator(".wantedSaveWrap").first();
  await wrap.getByRole("button", { name: /for a night$/ }).click();
  const status = wrap.getByRole("status");
  await expect(status).toHaveText("Could not save. Check your connection and try again.");
  await expect(wrap.getByRole("textbox")).toHaveCount(0);
  await wrap.getByRole("button", { name: "Try again" }).click();
  await expect(wrap.getByRole("button", { name: /for a night$/ })).toBeDisabled();
  await expect(status).toHaveText("Could not save. Check your connection and try again.");
  await expect(wrap.getByRole("button", { name: "Try again" })).toBeEnabled();
  expect(wantedPosts).toBe(0);
});
