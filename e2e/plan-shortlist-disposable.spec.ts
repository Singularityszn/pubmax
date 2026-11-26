import { join } from "node:path";
import { appendFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { seedRealPlanHost, completeRealPlanHostOnboarding } from "./helpers/realPlanAuth";
import { londonDateTimeInputFromIso } from "@/lib/planIntake";
import { openHeaderThemeControl } from "./helpers/headerThemeControl";

test.beforeEach(async ({ page }, testInfo) => {
  if (process.env.PW_SHORTLIST_EVIDENCE) page.on("pageerror", (error) => {
    appendFileSync(join(process.env.PW_SHORTLIST_EVIDENCE!, "browser-errors.log"), `${testInfo.project.name} ${testInfo.title} ${page.url()}: ${error.message}\n${error.stack}\n`);
  });
});

test.afterEach(async ({ page }, testInfo) => {
  if (process.env.PW_SHORTLIST_EVIDENCE && testInfo.status !== testInfo.expectedStatus) {
    await page.screenshot({ path: join(process.env.PW_SHORTLIST_EVIDENCE, `${testInfo.project.name}-${testInfo.line}-failure.png`), fullPage: true });
  }
});

// The independent contracts are the three-pub limit, one vote per browser,
// organiser-only confirmation, seven-day invite, and current price evidence.
function disposableDb() {
  const url = process.env.PW_DISPOSABLE_SUPABASE_URL;
  const key = process.env.PW_DISPOSABLE_SERVICE_ROLE_KEY;
  if (process.env.PW_DISPOSABLE_PLAN_AUTH !== "1" || !url || !key || new URL(url).hostname !== "127.0.0.1") {
    throw new Error("This scenario requires the disposable loopback database.");
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function createFromApi(page: import("@playwright/test").Page) {
  const filters = "area=piccadilly-soho&mood=balanced&pintLimit=6";
  const suggested = await page.request.get(`/api/plans/shortlist?${filters}`);
  expect(suggested.ok()).toBe(true);
  const { options } = await suggested.json();
  const body = { shortlist: { filters, venueIds: options.slice(0, 2).map((o: { venueId: string }) => o.venueId), budgetLimitPence: 2500 }, startTime: new Date().toISOString() };
  const key = crypto.randomUUID();
  const created = await page.request.post("/api/plans", { headers: { "idempotency-key": key }, data: body });
  expect(created.status()).toBe(201);
  const { planId } = await created.json();
  const host = await page.request.get(`/api/plans/${planId}/shortlist`);
  expect(host.ok()).toBe(true);
  return { planId, host: await host.json(), body, key };
}

test("pub entry limits selection to three and explains separate budgets at each layout", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const response = await page.request.get("/api/plans/shortlist?area=piccadilly-soho&mood=balanced");
  const { options } = await response.json();
  await page.goto(`/pubs/${options[0].venueId}`);
  await page.getByRole("link", { name: "Shortlist this pub" }).click();
  await expect(page.getByRole("heading", { name: "Shortlist pubs" })).toBeVisible();
  await page.getByLabel("Maximum per pint").fill("6");
  await page.getByLabel("Whole outing budget per person").fill("25");
  await expect(async () => {
    await page.getByRole("button", { name: "Find pubs" }).click();
    await expect(page.getByRole("group", { name: "Suggested pubs" })).toBeVisible();
  }).toPass();
  const choices = page.getByRole("group", { name: "Suggested pubs" }).getByRole("checkbox");
  await expect(choices.nth(0)).toBeChecked();
  await choices.nth(1).check();
  await choices.nth(2).check();
  await expect(choices.nth(3)).toBeDisabled();
  await choices.nth(2).uncheck();
  await expect(choices.nth(3)).toBeEnabled();
  await expect(page.getByText("The outing budget is for your reference. Pub prices cover individual pints.")).toBeVisible();
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ["light", "dark"]) {
      if (await page.locator("html").getAttribute("data-theme") !== theme) {
        await (await openHeaderThemeControl(page)).click();
        await page.keyboard.press("Escape");
      }
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if (process.env.PW_SHORTLIST_EVIDENCE) await page.screenshot({ path: join(process.env.PW_SHORTLIST_EVIDENCE, `${testInfo.project.name}-entry-${width}-${theme}.png`), fullPage: true });
    }
  }
  await page.setViewportSize({ width: 390, height: 900 });
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (process.env.PW_SHORTLIST_EVIDENCE) await page.screenshot({ path: join(process.env.PW_SHORTLIST_EVIDENCE, `${testInfo.project.name}-entry-large-text.png`), fullPage: true });
});

