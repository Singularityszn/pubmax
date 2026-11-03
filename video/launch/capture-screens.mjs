#!/usr/bin/env node
// Captures the real app screens the launch video is cut from.
//
// It drives a production build of this checkout at phone size (390 x 844 CSS
// pixels, three device pixels per CSS pixel, dark theme) through one honest
// journey: the London map, the Clapham pins, one pub card, "Make it Stop 1",
// the planner's route around that pub, and the saved plan's share controls.
// Each capture is a plain viewport screenshot. Nothing is retouched.
//
// It also writes screens.json: the position of each control the video points
// at, read from the page itself, so a highlight in the video sits exactly on
// the control and not where someone guessed it was.
//
//   PUBMAX_CAPTURE_BASE=http://127.0.0.1:34567 node video/launch/capture-screens.mjs
//
// Serve a keyless production build first (see video/launch/README.md). The
// planner answers from the committed data, so the stops, prices and dates in
// the captures are the ones the app shows for that data on the capture day.

import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { env, exit } from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const OUT = join(HERE, "public", "screens");
const BASE = env.PUBMAX_CAPTURE_BASE ?? "http://127.0.0.1:34567";
const SCALE = 3;
/** The pub the video features: the cheapest pin in the Clapham view. */
const PUB_ID = env.PUBMAX_CAPTURE_PUB ?? "venue-e3z1ob";
const PUB_NAME = env.PUBMAX_CAPTURE_PUB_NAME ?? "Feeley's";
const ASK = "Three pubs in Clapham for 4, not pricey";
const HOST = "Alex";

const require = createRequire(join(ROOT, "package.json"));
const { chromium } = require("@playwright/test");

const browser = await chromium.launch({
  executablePath: env.PLAYWRIGHT_CHROMIUM ?? "/opt/pw-browsers/chromium",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: SCALE,
  isMobile: true,
  hasTouch: true,
  colorScheme: "dark",
  locale: "en-GB",
  timezoneId: "Europe/London",
  serviceWorkers: "block",
  reducedMotion: "reduce",
});
// A returning visitor who has declined analytics and seen the first-run tour,
// so no consent card or tour covers the screens.
await context.addInitScript(() => {
  localStorage.setItem("pubmax-theme", "dark");
  localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  localStorage.setItem("pubmax-tour-v1-done", "1");
  localStorage.setItem("pubmax:map-first-visit-arrival:v1", "seen");
});
const page = await context.newPage();
mkdirSync(OUT, { recursive: true });

/** Positions in CSS pixels; the video multiplies by SCALE. */
const marks = { scale: SCALE, viewport: { width: 390, height: 844 } };

async function box(locator) {
  const found = await locator.first().boundingBox();
  if (!found) throw new Error(`No box for ${locator}`);
  return { x: found.x, y: found.y, w: found.width, h: found.height };
}

async function shoot(name) {
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log(`captured ${name}.png`);
}

async function settle(ms = 1500) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(ms);
}

async function step(name, run) {
  try {
    await run();
  } catch (error) {
    await page.screenshot({ path: join(OUT, `failed-${name}.png`) }).catch(() => {});
    console.error(`Step ${name} failed: ${error.message}`);
    await browser.close();
    exit(1);
  }
}

// 1. The London map as a first-time arrival sees it, with the arrival strip
//    closed so the pins are clear.
await step("map-london", async () => {
  await page.goto(`${BASE}/map`, { waitUntil: "load" });
  await page.locator(".mobileMapTopbar").waitFor({ timeout: 30000 });
  await settle(6000);
  const strip = page.getByRole("button", { name: /^(close|dismiss)/i });
  if (await strip.count()) await strip.first().click();
  await settle(2500);
  await shoot("map-london");
});

