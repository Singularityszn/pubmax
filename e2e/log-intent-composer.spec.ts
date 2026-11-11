import { randomBytes } from "node:crypto";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { ADULT_SELF_ASSERTION_ACTION } from "@/lib/adultGate";
import { MAGIC_LINK_SENT_MESSAGE } from "@/lib/passwordlessAuth";

import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";

/**
 * GAP 18 (mobile store-readiness audit, 2026-09-04, 390x844).
 *
 * `/map?log=1` is the working entry to the core loop. The venue sheet opened
 * with the Pint Drop composer's price step starting at y=696 in an 844px
 * viewport and running 237px tall, so the price field sat on the bottom edge
 * and "Log it" was off screen behind the sheet's own action bar. The reader had
 * expressed exactly one intent and then had to scroll to act on it.
 *
 * What is asserted is the reveal and nothing more: the price step is IN the
 * viewport once the composer is up. The sheet still renders what it rendered,
 * and focus is deliberately not moved, so no keyboard is raised here.
 */
test.use({
  launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
  viewport: { width: 390, height: 844 },
});

test("the log intent lands the reader on the composer's price step", async ({ page }) => {
  // The picker waits on the venue index and the composer on the sheet, and
  // both are load-bound on a fleet box: the second repeat of a two-repeat run
  // at load 50 spent 20s reaching the picker and ran out of the default 30s
  // test budget on the way to the composer. The waits below have to fit in
  // the test's own budget, so the test says it is slow.
  test.slow();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  });
  // The basemap is the house fixture, not the live tile host (#1489). The
  // nearby picker is a blurred sheet standing over the map for the whole of
  // the load, and under SwiftShader every one of the hundred-odd frames the
  // live tiles paint beneath it is composited in software through that blur:
  // measured on a production build, the picker arrived at 65 to 80 seconds
  // with live tiles and at 11 to 17 with this fixture, and with the blur
  // stripped it arrived at 11 either way. Nothing asserted here is about the
  // basemap, and the map's own tile specs keep the live host.
  await installDeterministicMapBasemap(page);

  const response = await page.goto("/map?log=1");
  expect(response?.status()).toBe(200);

  // With no `sel=`, the intent offers the nearby picker; take the pub it leads
  // with, which is the ordinary path from More map controls' "Log a price".
  // The picker needs the viewport's shards and the venue index before it can
  // name a pub, and that wait is load-bound: 11 to 17 seconds on a quiet box,
  // past 20 under a fleet build. The budget below is a wait for the index,
  // never a geometry ceiling; the reveal's own ceilings further down stay
  // exactly where GAP 18 put them.
  const nearby = page.locator(".logIntentNearbyBtn").first();
  await expect(nearby).toBeVisible({ timeout: 45_000 });
  // A control painted on the server is tappable before React attaches, so the
  // tap is retried rather than the assertion after it made harder. Only a tap
  // that was dropped is retried: a tap that landed closes the picker, and on a
  // loaded box the composer can take over 10s to follow it. Clicking the gone
  // button then waited out the whole budget on actionability and never looked
  // at the price step again, which read as a composer that never opened.
  const priceStep = page.getByTestId("spill-price-step");
  await expect(async () => {
    if (await nearby.isVisible()) await nearby.click({ timeout: 2_000 });
    await expect(priceStep).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 25_000 });

  await expect
    .poll(
      async () =>
        priceStep.evaluate((step) => Math.round(step.getBoundingClientRect().top)),
      { timeout: 15_000 },
    )
    .toBeLessThan(422);

  const placement = await priceStep.evaluate((step) => {
    const rect = step.getBoundingClientRect();
    return {
      top: Math.round(rect.top),
      bottom: Math.round(rect.bottom),
      viewportHeight: window.innerHeight,
    };
  });

  expect(placement.top, "the price step starts inside the viewport").toBeGreaterThanOrEqual(0);
  expect(
    placement.top,
    "the price step is not parked on the bottom edge, where it shipped",
  ).toBeLessThan(placement.viewportHeight / 2);

  // The price field itself is what the reader came to fill in.
  await expect(priceStep.locator("input").first()).toBeInViewport();

  // A reveal and never a re-layout: the sheet opened on its Pints tab, and
  // focus stayed put, so raising the keyboard is the reader's own next move.
  await expect(page.locator("#venueTab-pints")).toHaveAttribute("aria-selected", "true");
  expect(
    await priceStep.evaluate((step) => step.contains(document.activeElement)),
    "the reveal moves no focus into the price step",
  ).toBe(false);
});

const NEW_DRINKER_PRICE = "5.20";

/**
 * The sign-in link local Supabase Auth emailed to this address, read from the
 * disposable project's mail catcher (Mailpit).
 */