test("expired evidence drops its budget claim and expired links reject reads and votes", async ({ page, browser }, testInfo) => {
  const { planId, host, body, key } = await createFromApi(page);
  const db = disposableDb();
  const options = host.shortlist.options.map((option: object) => ({ ...option,
    listedPint: { priceGbp: 4, pintName: "Test ale", observedOn: new Date().toISOString().slice(0, 10), publisher: { label: "Disposable menu", url: "https://example.test/menu" } },
    reasons: ["Listed pint meets the per-pint limit"],
  }));
  expect((await db.from("plan_shortlists").update({ options }).eq("plan_id", planId)).error).toBeNull();
  const invite = `/invite/${host.token}`;
  const context = await browser.newContext({ ...testInfo.project.use });
  try {
    const guest = await context.newPage();
    await guest.goto(invite);
    await expect(guest.getByRole("link", { name: "Disposable menu" })).toHaveCount(2);
    await expect(guest.getByText("Listed pint meets the per-pint limit", { exact: true })).toHaveCount(2);
    if (process.env.PW_SHORTLIST_EVIDENCE) await guest.screenshot({ path: join(process.env.PW_SHORTLIST_EVIDENCE, `${testInfo.project.name}-dated-price.png`) });
    for (const option of options) option.listedPint.observedOn = "2020-01-01";
    expect((await db.from("plan_shortlists").update({ options }).eq("plan_id", planId)).error).toBeNull();
    await guest.reload();
    await expect(guest.getByText("No current listed pint price", { exact: true })).toHaveCount(2);
    await expect(guest.getByText("No current listed pint to check against the limit", { exact: true })).toHaveCount(2);
    if (process.env.PW_SHORTLIST_EVIDENCE) await guest.screenshot({ path: join(process.env.PW_SHORTLIST_EVIDENCE, `${testInfo.project.name}-aged-price.png`) });
    const vote = await guest.request.post(`/api/invite/${host.token}/vote`, { headers: { "x-invite-voter": crypto.randomUUID() }, data: { venueId: options[0].venueId } });
    expect(vote.status()).toBe(200);
    expect((await vote.json()).shortlist.options.every((option: { listedPint: unknown }) => option.listedPint === null)).toBe(true);
    const replay = await page.request.post("/api/plans", { headers: { "idempotency-key": key }, data: body });
    expect(replay.status()).toBe(201);
    expect(await replay.json()).toMatchObject({ planId, created: false });
    const changed = await page.request.post("/api/plans", { headers: { "idempotency-key": key }, data: { ...body, shortlist: { ...body.shortlist, budgetLimitPence: 2600 } } });
    expect(changed.status()).toBe(409);
    expect((await db.from("plan_shortlists").update({ expires_at: "2020-01-01T00:00:00Z" }).eq("plan_id", planId)).error).toBeNull();
    await guest.reload();
    await expect(guest.getByText(/invite link has expired/i)).toBeVisible();
    const expired = await guest.request.post(`/api/invite/${host.token}/vote`, { headers: { "x-invite-voter": crypto.randomUUID() }, data: { venueId: options[0].venueId } });
    expect(expired.status()).toBe(410);
    if (process.env.PW_SHORTLIST_EVIDENCE) await guest.screenshot({ path: join(process.env.PW_SHORTLIST_EVIDENCE, `${testInfo.project.name}-expired.png`) });
  } finally { await context.close(); }
});

