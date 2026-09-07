import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { installAuthDoubles } from "./helpers/authDoubles";
import { attachBill } from "./helpers/priceBill";

/**
 * ONE RULE (captain, 5 Sep 2026). The contribution gate takes the recorded
 * adult tap as the age answer, so a drinker who claimed a handle and never gave
 * a birth date logs a price here: the refusal opens the age door, the door
 * records the tap through `/api/identity/adult-assertion`, and the price the
 * drinker already typed goes where they sent it.
 *
 * The keyless e2e server verifies no bearer, so the write is answered by a
 * route mock in the shape the gate answers (`__tests__/contributionAgeAnswer`
 * pins the server's own reading). What is proved here is the browser half: the
 * door that opens, the words on it, and the resumed write.
 */
test.use({
  launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
  viewport: { width: 390, height: 844 },
});

const UNPRICED = "venue-1kt3p9o";
const SHOT_DIR = resolve(
  process.cwd(),
  "docs/proof/contribution-age-door",
  process.env.PW_PROOF_LANE ?? "after",
);
const SHOOTING = process.env.PW_PROOF_SHOTS === "1";
const SHOT_SIZES = [
  { name: "390", width: 390, height: 844 },
  { name: "768", width: 768, height: 1024 },
  { name: "1440", width: 1440, height: 900 },
] as const;

type GateAnswer = { status: string; error: string; code: string } | null;

/** The gate's answer to the write, swapped once the tap is recorded. */
async function serveGate(page: Page, state: { answer: GateAnswer }) {
  await page.route("**/api/pint-drops**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ drops: [] }),
    }),
  );
  await page.route("**/api/price-submit**", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const refusal = state.answer;
    if (!refusal) {
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          attribution: { status: "credited", handle: "karan" },
          price: {
            priceGbp: 4.4,
            drinkCategory: "beer",
            source: "community",
            submittedAt: Date.now(),
            corroborations: 1,
          },
        }),
      });
    }
    return route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify(refusal),
    });
  });
  await page.route("**/api/identity/adult-assertion**", async (route) => {
    state.answer = null;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ assertedAt: new Date().toISOString() }),
    });
  });
}

/**
 * The venue surface, whichever frame this width owns: the phone's shared sheet
 * under 641, the desktop drawer above it. Both render the same inspector, and
 * the sheet mounts only inside the phone shell, so a shot at another width has
 * to be driven from its own navigation rather than by resizing this one.
 */
async function openVenueSurface(page: Page) {
  const inspector = page.locator(".venueInspector");
  const expand = page.getByRole("button", { name: "Expand sheet" });
  await expect
    .poll(async () => (await inspector.isVisible()) || (await expand.isVisible()), {
      timeout: 60_000,
    })
    .toBe(true);
  if (!(await inspector.isVisible()) && (await expand.isVisible())) await expand.click();
  await expect(inspector).toBeVisible();
  return inspector;
}

async function typeAndLog(page: Page): Promise<void> {
  const sheet = await openVenueSurface(page);
  const door = sheet.locator('[data-price-door="log"]');
  await expect(door).toBeVisible({ timeout: 30_000 });
  const submit = sheet.locator(".venuePriceSubmit");
  await expect(async () => {
    await door.click();
    await expect(submit).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 20_000 });
  await sheet.getByRole("textbox", { name: /Price of a beer at/ }).fill("4.40");
  await expect(async () => {
    await attachBill(sheet);
    await sheet.getByRole("button", { name: "Log it" }).click();
    await expect(page.locator(".contributionGate")).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 25_000 });
}

/**
 * One shot per width, each from its own navigation. Nothing is resized under a
 * live dialog: the phone sheet unmounts above 640, and a resized shot would be
 * a picture of a surface this width never draws.
 */
