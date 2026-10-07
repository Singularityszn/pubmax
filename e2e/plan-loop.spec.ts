import { expect, test } from "@playwright/test";

import { sortDescribeFirst } from "./helpers/planDescribeFirst";
import { pinLondonEvening, setFirstPintIn } from "./helpers/planFirstPint";


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
    // The identity nudge (lib/identityNudge.ts) fires after the first
    // qualifying plan action and lays a backdrop over the night surface this
    // test taps. It is real signed-out UX and has its own coverage; pre-
    // dismissing it here is what a returning visitor already carries.
    window.localStorage.setItem("pubmax:identityNudge:dismissedAt:v1", String(Date.now()));
  });
  await pinLondonEvening(page);
  await page.goto("/plan");
  await expect(page.getByRole("heading", { name: "Describe the outing. We’ll put it in order." })).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    )
    .toBeLessThanOrEqual(1);

  await sortDescribeFirst(page, "Quiet in Clapham for 4, not pricey");
  await expect(page.getByText("3 stops we can stand behind, shaped by the outing you set.")).toBeVisible();
  // The route names the area it understood (the area picker itself is behind Tune details).
  await expect(page.getByRole("heading", { name: /^(Tonight|Today|Tomorrow night) in Clapham$/ })).toBeVisible();
  await page.getByRole("button", { name: "Tune details" }).click();
  await expect(page.getByRole("spinbutton", { name: /People/i })).toHaveValue("4");
  await page.keyboard.press("Escape");
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
  await expect(page).toHaveURL(/\/plan\/[0-9a-f-]{36}(?:#share)?$/);
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
    // The identity nudge (lib/identityNudge.ts) fires after the first
    // qualifying plan action and lays a backdrop over the night surface this
    // test taps. It is real signed-out UX and has its own coverage; pre-
    // dismissing it here is what a returning visitor already carries.
    window.localStorage.setItem("pubmax:identityNudge:dismissedAt:v1", String(Date.now()));
  });
  const matePage = await mate.newPage();
  matePage.on("request", (request) => {
    if (request.method() === "POST" && /\/api\/plans\/[0-9a-f-]{36}\/join$/.test(new URL(request.url()).pathname)) {
      joinIdempotencyKey = request.headers()["idempotency-key"] ?? null;
    }
  });
  await matePage.setViewportSize({ width: 390, height: 844 });
  // The mate opens the link the host actually shares, not the host's own
  // post-lock URL. A bare /plan/<uuid> offers no join form on purpose: the
  // classic invite token is the capability, and PlanCrew reads it from
  // #invite= (lib/planCrewInviteUrl.ts) rather than reopening the bare-UUID
  // IDOR. Taking it off the host's own WhatsApp CTA keeps this end to end.
  const shareHref = await page.getByRole("link", { name: "Send on WhatsApp" }).getAttribute("href");
  const sharedPath = decodeURIComponent(new URL(shareHref ?? "").searchParams.get("text") ?? "")
    .match(/\/plan\/[0-9a-f-]{36}#invite=[0-9a-f]{32}/)?.[0];
  expect(sharedPath).toBeTruthy();
  await matePage.goto(new URL(sharedPath as string, publicUrl).toString());
  // Night mode (components/plan/NightCrawlMode.tsx) auto-opens on mobile
  // whenever the plan is "on tonight" (lib/activePlan.ts's active window).
  // ActivePlanMarker only marks a plan active for a viewer who holds plan
  // capability (components/plan/ActivePlanMarker.tsx) - a pre-join visitor
  // has none yet, so this mate must never see the overlay before they join.
  // Give it a beat to make sure it truly never opens, not just that it isn't
  // open at this exact instant.
  const nightMode = matePage.getByRole("dialog", { name: "Night mode" });
  await expect(matePage.getByText("Your name is enough.")).toBeVisible();
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
  await mate.close();
});

test("host still gets night mode ambushed at their own plan's start time", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    // The identity nudge (lib/identityNudge.ts) fires after the first
    // qualifying plan action and lays a backdrop over the night surface this
    // test taps. It is real signed-out UX and has its own coverage; pre-
    // dismissing it here is what a returning visitor already carries.
    window.localStorage.setItem("pubmax:identityNudge:dismissedAt:v1", String(Date.now()));
  });
  await page.goto("/plan");
  await sortDescribeFirst(page, "Quiet in Clapham for 4, not pricey");
  await expect(page.getByText("3 stops we can stand behind, shaped by the outing you set.")).toBeVisible();
  await page.getByLabel("Your name").fill("Karan");
  // The night has to actually BE on, and an inferred start is not: the
  // generator answers an evening daypart with an 18:00 London start whatever
  // the wall clock says, while lib/activePlan.ts opens the active window only
  // ACTIVE_PLAN_PRE_MS (3h) before it. Left inferred, this test passed after
  // 15:00 London and failed every hour before it. Naming a start half an hour
  // out puts the plan inside the window whenever the suite runs. Editing the
  // start marks the route stale, so refresh it before locking in.
  await setFirstPintIn(page, 30);
  await page.getByRole("button", { name: "Regenerate route" }).click();
  await expect(page.getByText("3 stops we can stand behind, shaped by the outing you set.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Lock it in" })).toBeEnabled();
  await page.getByRole("button", { name: "Lock it in" }).click();
  await expect(page).toHaveURL(/\/plan\/[0-9a-f-]{36}(?:#share)?$/);
  await expect(page.getByRole("heading", { name: /Who.s in/ })).toBeVisible();

  // The host holds capability from the moment the plan is created
  // (PlanComposer's writePlanCapability call, role "host"), and the plan is on
  // now - so Night Mode should ambush them.
  const nightMode = page.getByRole("dialog", { name: "Night mode" });
  await expect(nightMode).toBeVisible();
});