// 2. Clapham: the area arrival, with its sheet closed to show the price pins.
await step("map-clapham", async () => {
  await page.goto(`${BASE}/map?area=clapham`, { waitUntil: "load" });
  await page.locator(".mobileMapTopbar").waitFor({ timeout: 30000 });
  await settle(6000);
  await page.getByRole("button", { name: /close/i }).first().click();
  await settle(3500);
  const pins = await page.evaluate(() => {
    const probe = window.__pubmaxPaintedMapTapPoints;
    return typeof probe === "function" ? probe() : [];
  });
  const pin = pins.find((point) => point.id === PUB_ID);
  if (!pin) throw new Error(`${PUB_ID} is not painted in the Clapham view`);
  marks.pin = { x: pin.x, y: pin.y };
  marks.cheapestCard = await box(page.getByText("Cheapest in this view"));
  await shoot("map-clapham");
  marks.pinTap = { x: pin.x, y: pin.y };
});

// 3. The pub card, opened by tapping the pin.
await step("map-pub", async () => {
  await page.touchscreen.tap(marks.pinTap.x, marks.pinTap.y);
  await page.getByRole("heading", { name: PUB_NAME }).first().waitFor({ timeout: 15000 });
  await settle(3000);
  marks.pubName = await box(page.getByRole("heading", { name: PUB_NAME }));
  marks.pubSign = await box(page.getByText(/Illustrated sign/));
  marks.pubPrice = await box(page.getByText(/^Listed · collected/));
  marks.pubStop = await box(page.getByText("Make it Stop 1", { exact: true }));
  marks.pubShare = await box(page.getByRole("button", { name: /^Share/ }));
  await shoot("map-pub");
});

// 4. "Make it Stop 1" hands the pub to Plan, which builds the route around it.
await step("plan-route", async () => {
  await page.getByText("Make it Stop 1", { exact: true }).first().click();
  await page.waitForURL(/\/plan(\?|$)/, { timeout: 20000 });
  await settle(3000);
  await page.getByPlaceholder(/Add a mood/).fill(ASK);
  await page.getByRole("button", { name: "Make a plan" }).click();
  const stops = page.locator(".planStop__surface");
  await stops.nth(2).waitFor({ timeout: 30000 });
  await settle(3000);
  // Bring the route heading to the top of the screen, under the app bar.
  await page.evaluate(() => {
    const heading = document.querySelector("h1, h2");
    heading?.scrollIntoView({ block: "start" });
    window.scrollBy(0, -88);
  });
  await settle(1500);
  marks.stops = [];
  for (let i = 0; i < 3; i += 1) marks.stops.push(await box(stops.nth(i)));
  await shoot("plan-route");
});

// 5. The route map the planner drew for the same three stops.
await step("plan-map", async () => {
  const caption = page.getByText("Dashed lines show stop order only.");
  await caption.first().evaluate((element) => element.scrollIntoView({ block: "start" }));
  await page.evaluate(() => window.scrollBy(0, -96));
  await settle(3500);
  marks.routeCaption = await box(caption);
  await shoot("plan-map");
});

// 6. Lock it in, then the saved plan's own share door.
await step("plan-saved", async () => {
  await page.getByRole("textbox", { name: /your name/i }).fill(HOST);
  await page.getByRole("button", { name: "Lock it in" }).first().click();
  await page.waitForURL(/\/plan\/[^/?#]+/, { timeout: 30000 });
  const send = page.getByRole("link", { name: "Send to the crew" });
  await send.first().waitFor({ timeout: 20000 });
  await settle(4000);
  marks.sendToCrew = await box(send);
  marks.tonightSorted = await box(page.getByText("Tonight, sorted", { exact: true }));
  await shoot("plan-saved");
});

// 7. The share block "Send to the crew" jumps to.
await step("plan-share", async () => {
  const whatsapp = page.getByRole("link", { name: /Send on WhatsApp/ });
  await whatsapp.first().scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 160));
  await settle(2000);
  marks.whatsapp = await box(whatsapp);
  marks.copyInvite = await box(page.getByRole("button", { name: /Copy invite link/ }));
  marks.getCrewIn = await box(page.getByText("Get the crew in", { exact: true }));
  await shoot("plan-share");
  marks.planUrlPath = new URL(page.url()).pathname;
});

marks.capturedAt = new Date().toISOString();
writeFileSync(join(HERE, "screens.json"), `${JSON.stringify(marks, null, 2)}\n`);
console.log("wrote screens.json");
await browser.close();
