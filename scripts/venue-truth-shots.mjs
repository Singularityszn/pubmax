/**
 * Proof shots for the venue truth contract lane (Astra F03).
 *
 * Two surfaces at four widths, light and dark: the /today cheap-pints card
 * (which files a row under an area heading) and the venue sheet Overview for
 * the audited pub (whose amenity row drew a chip per unknown column).
 *
 * Usage: node scripts/venue-truth-shots.mjs --base-url http://127.0.0.1:PORT --label before
 */
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const arg = (name, fallback) =>
  process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;

const baseUrl = arg("--base-url", "http://127.0.0.1:3000");
const label = arg("--label", "shot");
const outDir = join(process.cwd(), "docs", "proof", "venue-truth-contract", label);

const WIDTHS = [
  { w: 320, h: 568 },
  { w: 390, h: 844 },
  { w: 768, h: 1024 },
  { w: 1440, h: 900 },
];

// The pub Astra measured: blank amenity columns, a website URL in the phone
// column, and unknown opening hours.
const VENUE_ID = "venue-p7p18j";
// A pub whose source DOES state amenities, so the chips that survive are
// visible beside the ones that go.
const STATED_VENUE_ID = "venue-3kkk8e";

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader-webgl"],
});

async function shot(surface, url, size, theme, settle) {
  const context = await browser.newContext({
    viewport: { width: size.w, height: size.h },
    colorScheme: theme,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await page.addInitScript((t) => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmax_analytics_consent", "declined");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    document.documentElement.dataset.theme = t;
  }, theme);
  const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
  if (!res || res.status() >= 400) throw new Error(`${url} -> ${res?.status()}`);
  await settle(page);
  const file = join(outDir, `${surface}-${size.w}-${theme}.png`);
  await page.screenshot({ path: file, fullPage: surface === "today" });
  console.log(`wrote ${file}`);
  await context.close();
}

const settleToday = async (page) => {
  await page.waitForSelector('[data-testid="today-pints"]', { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(1_500);
};

/**
 * The amenity row sits well below the fold of both frames, so the shot has to
 * reach it. On a phone the sheet is opened to its full snap first; then the one
 * scrollable container is moved to a FIXED offset, the same number in both runs,
 * so before and after show the same region of the same sheet.
 */
/**
 * `.venueGettingThere` is the block immediately above the amenity row and is
 * present in both runs, so anchoring on it shows the same region of the same
 * sheet before and after even though the row's own height changes.
 */
const VENUE_SCROLL_ANCHOR = ".venueGettingThere";

const settleVenue = async (page) => {
  await page.waitForSelector(".venueTabPanel, .springDrawer, .mobileSharedSheetBody", { timeout: 60_000 })
    .catch(() => {});
  await page.waitForTimeout(4_000);
  const expand = page.locator('button[aria-label="Expand sheet"]');
  if (await expand.count()) {
    await expand.first().click({ timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(1_200);
  }
  // The amenity row lives inside the "Details and practical info" disclosure,
  // which the sheet ships closed. Open it, or the shot proves nothing.
  await page.evaluate(() => {
    for (const details of document.querySelectorAll("details")) {
      if (/details and practical info/i.test(details.textContent ?? "")) details.open = true;
    }
  });
  await page.waitForTimeout(600);
  const seen = await page.evaluate((anchorSelector) => {
    const anchor = document.querySelector(".amenityRow") ?? document.querySelector(anchorSelector);
    anchor?.scrollIntoView({ block: "center", behavior: "instant" });
    const row = document.querySelector(".amenityRow");
    if (!row) return { row: false, anchor: Boolean(anchor) };
    const rect = row.getBoundingClientRect();
    return {
      row: true,
      anchor: Boolean(anchor),
      inView: rect.top >= 0 && rect.bottom <= window.innerHeight,
      top: Math.round(rect.top),
    };
  }, VENUE_SCROLL_ANCHOR);
  console.log(`  amenity row: ${JSON.stringify(seen)}`);
  await page.waitForTimeout(800);
};

for (const size of WIDTHS) {
  for (const theme of ["light", "dark"]) {
    await shot("today", `${baseUrl}/today`, size, theme, settleToday);
    await shot("venue-sheet", `${baseUrl}/map?sel=${VENUE_ID}`, size, theme, settleVenue);
    await shot("venue-sheet-stated", `${baseUrl}/map?sel=${STATED_VENUE_ID}`, size, theme, settleVenue);
  }
}

await browser.close();
