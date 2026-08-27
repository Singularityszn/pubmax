import { expect, test, type Page } from "@playwright/test";

async function openHydratedPlanComposer(page: Page): Promise<void> {
  await page.goto("/plan");
  const stopCount = page
    .getByRole("group", { name: "Number of pub stops" })
    .getByRole("button", { name: "4", exact: true });
  await expect(async () => {
    await stopCount.click();
    await expect(stopCount).toHaveAttribute("aria-pressed", "true", { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  const threeStops = page
    .getByRole("group", { name: "Number of pub stops" })
    .getByRole("button", { name: "3", exact: true });
  await threeStops.click();
  await expect(threeStops).toHaveAttribute("aria-pressed", "true");
}

function futureLondonFirstPint(): string {
  const when = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(when);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "00";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

test("concierge picks become a public Plan that a mate joins with only a name", async ({
  browser,
  page,
}) => {
  test.setTimeout(150_000);
  let createIdempotencyKey: string | null = null;
  const completionStatuses: number[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/plans") {
      createIdempotencyKey = request.headers()["idempotency-key"] ?? null;
    }
  });
  page.on("response", (response) => {
    if (
      response.request().method() === "POST"
      && /\/api\/plans\/[0-9a-f-]{36}\/complete$/.test(new URL(response.url()).pathname)
    ) {
      completionStatuses.push(response.status());
    }
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  await page.goto("/plan");
  await expect(page.getByRole("heading", { name: "Describe the outing. We’ll put it in order." })).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    )
    .toBeLessThanOrEqual(1);

  await page.getByLabel("Describe the outing").fill("Quiet in Clapham for 4, not pricey");
  await page.getByRole("button", { name: "Make a plan" }).click();
  await expect(page.getByText("3 stops we can stand behind, shaped by the outing you set below.")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("combobox", { name: /Area/i })).toHaveValue("clapham");
  await expect(page.getByRole("spinbutton", { name: /People/i })).toHaveValue("4");
  await page.getByText("Area coverage", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "Crawl-ready", exact: true })).toBeVisible();
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
  await expect(page).toHaveURL(/\/plan\/[0-9a-f-]{36}(?:#share)?$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: /Who.s in/ })).toBeVisible();
  await expect(page.getByText("Karan", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.localStorage.getItem("pubmax:plan-intake:v1"))).toBeNull();
  expect(await page.evaluate(() => window.localStorage.getItem("pubmaxx:plan-route-draft:v1"))).toBeNull();
  const whatsappHref = await page.getByRole("link", { name: "Send on WhatsApp" }).getAttribute("href");
  const sharedText = whatsappHref ? new URL(whatsappHref).searchParams.get("text") ?? "" : "";
  const invitePath = sharedText.match(/\/plan\/[0-9a-f-]{36}(?:\?[^\s#]*)?#invite=[0-9a-f]+/)?.[0] ?? null;
  const inviteUrl = invitePath ? new URL(invitePath, page.url()) : null;
  expect(inviteUrl?.pathname).toMatch(/^\/plan\/[0-9a-f-]{36}$/);
  expect(inviteUrl?.hash).toMatch(/^#invite=[0-9a-f]+$/);
  const planId = inviteUrl?.pathname.split("/").at(-1) ?? "";

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
  await matePage.goto(inviteUrl?.href ?? "/plan");
  // Night mode (components/plan/NightCrawlMode.tsx) auto-opens on mobile
  // whenever the plan is "on tonight" (lib/activePlan.ts's active window).
  // ActivePlanMarker only marks a plan active for a viewer who holds plan
  // capability (components/plan/ActivePlanMarker.tsx) - a pre-join visitor
  // has none yet, so this mate must never see the overlay before they join.
  // Give it a beat to make sure it truly never opens, not just that it isn't
  // open at this exact instant.
  const nightMode = matePage.getByRole("dialog", { name: "Night mode" });
  await expect(matePage.getByText("Your name is enough.")).toBeVisible({ timeout: 20_000 });
  await matePage.waitForTimeout(500);
  await expect(nightMode).toBeHidden();
  await expect
    .poll(async () =>
      matePage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    )
    .toBeLessThanOrEqual(1);
  await matePage.getByLabel("Your name is enough.").fill("Luna");
  await expect(nightMode).toBeHidden();
  await matePage.getByRole("button", { name: /I.m in/ }).click();
  await expect.poll(() => joinIdempotencyKey).toMatch(/^join:[0-9a-f-]{36}-[0-9a-f-]{36}$/);
  await expect(matePage.getByText("Luna", { exact: true })).toBeVisible();
  // Once accepted, the mate is on the night same as the host - joining wrote
  // "guest" capability, so Night Mode is now allowed to reach them too.
  if (await nightMode.isVisible().catch(() => false)) {
    await nightMode.getByRole("button", { name: "View full plan" }).click();
    await expect(nightMode).toBeHidden();
  }

  const hostNightMode = page.getByRole("dialog", { name: "Night mode" });
  await expect(hostNightMode).toBeVisible();
  await hostNightMode.getByRole("button", { name: /We are here/ }).click();
  await expect(hostNightMode.getByText("Stop 2 of 3")).toBeVisible();
  await hostNightMode.getByRole("button", { name: /We are here/ }).click();
  await expect(hostNightMode.getByText("Stop 3 of 3")).toBeVisible();
  await hostNightMode.getByRole("button", { name: /We are here/ }).click();
  await hostNightMode.getByRole("button", { name: "Finish the night" }).click();

  const hostEnding = page.getByRole("dialog", { name: "Tonight's plan" });
  await expect(hostEnding).toBeVisible();
  await hostEnding.getByRole("button", { name: /^Get home\./ }).click();
  await hostEnding.getByRole("button", { name: "That's my way home" }).click();
  await expect(hostEnding.getByText("Night complete", { exact: false })).toBeVisible();
  await expect.poll(() => completionStatuses).toEqual([201]);

  await matePage.reload();
  await expect(matePage.getByText("That was the night", { exact: true })).toBeVisible({ timeout: 20_000 });
  await matePage.goto(`/plan/${planId}/recap`);
  await expect(matePage.getByRole("link", { name: "Plan again" })).toBeVisible({ timeout: 20_000 });
  await mate.close();
});

test("host finishes the final stop in the canonical ending surface", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  await openHydratedPlanComposer(page);
  await page.getByLabel("Describe the outing", { exact: true }).fill("Quiet in Clapham for 4, not pricey");
  await page.getByRole("button", { name: "Make a plan" }).click();
  await expect(page.getByText("3 stops we can stand behind, shaped by the outing you set below.")).toBeVisible();
  await page.getByLabel("Your name").fill("Karan");
  await page.getByLabel("First pint").fill(futureLondonFirstPint());
  await page.getByRole("button", { name: "Regenerate route" }).click();
  await expect(page.getByText("Route refreshed. Review the preview")).toBeVisible();
  await page.getByRole("button", { name: "Lock it in" }).click();
  await expect(page).toHaveURL(/\/plan\/[0-9a-f-]{36}(?:#share)?$/);
  await expect(page.getByRole("heading", { name: /Who.s in/ })).toBeVisible();

  // The host holds capability from the moment the plan is created
  // (PlanComposer's writePlanCapability call, role "host"), and this plan's
  // inferred start time is now - so Night Mode should ambush them.
  const nightMode = page.getByRole("dialog", { name: "Night mode" });
  await expect(nightMode).toBeVisible();

  await nightMode.getByRole("button", { name: /We are here/ }).click();
  await expect(nightMode.getByText("Stop 2 of 3")).toBeVisible();
  await nightMode.getByRole("button", { name: /We are here/ }).click();
  await expect(nightMode.getByText("Stop 3 of 3")).toBeVisible();
  await nightMode.getByRole("button", { name: /We are here/ }).click();
  await expect(nightMode.getByRole("button", { name: "Finish the night" })).toBeVisible();
  await nightMode.getByRole("button", { name: "Finish the night" }).click();

  await expect(nightMode).toBeHidden();
  const ending = page.getByRole("dialog", { name: "Tonight's plan" });
  await expect(ending).toBeVisible();
  await expect(ending.getByRole("region", { name: "Crawl ending" })).toBeVisible();
  await ending.getByRole("button", { name: /^Get home\./ }).click();
  await expect(ending.getByLabel("Confirm Get home ending")).toBeVisible();
  await ending.getByRole("button", { name: "That's my way home" }).click();
  await expect(ending.getByText("Night complete", { exact: false })).toBeVisible();
  await ending.getByRole("button", { name: "Review private recap" }).click();
  await expect(ending.getByText("Private recap preview")).toBeVisible();

  await ending.getByRole("link", { name: "See the full recap" }).click();
  await expect(page).toHaveURL(/\/plan\/[0-9a-f-]{36}\/recap$/, { timeout: 20_000 });
  await expect(page.getByRole("link", { name: "Plan again" })).toBeVisible();
});