async function emailedSignInLink(page: Page, address: string): Promise<string> {
  const mail = process.env.PW_DISPOSABLE_MAIL_URL;
  expect(mail, "the disposable runner names its mail catcher").toBeTruthy();
  let link = "";
  await expect(async () => {
    const search = await page.request.get(`${mail}/api/v1/search`, { params: { query: `to:"${address}"` } });
    expect(search.ok()).toBe(true);
    const { messages } = (await search.json()) as { messages: Array<{ ID: string }> };
    expect(messages, "one email reached the new address").toHaveLength(1);
    const message = await page.request.get(`${mail}/api/v1/message/${messages[0]!.ID}`);
    const { HTML, Text } = (await message.json()) as { HTML: string; Text: string };
    const body = `${Text}\n${HTML}`.replaceAll("&amp;", "&");
    link = /https?:\/\/[^\s"'<>]+\/auth\/v1\/verify\?[^\s"'<>]+/.exec(body)?.[0] ?? "";
    expect(link, "the email carries a verify link").not.toBe("");
  }).toPass({ timeout: 30_000 });
  return link;
}

/** Counts each deliberate tap a drinker makes, so the journey reports its length. */
function tapCounter() {
  const taps: string[] = [];
  return {
    taps,
    async tap(target: Locator, label: string) {
      await target.click();
      taps.push(label);
    },
    /** A tap on a control painted before hydration, retried until it lands. */
    async tapUntil(target: Locator, label: string, landed: Locator) {
      await expect(async () => {
        if (await target.isVisible()) {
          await target.click({ timeout: 2_000 });
          taps.push(label);
        }
        await expect(landed).toBeVisible({ timeout: 2_000 });
      }).toPass({ timeout: 45_000 });
    },
  };
}

async function quietFirstRun(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  // A production build sends sign-in to the live site. This journey never leaves the box.
  await page.context().route(/^https:\/\/([a-z0-9-]+\.)*pubmaxxing\.com\//, (route) => route.abort());
  await page.context().addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  });
  await installDeterministicMapBasemap(page);
}

/** The client request key a multipart Pint Drop POST carried. */
function clientRequestIdOf(body: string | null): string | undefined {
  return /name="clientRequestId"\r\n\r\n([^\r\n]+)/.exec(body ?? "")?.[1];
}

/** Which tab of the login page the new drinker uses: the default, or the one a stranger reads as theirs. */
type LoginDoor = "Sign in" | "New here";

