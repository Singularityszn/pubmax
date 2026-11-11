import { expect, test, type Locator, type Page } from "@playwright/test";

import { ACCOUNTS, installAuthDoubles } from "./helpers/authDoubles";
import { COMMUNITY_SHEET_FIXTURE_VENUE_ID } from "./helpers/communitySheetFixture";
import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";
import { attachSpillBill } from "./helpers/priceBill";

// Browser UI coverage only. Provider authentication and age responses are
// explicit doubles. Server policy and DOB precedence belong to route tests.
// All priced requests here must use the real Pint Drop composer and endpoint.
test.use({ launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } });

const VENUE_ID = COMMUNITY_SHEET_FIXTURE_VENUE_ID;
const PRICE = "5.50";
const DRINK = "Fixture pale ale";
const REQUIRED = "Confirm you are 18 or over before contributing.";
const REFUSED = "This account cannot contribute prices.";
type Age = "missing" | "under18" | "asserted";

async function installLane(page: Page, initial: Age) {
  let age = initial;
  const posts: { price: string; drink: string; receiptName: string }[] = [];
  let successes = 0;
  let assertions = 0;
  let priceSubmitPosts = 0;
  let socialAccessReads = 0;
  const drops: Record<string, unknown>[] = [];

  await page.route("**/api/price-submit**", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    priceSubmitPosts += 1;
    await route.fulfill({ status: 500, json: { error: "Wrong price endpoint for this probe." } });
  });
  await page.route("**/api/pint-drops**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname !== "/api/pint-drops") return route.fallback();
    if (request.method() === "GET") {
      await route.fulfill({ json: { drops: url.searchParams.has("venueId") && url.searchParams.get("venueId") !== VENUE_ID ? [] : drops } });
      return;
    }
    expect(request.method()).toBe("POST");
    expect(request.headers()["content-type"]).toContain("multipart/form-data;");
    const body = request.postDataBuffer();
    expect(body).not.toBeNull();
    const form = await new Response(new Uint8Array(body!), {
      headers: { "Content-Type": request.headers()["content-type"]! },
    }).formData();
    expect(form.get("venueId")).toBe(VENUE_ID);
    expect(form.get("handle")).toBe(ACCOUNTS.A.handle);
    expect(form.get("priceGbp")).toBe(PRICE);
    expect(form.get("drink")).toBe(DRINK);
    const receipt = form.get("receipt_photo");
    expect(receipt).not.toBeNull();
    expect(typeof receipt).not.toBe("string");
    // Chromium omits file bytes from intercepted multipart request bodies.
    // Check the rendered bill preview before submission and its name here.
    const receiptName = receipt && typeof receipt !== "string" ? receipt.name : "";
    expect(receiptName).toBe("bill.jpg");
    posts.push({ price: String(form.get("priceGbp")), drink: String(form.get("drink")), receiptName });
    if (age !== "asserted") {
      await route.fulfill({ status: 409, json: {
        code: "ADULT_REQUIRED",
        status: age === "missing" ? "adult_check_required" : "adult_check_failed",
        error: age === "missing" ? REQUIRED : REFUSED,
      } });
      return;
    }
    successes += 1;
    const drop = {
      id: "f924cf8c-bc2c-4c7d-9b30-4b12fa80f87e", venueId: VENUE_ID,
      handle: ACCOUNTS.A.handle, drink: DRINK, priceGbp: 5.5,
      passedDownNote: "", era: "", vibeTags: [], visibility: "public",
      provenance: "contributor", status: "visible", createdAt: new Date().toISOString(),
      pintPhotoUrl: null, venuePhotoUrl: null,
    };
    drops.splice(0, drops.length, drop);
    await route.fulfill({ status: 201, json: { drop } });
  });
  await page.route("**/api/social/access", async (route) => {
    socialAccessReads += 1;
    await route.fulfill({ status: 503, json: {
      state: "unavailable", adultPrompt: false,
    } });
  });
  await page.route("**/api/identity/adult-assertion", async (route) => {
    expect(route.request().method()).toBe("POST");
    assertions += 1;
    expect(age).toBe("missing");
    age = "asserted";
    await route.fulfill({ json: { assertedAt: new Date().toISOString() } });
  });
  return { posts, state: () => ({ age, successes, assertions, priceSubmitPosts, socialAccessReads }) };
}