test("delayed refresh cannot undo rotation or a no-vote confirmation and activation uses meeting time", async ({ page }, testInfo) => {
  const { planId, host } = await createFromApi(page);
  const previous = { version: 1, id: crypto.randomUUID(), startTime: new Date().toISOString(), stopIndex: 0, ownerId: null, role: "host" };
  await page.goto(`/plan/${planId}`);
  await expect(page.getByRole("button", { name: "Refresh votes" })).toBeVisible();
  await page.evaluate((previous) => localStorage.setItem("pubmax_active_plan", JSON.stringify(previous)), previous);
  await page.reload();
  await expect(page.getByRole("button", { name: "Refresh votes" })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("pubmax_active_plan")!))).toMatchObject({ id: previous.id });
  const path = `/api/plans/${planId}/shortlist`;
  async function holdRead() {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let observed!: () => void;
    const read = new Promise<void>((resolve) => { observed = resolve; });
    let fulfilled!: () => void;
    const delivered = new Promise<void>((resolve) => { fulfilled = resolve; });
    await page.route(`**${path}`, async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const response = await route.fetch();
      observed();
      await gate;
      await route.fulfill({ response });
      fulfilled();
    }, { times: 1 });
    await page.getByRole("button", { name: "Refresh votes" }).click();
    await read;
    return async () => { release(); await delivered; };
  }
  const releaseRotation = await holdRead();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Make new invite link" }).click();
  await expect(page.getByText("New invite link ready")).toBeVisible();
  const rotated = await page.getByLabel("Invite link").inputValue();
  await releaseRotation();
  await expect(page.getByLabel("Invite link")).toHaveValue(rotated);
  expect(rotated).not.toContain(host.token);
  const releaseConfirmation = await holdRead();
  const meeting = londonDateTimeInputFromIso(new Date(Date.now() + 30 * 60000).toISOString())!;
  await page.getByLabel("Pub to confirm").selectOption(host.shortlist.options[0].venueId);
  await page.getByLabel("Meet at (London time)").fill(meeting);
  await page.getByRole("button", { name: "Confirm pub and time" }).click();
  await expect(page.getByText("Pub and time confirmed")).toBeVisible();
  await releaseConfirmation();
  await expect(page.getByRole("link", { name: "Open directions" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm pub and time" })).toHaveCount(0);
  await expect(async () => {
    const active = await page.evaluate(() => JSON.parse(localStorage.getItem("pubmax_active_plan")!));
    expect(active.id).toBe(planId);
    expect(londonDateTimeInputFromIso(active.startTime)).toBe(meeting);
  }).toPass();
  if (process.env.PW_SHORTLIST_EVIDENCE) await page.screenshot({ path: join(process.env.PW_SHORTLIST_EVIDENCE, `${testInfo.project.name}-no-vote-confirmed.png`) });
});

test("signed-in organiser recovers lost and rejected cached capability", async ({ page }, testInfo) => {
  const hydrationErrors: Error[] = [];
  page.on("pageerror", (error) => { if (/Hydration failed|Minified React error #418/.test(error.message)) hydrationErrors.push(error); });
  const account = await seedRealPlanHost(page);
  try {
    await completeRealPlanHostOnboarding(page);
    await page.goto("/plan?shortlist=1");
    await page.getByLabel("Meet in").selectOption("piccadilly-soho");
    await expect(async () => {
      await page.getByRole("button", { name: "Find pubs" }).click();
      await expect(page.getByRole("group", { name: "Suggested pubs" })).toBeVisible();
    }).toPass();
    await page.getByRole("checkbox").first().check();
    await page.getByRole("button", { name: "Create shortlist" }).click();
    await expect(page.getByLabel("Invite link")).toBeVisible();
    const planId = new URL(page.url()).pathname.split("/").at(-1)!;
    const cookie = `pubmax_plan_member_${planId}`;
    await page.context().clearCookies({ name: cookie });
    await page.reload();
    await expect(page.getByLabel("Invite link")).toBeVisible();
    expect((await page.context().cookies()).some((c) => c.name === cookie)).toBe(true);
    // Cookie loss while the page stays mounted leaves its volatile capability stale.
    await page.context().clearCookies({ name: cookie });
    await page.getByRole("button", { name: "Refresh votes" }).click();
    await expect(page.getByRole("status").filter({ hasText: /organiser|host|load|permission/i })).toBeVisible();
    await page.getByRole("button", { name: "Refresh votes" }).click();
    await expect(async () => expect((await page.context().cookies()).some((c) => c.name === cookie)).toBe(true)).toPass();
    await page.getByLabel("Pub to confirm").selectOption({ index: 1 });
    await page.getByLabel("Meet at (London time)").fill(londonDateTimeInputFromIso(new Date(Date.now() + 86400000).toISOString())!);
    await page.getByRole("button", { name: "Confirm pub and time" }).click();
    await expect(page.getByText("Pub and time confirmed")).toBeVisible();
    if (process.env.PW_SHORTLIST_EVIDENCE) await page.screenshot({ path: join(process.env.PW_SHORTLIST_EVIDENCE, `${testInfo.project.name}-account-recovered.png`) });
    expect(hydrationErrors.map((error) => error.message)).toEqual([]);
  } finally { await account.cleanup(); }
});
