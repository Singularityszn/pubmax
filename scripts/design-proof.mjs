#!/usr/bin/env node
// THE DESIGN PROOF COMMAND: one run shoots the pages a design change touches,
// at the phone width and the desktop width, light and dark, from a production
// server, and writes one PNG per shot plus one contact sheet. Every design
// pull request attaches that sheet (docs/plans/DESIGN_UX_PLAN.md, step 0.4).
//
//   npm run proof:design -- --base-url http://127.0.0.1:4438 \
//     --page home=/ --page pub=/pubs/venue-qall4d --out artifacts/design-proof/after \
//     --before artifacts/design-proof/before
//
// `--start` serves the production build already on disk (`npm run start`,
// which refuses a missing build) on a private port and stops it afterwards.
// `--before <dir>` puts that folder's shots of the same pages in a row above
// this run's, so the sheet reads before and after. The matrix, the file names
// and the sheet layout live in scripts/lib/designProof.mjs. Documented in
// e2e/AGENTS.md, "Browser evidence for agents".
//
// It drives the repo's own Playwright and the shared browser cache (e2e/AGENTS.md,
// "ONE BROWSER CACHE, ONE PLAYWRIGHT VERSION"); it never installs a browser.
// PUBMAX_PROOF_PLAYWRIGHT names another installed Playwright package for a host
// whose cache holds a different Chromium revision.

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

import sharp from "sharp";

import {
  contactSheetColumns,
  contactSheetLayout,
  designProofShots,
  parseDesignProofArgs,
  proofShotFile,
  THEME_STORAGE_KEY,
} from "./lib/designProof.mjs";
import { UI_UX_CHROMIUM_ARGS } from "./lib/uiUxBattleTestBrowser.mjs";

const SHEET_FILE = "contact-sheet.png";

async function loadChromium() {
  const override = process.env.PUBMAX_PROOF_PLAYWRIGHT;
  if (override) return createRequire(import.meta.url)(resolve(override)).chromium;
  return (await import("playwright")).chromium;
}

async function waitForServer(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/version`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`no server answered at ${baseUrl} within ${timeoutMs / 1000}s`);
}

/**
 * A production server only. `next dev` renders the prerendered home page on
 * every request, so it never says the document was prerendered; a proof shot
 * from it would show development-only chrome and unoptimised CSS.
 */
async function assertProductionServer(baseUrl) {
  const response = await fetch(`${baseUrl}/`);
  if (!response.headers.get("x-nextjs-prerender") && !response.headers.get("x-vercel-cache")) {
    throw new Error(
      `${baseUrl}/ was not served from a production build (no prerender header). ` +
        "Build and serve with NEXT_DIST_DIR=.next-prod, as e2e/AGENTS.md says.",
    );
  }
}

function startServer(port) {
  const env = {
    ...process.env,
    PORT: String(port),
    // The same keyless allowances a hand-started e2e server carries (e2e/AGENTS.md).
    PLAN_IDEMPOTENCY_SECRET: process.env.PLAN_IDEMPOTENCY_SECRET ?? randomBytes(32).toString("hex"),
    PUBMAX_E2E_KEYLESS: "1",
    PUBMAX_E2E_RATE_LIMIT_MAX: process.env.PUBMAX_E2E_RATE_LIMIT_MAX ?? "10000",
    NEXT_PUBLIC_SW_VERSION: process.env.NEXT_PUBLIC_SW_VERSION ?? "local",
  };
  const child = spawn("npm", ["run", "start", "--", "--port", String(port)], {
    env,
    stdio: ["ignore", "inherit", "inherit"],
    detached: true,
  });
  return () => {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  };
}

/** Let the page finish drawing: the network, the fonts, then every animation. */
async function settle(page, settleMs) {
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const running = await page.evaluate(
      () => document.getAnimations().filter((animation) => animation.playState === "running").length,
    );
    if (running === 0) break;
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(settleMs);
}

async function shoot(browser, baseUrl, shot, outDir, options) {
  const { viewport, theme } = shot;
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.deviceScaleFactor,
    isMobile: viewport.isMobile,
    hasTouch: viewport.hasTouch,
    colorScheme: theme,
    reducedMotion: "reduce",
    // A service worker would serve the last build's pages to the next run.
    serviceWorkers: "block",
  });
  await context.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, value);
      // A returning reader: the first-run tour, onboarding and the analytics
      // ask have been answered, so none of them covers the page under proof.
      window.localStorage.setItem("pubmax-tour-v2-done", "1");
      window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    },
    { key: THEME_STORAGE_KEY, value: theme },
  );
  const page = await context.newPage();
  try {
    const response = await page.goto(`${baseUrl}${shot.page.path}`, { waitUntil: "load", timeout: 90_000 });
    if (!response || response.status() >= 400) {
      throw new Error(`${shot.page.path} answered ${response?.status() ?? "nothing"}`);
    }
    await settle(page, options.settleMs);
    const file = join(outDir, shot.file);
    await page.screenshot({ path: file, fullPage: options.fullPage });
    console.log(`wrote ${file}`);
  } finally {
    await context.close();
  }
}

function escapeXml(text) {
  return text.replace(/[<>&"]/g, (character) => `&#${character.charCodeAt(0)};`);
}