async function openComposer(page: Page) {
  const expand = page.getByRole("button", { name: "Expand sheet", exact: true });
  await expect.poll(async () => (await page.locator(".venueInspector:visible").count()) > 0 || await expand.isVisible()).toBe(true);
  if (!(await page.locator(".venueInspector:visible").count()) && await expand.isVisible()) await expand.click();
  const inspector = page.locator(".venueInspector:visible").first();
  const pints = inspector.locator("#venuePanel-pints");
  await expect(async () => {
    await inspector.getByRole("tab", { name: "Prices", exact: true }).click();
    await expect(pints).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  const form = pints.getByRole("form", { name: "Pint Drop composer", exact: true });
  if (!(await form.isVisible())) {
    await expect(async () => {
      await pints.getByRole("button", { name: /^Log a Pint Drop at / }).click();
      await expect(form).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
  }
  await expect(form).not.toHaveAttribute("aria-busy", "true");
  return { pints, form };
}

async function submitPrice(page: Page) {
  const { pints, form } = await openComposer(page);
  await form.getByTestId("spill-price-step").locator("input").first().fill(PRICE);
  await form.getByLabel("Drink", { exact: true }).fill(DRINK);
  await attachSpillBill(form);
  await expect.poll(() => form.getByRole("img", { name: "Preview of the bill behind your price", exact: true })
    .evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  const button = form.getByRole("button", { name: "Log it", exact: true });
  await expect(button).toBeEnabled();
  // A write is clicked once. Only non-writing hydration taps above may retry.
  await button.click();
  await expect(form).toBeHidden();
  return pints;
}

async function expectRecoveryInView(button: Locator) {
  // The design system requires a 44px target. Check the whole control before
  // Playwright can scroll it or click it past a covering sheet footer.
  await expect.poll(() => button.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const centreX = box.left + box.width / 2;
    const centreY = box.top + box.height / 2;
    // Edge midpoints stay inside the rounded shape and detect footer overlap.
    const points = [
      [centreX, centreY],
      [centreX, box.top + 2], [centreX, box.bottom - 2],
      [box.left + 2, centreY], [box.right - 2, centreY],
    ];
    return box.height >= 44 && box.width >= 44
      && box.top >= 0 && box.bottom <= window.innerHeight
      && box.left >= 0 && box.right <= window.innerWidth
      && points.every(([x, y]) => element.contains(document.elementFromPoint(x, y)));
  })).toBe(true);
}

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  test.describe(`Pint Drop age refusal at ${viewport.width}`, () => {
    test.use({ viewport, storageState: { cookies: [], origins: [] }, serviceWorkers: "block" });
    test.setTimeout(120_000);
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.addInitScript(() => {
        localStorage.setItem("pubmax-tour-v1-done", "1");
        localStorage.setItem("pubmax_onboarding_dismissed", "1");
        sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
        localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
        sessionStorage.setItem("pubmax:citySuggestDismiss:v1", "1");
      });
      await installDeterministicMapBasemap(page);
    });

    test("missing age recovers in place with Social access disabled, then finishes the held price", async ({ page }) => {
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      const auth = await installAuthDoubles(page);
      const lane = await installLane(page, "missing");
      await page.goto("/");
      await auth.signedInAs("A");
      await page.goto(`/map?sel=${VENUE_ID}`);
      const pints = await submitPrice(page);
      const folded = pints.locator(".logDropBar .composerMsg.error");
      await expect(folded).toContainText(REQUIRED);
      const foldedAssertion = folded.getByRole("button", { name: "I'm 18 or over", exact: true });
      await expect(foldedAssertion).toBeVisible();
      await expectRecoveryInView(foldedAssertion);
      expect(lane.posts).toHaveLength(1);
      expect(lane.state()).toMatchObject({ successes: 0, assertions: 0, priceSubmitPosts: 0 });
      await page.screenshot({ path: test.info().outputPath("folded-age-refusal.png") });

      const { form } = await openComposer(page);
      const assertion = form.getByRole("button", { name: "I'm 18 or over", exact: true });
      await expect(assertion).toBeVisible();
      await expectRecoveryInView(assertion);
      await expect(form.locator('[role="alert"]')).toContainText(REQUIRED);
      await page.screenshot({ path: test.info().outputPath("open-age-refusal.png") });
      await assertion.click();
      await expect.poll(() => lane.state().assertions).toBe(1);
      await expect(assertion).toBeHidden();
      await expect.poll(() => lane.state().successes).toBe(1);
      await expect(page).toHaveURL(new RegExp(`/map\\?sel=${VENUE_ID}`));
      await expect(form.locator(".composerMsg.ok")).toBeVisible();
      await expect(form.locator(".composerMsg.error")).toHaveCount(0);
      expect(lane.posts).toHaveLength(2);
      expect(lane.state()).toMatchObject({ successes: 1, assertions: 1, priceSubmitPosts: 0, socialAccessReads: 0 });
      expect(pageErrors).toEqual([]);
      await page.screenshot({ path: test.info().outputPath("age-confirmation-success.png") });
    });

    test("under-18 refusal offers no assertion action in either composer state", async ({ page }) => {
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      const auth = await installAuthDoubles(page);
      const lane = await installLane(page, "under18");
      await page.goto("/");
      await auth.signedInAs("A");
      await page.goto(`/map?sel=${VENUE_ID}`);
      const pints = await submitPrice(page);
      await expect(pints.locator(".logDropBar .composerMsg.error")).toHaveText(REFUSED);
      await expect(pints.getByRole("link", { name: "Confirm your age", exact: true })).toHaveCount(0);
      await expect(pints.getByRole("button", { name: "I'm 18 or over", exact: true })).toHaveCount(0);
      const { form } = await openComposer(page);
      await expect(form.locator('[role="alert"]')).toContainText(REFUSED);
      await expect(form.getByRole("link", { name: "Confirm your age", exact: true })).toHaveCount(0);
      await expect(form.getByRole("button", { name: "I'm 18 or over", exact: true })).toHaveCount(0);
      expect(lane.posts).toHaveLength(1);
      expect(lane.state()).toMatchObject({ successes: 0, assertions: 0, priceSubmitPosts: 0 });
      expect(pageErrors).toEqual([]);
      await page.screenshot({ path: test.info().outputPath("under18-no-assertion.png") });
    });
  });
}