async function newDrinkerLogsFirstPint(page: Page, door: LoginDoor): Promise<string[]> {
  const { taps, tap, tapUntil } = tapCounter();
  const email = `new-drinker-${randomBytes(8).toString("hex")}@example.test`;
  const handle = `drinker_${randomBytes(5).toString("hex")}`;
  await quietFirstRun(page);

  await page.goto("/");
  const picker = page.locator(".logIntentNearbyBtn").first();
  await tapUntil(
    page.locator(".lpHero").getByRole("link", { name: "Log what you paid" }),
    "Log what you paid",
    picker,
  );
  await expect(page).toHaveURL(/\/map\?log=1$/);

  const priceStep = page.getByTestId("spill-price-step");
  await tapUntil(picker, "pick the pub", priceStep);
  await expect(page, "the picked pub rides in the address").toHaveURL(/[?&]sel=/);
  const venueId = new URL(page.url()).searchParams.get("sel");

  const composer = page.getByRole("form", { name: "Pint Drop composer" });
  const venueName = (await composer.locator(".spillComposerIntro strong").textContent())?.trim();
  expect(venueName, "the composer names the pub").toBeTruthy();
  const price = priceStep.getByLabel("What did it cost?");
  await tap(price, "price field");
  await price.fill(NEW_DRINKER_PRICE);
  const pint = priceStep.getByRole("radio", { name: "Pint", exact: true });
  await tap(pint, "Pint");
  await expect(pint).toHaveAttribute("aria-checked", "true");

  await tap(composer.getByRole("link", { name: "Sign in to post" }), "Sign in to post");
  await expect(page).toHaveURL(/\/login\?/);
  if (door === "New here") {
    const tab = page.getByRole("tab", { name: "New here", exact: true });
    await tapUntil(tab, "New here", page.getByRole("heading", { name: "Make an account" }));
  }
  const emailForm = page.locator("form.authMagicLink");
  const emailField = emailForm.locator('input[type="email"]');
  await tap(emailField, "email field");
  await emailField.fill(email);
  await tap(emailForm.locator('button[type="submit"]'), "Email me a link");
  await expect(page.getByText(MAGIC_LINK_SENT_MESSAGE)).toBeVisible();

  // A phone mail app opens the link in a fresh tab: same browser storage, no
  // tab state from the page that asked for it. The account stays: it owns the
  // drop this journey proves, and the runner drops the whole database after.
  const link = await emailedSignInLink(page, email);
  const returned = await page.context().newPage();
  await returned.goto(link);
  taps.push("open the emailed link");

  const onboarding = returned.getByRole("dialog", { name: "Let's get you in", exact: true });
  await expect(onboarding).toBeVisible({ timeout: 30_000 });
  const handleField = onboarding.getByRole("textbox", { name: "Your handle", exact: true });
  await tap(handleField, "handle field");
  await handleField.fill(handle);
  await expect(onboarding.getByText("Handle available.", { exact: true })).toBeVisible();
  const [claimed] = await Promise.all([
    returned.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/identity/onboarding"),
    tap(onboarding.getByRole("button", { name: "Claim handle", exact: true }), "Claim handle"),
  ]);
  expect(claimed.ok(), "the new account claims its handle").toBe(true);
  await expect(onboarding).toBeHidden();
  await expect(returned, "the new account is back at the pub it was logging").toHaveURL(
    (url) => url.pathname === "/map" && url.searchParams.get("sel") === venueId && url.searchParams.get("log") === "1",
    { timeout: 30_000 },
  );

  const returnedComposer = returned.getByRole("form", { name: "Pint Drop composer" });
  await expect(returnedComposer.locator(".spillComposerIntro")).toContainText(venueName!);
  await expect(returnedComposer.getByLabel("What did it cost?")).toHaveValue(NEW_DRINKER_PRICE);
  await expect(returnedComposer.getByRole("radio", { name: "Pint", exact: true }))
    .toHaveAttribute("aria-checked", "true");
  await expect(returnedComposer.getByText(`@${handle}`)).toBeVisible();

  const dropPost = () => returned.waitForResponse((response) => response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/pint-drops");
  // A handle claimed without a date of birth has not yet said it is an adult.
  // Log it answers the adult refusal, the pub's sheet asks for the recorded
  // adult tap, and that tap finishes the same drop: no price is typed twice.
  const [refused] = await Promise.all([
    dropPost(),
    tap(returnedComposer.getByRole("button", { name: "Log it" }), "Log it"),
  ]);
  expect(refused.status(), "a new account owes the adult tap first").toBe(409);
  const sheet = returned.getByRole("dialog", { name: venueName!, exact: true });
  const [posted] = await Promise.all([
    dropPost(),
    tap(sheet.getByRole("button", { name: ADULT_SELF_ASSERTION_ACTION }), ADULT_SELF_ASSERTION_ACTION),
  ]);
  expect(posted.status(), "the adult tap writes the drop").toBe(201);
  const refusedKey = clientRequestIdOf(refused.request().postData());
  expect(refusedKey, "Log it sends a client request key").toBeTruthy();
  expect(clientRequestIdOf(posted.request().postData()), "the same request finishes").toBe(refusedKey);
  await expect(sheet.getByRole("button", { name: ADULT_SELF_ASSERTION_ACTION })).toBeHidden();

  const feed = await returned.request.get("/api/pint-drops");
  expect(feed.ok()).toBe(true);
  const { drops } = (await feed.json()) as {
    drops: Array<{ venueId: string; handle: string; priceGbp: number | null; measure?: string }>;
  };
  expect(
    drops.filter((drop) => drop.venueId === venueId
      && drop.handle.replace(/^@+/, "") === handle
      && drop.priceGbp === Number(NEW_DRINKER_PRICE)
      && (drop.measure ?? "pint") === "pint"),
    "a signed-out reader sees the new drinker's public drop",
  ).toHaveLength(1);
  return taps;
}

test("a new phone account goes from Log what you paid to a public Pint Drop", async ({ page }, testInfo) => {
  test.skip(
    process.env.PW_DISPOSABLE_PLAN_AUTH !== "1",
    "A new account needs real local Supabase Auth. The keyless server cannot verify an account.",
  );
  test.slow();
  const taps = await newDrinkerLogsFirstPint(page, "Sign in");
  testInfo.annotations.push({ type: "taps", description: `${taps.length}: ${taps.join(" > ")}` });
  console.log(`new drinker taps (Sign in door): ${taps.length}: ${taps.join(" > ")}`);
});

test("a new phone account that picks New here still lands back on its Pint Drop", async ({ page }, testInfo) => {
  test.skip(
    process.env.PW_DISPOSABLE_PLAN_AUTH !== "1",
    "A new account needs real local Supabase Auth. The keyless server cannot verify an account.",
  );
  test.slow();
  const taps = await newDrinkerLogsFirstPint(page, "New here");
  testInfo.annotations.push({ type: "taps", description: `${taps.length}: ${taps.join(" > ")}` });
  console.log(`new drinker taps (New here door): ${taps.length}: ${taps.join(" > ")}`);
});
