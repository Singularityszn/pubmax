#!/usr/bin/env node
// Captures the real Pub Pal screens the Pal cut is made from.
//
// Same rules as capture-screens.mjs: a production build of this checkout, a
// 390 x 844 phone at three device pixels per CSS pixel, the dark theme, and
// plain viewport screenshots that are never retouched. The journey, signed
// out, the way a first visitor meets the Pal:
//
//   1. /pal/chat, and the ask "Quick one after work in Clapham under £5".
//   2. The Pal's four sourced picks, the map it draws of them, and the cards.
//   3. "Use this pub" on one pick: the map keeps it for tonight.
//   4. "Make it Stop 1", the route Plan builds around it, "Lock it in" and
//      "Send to the crew".
//
// The route starts at the pub the Pal picked, so every screen in the cut is
// one consistent journey. (The Pal's "Open in Plan" draft carries the ask
// over, not its stops, so Plan can answer it with other pubs; the cut does
// not use it.)
//
// It writes pal-screens.json beside the captures: the position of each control
// the video points at, read from the page.
//
//   PUBMAX_CAPTURE_BASE=http://127.0.0.1:34567 node video/launch/capture-pal-screens.mjs

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
const ASK = "Quick one after work in Clapham under £5";
const PLAN_ASK = "Three pubs in Clapham for 4, not pricey";
const HOST = "Alex";
/** Which of the Pal's picks becomes Stop 1. It must sit in a crawl-ready area. */
const PICK = Number(env.PUBMAX_CAPTURE_PAL_PICK ?? 2);

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

/** Scrolls an element to a point in the viewport, inside whatever scrolls it. */
async function place(locator, top) {
  await locator.first().evaluate((element, offset) => {
    element.scrollIntoView({ block: "start" });
    let parent = element.parentElement;
    while (parent && parent.scrollHeight <= parent.clientHeight) parent = parent.parentElement;
    (parent ?? document.scrollingElement)?.scrollBy(0, -offset);
  }, top);
  await settle(1200);
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

// 1. The Pal's chat as a signed-out visitor first sees it, then the ask typed.
await step("pal-chat", async () => {
  await page.goto(`${BASE}/pal/chat`, { waitUntil: "load" });
  await page.locator(".palChatInput").waitFor({ timeout: 30000 });
  await settle(3000);
  await shoot("pal-chat");
  await page.locator(".palChatInput").fill(ASK);
  // A long ask scrolls the field to its end; put the caret back at the start
  // so the capture shows the ask from its first word, as a reader types it.
  await page.locator(".palChatInput").evaluate((element) => {
    element.setSelectionRange(0, 0);
    element.scrollLeft = 0;
  });
  await settle(800);
  marks.input = await box(page.locator(".palChatInput"));
  await shoot("pal-typed");
});

// 2. The answer: four sourced picks and the map of them.
await step("pal-picks", async () => {
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  const cards = page.locator(".palChatCard");
  await cards.nth(3).waitFor({ timeout: 30000 });
  await settle(3000);
  await place(page.locator(".palChatBubble", { hasText: ASK }), 96);
  marks.ask = await box(page.locator(".palChatBubble", { hasText: ASK }));
  marks.picksAnswer = await box(page.getByText("4 picks from the listed pubs, each with its source.", { exact: true }));
  marks.picksMap = await box(page.locator(".palChatMap"));
  await shoot("pal-picks");
});

// 3. The picked card and the one after it, each with its price and source.
await step("pal-cards", async () => {
  const cards = page.locator(".palChatCard");
  const first = Math.min(PICK, (await cards.count()) - 2);
  await place(cards.nth(first), 96);
  marks.pick = PICK - first;
  marks.cards = [];
  for (let i = first; i < first + 2; i += 1) {
    const card = cards.nth(i);
    marks.cards.push({
      card: await box(card),
      title: (await card.locator(".palChatCardTitle").innerText()).trim(),
      price: await box(card.locator(".palChatCardPrice")),
      source: await box(card.locator(".palChatProv")),
      sourceText: (await card.locator(".palChatProv").innerText()).trim(),
      use: await box(card.getByRole("link", { name: "Use this pub" })),
    });
  }
  await shoot("pal-cards");
});

// 4. "Use this pub" on the pick: the map keeps it for tonight.
await step("pal-kept", async () => {
  await page.locator(".palChatCard").nth(PICK).getByRole("link", { name: "Use this pub" }).click();
  await page.waitForURL(/\/map/, { timeout: 20000 });
  const kept = page.getByText(/^Kept for tonight/);
  await kept.first().waitFor({ timeout: 30000 });
  await settle(5000);
  marks.kept = await box(kept);
  marks.keptStop = await box(page.getByText("Make it Stop 1", { exact: true }));
  marks.keptPrice = await box(page.getByText(/^Listed · collected/));
  await shoot("pal-kept");
});

// 5. "Make it Stop 1", then the route Plan builds around the Pal's pick.
await step("pal-route", async () => {
  await page.getByText("Make it Stop 1", { exact: true }).first().click();
  await page.waitForURL(/\/plan(\?|$)/, { timeout: 20000 });
  await settle(3000);
  await page.getByPlaceholder(/Add a mood/).fill(PLAN_ASK);
  await page.getByRole("button", { name: "Make a plan" }).click();
  const stops = page.locator(".planStop__surface");
  await stops.nth(2).waitFor({ timeout: 30000 });
  await settle(3000);
  await page.evaluate(() => {
    const heading = document.querySelector("h1, h2");
    heading?.scrollIntoView({ block: "start" });
    window.scrollBy(0, -88);
  });
  await settle(1500);
  marks.stops = [];
  for (let i = 0; i < 3; i += 1) marks.stops.push(await box(stops.nth(i)));
  marks.stopNames = await stops.evaluateAll((all) =>
    all.map((element) => element.querySelector("h3, strong, p")?.textContent?.trim() ?? ""));
  await shoot("pal-route");
});

// 6. Lock it in, then the saved plan's share door, from the top of the page.
await step("pal-saved", async () => {
  await page.getByRole("textbox", { name: /your name/i }).fill(HOST);
  await page.getByRole("button", { name: "Lock it in" }).first().click();
  await page.waitForURL(/\/plan\/[^/?#]+/, { timeout: 30000 });
  const send = page.getByRole("link", { name: "Send to the crew" });
  await send.first().waitFor({ timeout: 20000 });
  await settle(4000);
  await page.evaluate(() => window.scrollTo(0, 0));
  await settle(1500);
  marks.sendToCrew = await box(send);
  await shoot("pal-saved");
});

marks.capturedAt = new Date().toISOString();
writeFileSync(join(HERE, "pal-screens.json"), `${JSON.stringify(marks, null, 2)}\n`);
console.log("wrote pal-screens.json");
await browser.close();