async function shoot(
  page: Page,
  state: { answer: GateAnswer },
  name: string,
): Promise<void> {
  if (!SHOOTING) return;
  const refusal = state.answer;
  mkdirSync(SHOT_DIR, { recursive: true });
  for (const size of SHOT_SIZES) {
    state.answer = refusal;
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto(`/map?sel=${UNPRICED}`);
    await typeAndLog(page);
    await expect(page.locator(".contributionGate")).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/${name}-${size.name}.png` });
  }
}

test.setTimeout(180_000);

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  });
});

test("the age door asks for one tap and never for a birth date", async ({ page }) => {
  const state = {
    answer: {
      status: "adult_check_required",
      error: "Confirm you are 18 or over before contributing.",
      code: "ADULT_CHECK_REQUIRED",
    } as GateAnswer,
  };
  const stub = await installAuthDoubles(page);
  await serveGate(page, state);
  await page.goto("/");
  await stub.signedInAs("A");
  await page.goto(`/map?sel=${UNPRICED}`);
  await typeAndLog(page);

  const gate = page.locator(".contributionGate");
  await expect(gate.getByRole("heading")).toHaveText("Confirm your age");
  await expect(gate).not.toContainText(/date of birth/i);
  await expect(gate.locator('input[type="date"]')).toHaveCount(0);
  const tap = gate.getByRole("button", { name: /18 or over/ });
  await expect(tap).toBeVisible();
  expect((await tap.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

  await shoot(page, state, "age-door");
});

test("the recorded tap sends the price the drinker already typed", async ({ page }) => {
  const state = {
    answer: {
      status: "adult_check_required",
      error: "Confirm you are 18 or over before contributing.",
      code: "ADULT_CHECK_REQUIRED",
    } as GateAnswer,
  };
  const stub = await installAuthDoubles(page);
  await serveGate(page, state);
  await page.goto("/");
  await stub.signedInAs("A");
  await page.goto(`/map?sel=${UNPRICED}`);
  await typeAndLog(page);

  await page.locator(".contributionGate").getByRole("button", { name: /18 or over/ }).click();
  await expect(page.locator(".contributionGate")).toHaveCount(0, { timeout: 20_000 });
  // The receipt prints the figure the drinker sent, so the resumed write is
  // the SAME price rather than a second attempt they had to retype.
  await expect(page.locator(".vpsubStampPrice").first()).toHaveText("£4.40", {
    timeout: 20_000,
  });
});

test("the door is the viewport's at every width, never the drawer's", async ({
  page,
}) => {
  // The dialog is opened from inside the desktop map drawer, a transformed and
  // filtered box, which was the containing block for its fixed backdrop: the
  // panel sat above the viewport with only "Not now" reachable.
  const state = {
    answer: {
      status: "adult_check_required",
      error: "Confirm you are 18 or over before contributing.",
      code: "ADULT_CHECK_REQUIRED",
    } as GateAnswer,
  };
  const stub = await installAuthDoubles(page);
  await serveGate(page, state);
  await page.goto("/");
  await stub.signedInAs("A");

  for (const size of SHOT_SIZES) {
    const refusal = state.answer;
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto(`/map?sel=${UNPRICED}`);
    await typeAndLog(page);
    const panel = page.locator(".contributionGate");
    await expect(panel).toBeVisible();
    const box = await panel.boundingBox();
    expect(box, `${size.name}: the panel has a box`).not.toBeNull();
    expect(box!.y, `${size.name}: the panel starts inside the viewport`).toBeGreaterThanOrEqual(0);
    expect(
      box!.y + box!.height,
      `${size.name}: the panel ends inside the viewport`,
    ).toBeLessThanOrEqual(size.height + 1);
    await expect(
      page.locator(".contributionGate").getByRole("button", { name: /18 or over/ }),
    ).toBeInViewport();
    state.answer = refusal;
  }
});

test("the handle door asks for a handle alone", async ({ page }) => {
  const state = {
    answer: {
      status: "onboarding_required",
      error: "Choose a public handle before contributing.",
      code: "ONBOARDING_REQUIRED",
    } as GateAnswer,
  };
  const stub = await installAuthDoubles(page);
  await serveGate(page, state);
  await page.goto("/");
  await stub.signedInAs("A");
  await page.goto(`/map?sel=${UNPRICED}`);
  await typeAndLog(page);

  const gate = page.locator(".contributionGate");
  await expect(gate).not.toContainText(/date of birth/i);
  await expect(gate.getByRole("link", { name: "Choose a handle" })).toBeVisible();
  // A door that ASKS prints no alarm line: the gate's own refusal sentence is
  // what the heading and the button already say.
  await expect(gate.locator(".contributionGateError")).toHaveCount(0);

  await shoot(page, state, "handle-door");
});
