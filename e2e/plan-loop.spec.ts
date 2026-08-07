import { expect, test } from "@playwright/test";

test("concierge picks become a public Plan that a mate joins with only a name", async ({
  browser,
  page,
}) => {
  let createIdempotencyKey: string | null = null;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/plans") {
      createIdempotencyKey = request.headers()["idempotency-key"] ?? null;
    }
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  await page.goto("/plan");
  await expect(page.getByRole("heading", { name: "Describe the night. We’ll put it in order." })).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    )
    .toBeLessThanOrEqual(1);

  await page.getByLabel("Describe the night").fill("Quiet in Clapham for 4, not pricey");
  await page.getByRole("button", { name: "Plan my night" }).click();
  await expect(page.getByText("Three stops we can stand behind, shaped by the night you set below.")).toBeVisible();
  await expect(page.getByRole("combobox", { name: /Area/i })).toHaveValue("clapham");
  await expect(page.getByRole("spinbutton", { name: /People/i })).toHaveValue("4");
  await page.getByText("Area coverage", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "Higher-confidence planning" })).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    )
    .toBeLessThanOrEqual(1);

  await page.getByLabel("Your name").fill("Karan");
  expect(await page.evaluate(() => window.localStorage.getItem("pubmax:plan-intake:v1"))).not.toBeNull();
  await page.evaluate(() => {
    const nativeRemoveItem = Storage.prototype.removeItem;
    Object.defineProperty(window.sessionStorage, "removeItem", {
      configurable: true,
      value(key: string) {
        if (key === "pubmax:plan-draft:v1") throw new Error("session cleanup blocked");
        return nativeRemoveItem.call(this, key);
      },
    });
  });
  await page.getByRole("button", { name: "Lock it in" }).click();
  await expect.poll(() => createIdempotencyKey).toMatch(/^create-[0-9a-f-]{36}$/);
  await expect(page).toHaveURL(/\/plan\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: /Who.s in/ })).toBeVisible();
  await expect(page.getByText("Karan", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.localStorage.getItem("pubmax:plan-intake:v1"))).toBeNull();
  expect(await page.evaluate(() => window.localStorage.getItem("pubmaxx:plan-route-draft:v1"))).toBeNull();
  const publicUrl = page.url();

  const mate = await browser.newContext();
  let joinIdempotencyKey: string | null = null;
  await mate.addInitScript(() => {
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  const matePage = await mate.newPage();
  matePage.on("request", (request) => {
    if (request.method() === "POST" && /\/api\/plans\/[0-9a-f-]{36}\/join$/.test(new URL(request.url()).pathname)) {
      joinIdempotencyKey = request.headers()["idempotency-key"] ?? null;
    }
  });
  await matePage.setViewportSize({ width: 390, height: 844 });
  await matePage.goto(publicUrl);
  // Night mode (components/plan/NightCrawlMode.tsx) auto-opens on mobile
  // whenever the plan is "on tonight" (lib/activePlan.ts's active window).
  // ActivePlanMarker mounts on every /plan/[id] view - host or mate alike -
  // and marks the plan active unconditionally (components/plan/ActivePlanMarker.tsx),
  // so the mate here gets it too, since this plan's inferred start is now.
  // The dialog can open a beat after mount, racing this test's early actions,
  // so dismiss it wherever it might land rather than trusting a single
  // check right after goto.
  const nightMode = matePage.getByRole("dialog", { name: "Night mode" });
  async function dismissNightModeIfOpen(): Promise<void> {
    if (await nightMode.isVisible().catch(() => false)) {
      await nightMode.getByRole("button", { name: "View full plan" }).click();
      await expect(nightMode).toBeHidden();
    }
  }
  await dismissNightModeIfOpen();
  await expect(matePage.getByText("Your name is enough.")).toBeVisible();
  await dismissNightModeIfOpen();
  await expect
    .poll(async () =>
      matePage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    )
    .toBeLessThanOrEqual(1);
  await matePage.getByLabel("Your name is enough.").fill("Luna");
  await dismissNightModeIfOpen();
  await matePage.getByRole("button", { name: /I.m in/ }).click();
  await expect.poll(() => joinIdempotencyKey).toMatch(/^join:[0-9a-f-]{36}-[0-9a-f-]{36}$/);
  await expect(matePage.getByText("Luna", { exact: true })).toBeVisible();
  await mate.close();
});