async function tileFor(file) {
  if (!existsSync(file)) return null;
  const { width, height } = await sharp(file).metadata();
  return { file, width, height };
}

async function writeContactSheet(outDir, pages, beforeDir, maxTileHeight) {
  const columns = contactSheetColumns();
  const rows = [];
  for (const page of pages) {
    const sources = beforeDir ? [["before", beforeDir], ["after", outDir]] : [["", outDir]];
    for (const [when, dir] of sources) {
      const tiles = await Promise.all(
        columns.map((column) => tileFor(join(dir, proofShotFile(page.name, column.viewportKey, column.theme)))),
      );
      rows.push({ label: when ? `${page.name} ${page.path}: ${when}` : `${page.name} ${page.path}`, tiles });
    }
  }
  const layout = contactSheetLayout(rows, { maxTileHeight });
  const composites = [];
  for (const placement of layout.placements) {
    const tile = rows.find((row) => row.label === placement.rowLabel).tiles[placement.column];
    const scaled = await sharp(tile.file).resize({ width: placement.width }).toBuffer();
    const input = placement.cropped
      ? await sharp(scaled).extract({ left: 0, top: 0, width: placement.width, height: placement.height }).toBuffer()
      : scaled;
    composites.push({ input, left: placement.x, top: placement.y });
  }
  const labels = layout.labels
    .map(
      (label) =>
        `<text x="${label.x}" y="${label.y + 20}" font-family="sans-serif" font-size="18" fill="#1b1b1b">${escapeXml(label.text)}</text>`,
    )
    .join("");
  composites.push({
    input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}">${labels}</svg>`),
    left: 0,
    top: 0,
  });
  const file = join(outDir, SHEET_FILE);
  await sharp({ create: { width: layout.width, height: layout.height, channels: 3, background: "#e9e6e1" } })
    .composite(composites)
    .png()
    .toFile(file);
  console.log(`wrote ${file}`);
}

async function main() {
  const options = parseDesignProofArgs(process.argv.slice(2));
  const outDir = resolve(options.outDir ?? join("artifacts", "design-proof", new Date().toISOString().replace(/[:.]/g, "-")));
  await mkdir(outDir, { recursive: true });
  const port = options.port ?? 30_000 + (process.pid % 10_000);
  const baseUrl = options.baseUrl ?? `http://127.0.0.1:${port}`;
  const stopServer = options.start ? startServer(port) : () => {};
  let browser = null;
  try {
    await waitForServer(baseUrl, options.start ? 120_000 : 10_000);
    await assertProductionServer(baseUrl);
    const chromium = await loadChromium();
    browser = await chromium.launch({ args: [...UI_UX_CHROMIUM_ARGS] });
    for (const shot of designProofShots(options.pages)) {
      await shoot(browser, baseUrl, shot, outDir, options);
    }
    const before = options.before ? resolve(options.before) : null;
    if (before && !existsSync(before)) throw new Error(`--before folder ${before} does not exist`);
    await writeContactSheet(outDir, options.pages, before, 1800);
    const version = await fetch(`${baseUrl}/api/version`).then((response) => response.text());
    console.log(`server ${baseUrl}: ${version}`);
  } finally {
    await browser?.close();
    stopServer();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
