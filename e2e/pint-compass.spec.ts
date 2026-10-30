import { mkdirSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

// /compass at phone size. The location is Soho's night-patch centre and the
// heading is a synthetic orientation event, so the spec drives the same
// listeners a phone does without a sensor. Shots land in the gitignored
// artifacts folder; the PR copies the ones it shows into docs/proof.

const SOHO = { latitude: 51.5136, longitude: -0.1365 };
const SHOTS = "artifacts/pint-compass";

test.use({ viewport: { width: 390, height: 844 } });

async function quietFirstRun(page: Page, theme: "light" | "dark") {
  await page.addInitScript((choice) => {
    localStorage.setItem("pubmax-theme", choice);
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  }, theme);
}

/** Replace the position watch with one fixed answer, or a refusal. */
async function stubPosition(page: Page, answer: "soho" | "denied") {
  await page.addInitScript(
    ({ answer, soho }) => {
      const geo = {
        watchPosition(success: PositionCallback, failure?: PositionErrorCallback | null) {
          window.setTimeout(() => {
            if (answer === "denied") {
              failure?.({ code: 1, message: "denied", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError);
              return;
            }
            success({
              coords: { ...soho, accuracy: 20, altitude: null, altitudeAccuracy: null, heading: null, speed: null },
              timestamp: Date.now(),
            } as GeolocationPosition);
          }, 50);
          return 1;
        },
        clearWatch() {},
        getCurrentPosition() {},
      };
      Object.defineProperty(navigator, "geolocation", { configurable: true, get: () => geo });
    },
    { answer, soho: SOHO },
  );
}

/** iOS shape: the sensor is behind a permission asked from the tap. */
async function stubIosOrientationPermission(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { DeviceOrientationEvent: { requestPermission?: () => Promise<string> }; __compassAsked?: number };
    w.__compassAsked = 0;
    w.DeviceOrientationEvent.requestPermission = async () => {
      w.__compassAsked = (w.__compassAsked ?? 0) + 1;
      return "granted";
    };
  });
}

async function removeOrientationSensor(page: Page) {
  await page.addInitScript(() => {
    delete (window as unknown as { DeviceOrientationEvent?: unknown }).DeviceOrientationEvent;
  });
}

async function faceHeading(page: Page, heading: number) {
  await page.evaluate((value) => {
    const event = new Event("deviceorientation");
    Object.assign(event, { webkitCompassHeading: value, alpha: null, absolute: false });
    window.dispatchEvent(event);
  }, heading);
}

/** The heading reading is smoothed, so a few readings settle the needle. */
async function settleHeading(page: Page, heading: number) {
  for (let i = 0; i < 12; i += 1) {
    await faceHeading(page, heading);
    await page.waitForTimeout(20);
  }
}

async function startCompass(page: Page) {
  const start = page.getByRole("button", { name: "Start the compass" });
  const card = page.locator(".pcCard");
  await expect(async () => {
    await start.click();
    await expect(card).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  return card;
}

for (const theme of ["light", "dark"] as const) {
  test(`${theme}: the needle points at the cheapest listed pint and says when you face it`, async ({ page }) => {
    mkdirSync(SHOTS, { recursive: true });
    await page.emulateMedia({ colorScheme: theme });
    await quietFirstRun(page, theme);
    await stubPosition(page, "soho");
    await stubIosOrientationPermission(page);
    const requests: string[] = [];
    page.on("request", (request) => requests.push(`${request.url()} ${request.postData() ?? ""}`));

    await page.goto("/compass");
    await expect(page.getByRole("heading", { level: 1, name: "Point me at a cheap pint" })).toBeVisible();
    await expect(page.getByText("We do not send your location to our server")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/390-${theme}-explainer.png` });

    const card = await startCompass(page);
    // The iOS ask ran from the tap.
    expect(await page.evaluate(() => (window as unknown as { __compassAsked?: number }).__compassAsked)).toBe(1);

    // A price is never bare: the card carries the /near source line.
    await expect(card.locator(".pcTrust")).toHaveText(/^On record · /);
    await expect(card.locator(".pcCount")).toHaveText(/^1 of \d+$/);
    const bearing = Number(await card.getAttribute("data-bearing"));
    expect(Number.isFinite(bearing)).toBe(true);

    await settleHeading(page, (bearing + 90) % 360);
    await expect(page.getByTestId("compass-direction")).toHaveText(/^Turn left \d+°\.$/);
    await expect(page.locator(".pcDial")).toHaveAttribute("data-aligned", "false");

    await settleHeading(page, bearing);
    await expect(page.getByTestId("compass-direction")).toHaveText("You are facing it.");
    await expect(page.locator(".pcDial")).toHaveAttribute("data-aligned", "true");
    await page.screenshot({ path: `${SHOTS}/390-${theme}-facing.png` });

    // Next cheapest steps through the list.
    const firstName = await card.locator(".pcName").textContent();
    await card.getByRole("button", { name: /Next cheapest/ }).click();
    await expect(card.locator(".pcCount")).toHaveText(/^2 of \d+$/);
    await expect(card.locator(".pcName")).not.toHaveText(firstName ?? "");

    // No request this page made carries the reader's position.
    const leaks = requests.filter((line) => /51\.51\d|-0\.13\d|lat=|lng=/.test(line));
    expect(leaks).toEqual([]);
  });
}

test("a phone with no compass gets the direction in words", async ({ page }) => {
  await quietFirstRun(page, "light");
  await stubPosition(page, "soho");
  await removeOrientationSensor(page);
  await page.goto("/compass");
  const card = await startCompass(page);
  await expect(page.getByTestId("compass-direction")).toHaveText(
    /^(north|north-east|east|south-east|south|south-west|west|north-west), \d+ min$/,
  );
  await expect(card.getByText("This phone is not sharing a compass heading")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/390-light-no-sensor.png` });
});

test("a refused location offers the areas, and an area answers", async ({ page }) => {
  await quietFirstRun(page, "dark");
  await page.emulateMedia({ colorScheme: "dark" });
  await stubPosition(page, "denied");
  await page.goto("/compass");
  await expect(async () => {
    await page.getByRole("button", { name: "Start the compass" }).click();
    await expect(page.getByText("Location access was denied.")).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await page.getByRole("group", { name: "Pick an area" }).getByRole("button", { name: "Soho" }).click();
  await expect(page.getByText("From the middle of Soho.")).toBeVisible();
  await expect(page.locator(".pcCard .pcTrust")).toHaveText(/^On record · /);
  await page.screenshot({ path: `${SHOTS}/390-dark-area.png` });
});

test("reduced motion draws the needle with no spin", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await quietFirstRun(page, "light");
  await stubPosition(page, "soho");
  await page.goto("/compass");
  await startCompass(page);
  const duration = await page.locator(".pcNeedle").evaluate((node) => getComputedStyle(node).transitionDuration);
  expect(duration).toBe("0s");
});
