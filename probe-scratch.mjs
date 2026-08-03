import { chromium } from "@playwright/test";

const OUT = process.argv[2] || "before";
const DIR = "/Users/karanmanoharan/.treehouse/pubmax-4f650b/7/pubmax/docs/evidence/desktop-rail-and-banners";

const browser = await chromium.launch();

async function shell(width, height, { firstRun }) {
  const context = await browser.newContext({ viewport: { width, height } });
  if (!firstRun) {
    await context.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });
  }
  const page = await context.newPage();
  await page.route("**/api/tonight-conditions**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        summary: {
          dateLabel: "Thursday 23 Jul",
          weatherLabel: "21C, cloudy",
          drinkLine: "Warm and dry. Beer garden weather.",
          drinkSuggestion: "a cold lager or cider",
          venueClaim: null,
        },
      }),
    }),
  );
  await page.goto("http://localhost:3000/map", { waitUntil: "domcontentloaded" });
  await page.locator(".mapToolbar").waitFor({ timeout: 60_000 });
  await page.waitForTimeout(4000);
  return { context, page };
}

// ---- D1 ----
{
  const { context, page } = await shell(1440, 900, { firstRun: false });
  await page.getByRole("button", { name: /Plan tonight/i }).click();
  await page.locator(".mapDrawer.left.open").waitFor({ timeout: 20_000 });
  await page.waitForTimeout(3000);
  const geo = await page.evaluate(() => {
    const box = (n) => {
      const r = n.getBoundingClientRect();
      const cs = getComputedStyle(n);
      return {
        l: Math.round(r.left),
        r: Math.round(r.right),
        t: Math.round(r.top),
        b: Math.round(r.bottom),
        vis: cs.visibility,
        op: cs.opacity,
        disp: cs.display,
      };
    };
    const q = (s) => {
      const n = document.querySelector(s);
      return n ? box(n) : null;
    };
    const bar = document.querySelector(".mapToolbar");
    const controls = Array.from(bar.querySelectorAll("input, select, button, a[href]"))
      .filter((n) => {
        const r = n.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })
      .map((n) => ({
        label: (
          n.getAttribute("aria-label") ||
          n.textContent ||
          n.getAttribute("placeholder") ||
          n.tagName
        )
          .trim()
          .slice(0, 34),
        ...box(n),
      }));
    return {
      shell: document.querySelector(".appShell").className,
      rail: q(".mapDrawer.left.open"),
      toolbar: q(".mapToolbar"),
      search: q(".mapToolbarSearch"),
      input: q(".mapToolbarSearch input"),
      controls,
    };
  });
  console.log("D1", JSON.stringify(geo, null, 1));
  await page.screenshot({ path: `${DIR}/d1-search-under-rail-${OUT}.png` });
  await page.screenshot({
    path: `${DIR}/d1-search-under-rail-${OUT}-detail.png`,
    clip: { x: 0, y: 150, width: 760, height: 130 },
  });
  await context.close();
}

// ---- D2 first run ----
{
  const { context, page } = await shell(1440, 900, { firstRun: true });
  const banners = await page.evaluate(() => {
    const out = [];
    for (const sel of [
      ".cityStatusStack",
      ".cityStatusBanner",
      ".citySuggestBanner",
      ".tonightLaneCollapsed",
    ]) {
      for (const n of document.querySelectorAll(sel)) {
        const r = n.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        out.push({
          sel,
          l: Math.round(r.left),
          r: Math.round(r.right),
          t: Math.round(r.top),
          b: Math.round(r.bottom),
          text: (n.textContent || "").trim().slice(0, 60),
        });
      }
    }
    return { shell: document.querySelector(".appShell").className, out };
  });
  console.log("D2", JSON.stringify(banners, null, 1));
  await page.screenshot({ path: `${DIR}/d2-banner-stack-${OUT}.png` });
  await page.screenshot({
    path: `${DIR}/d2-banner-stack-${OUT}-detail.png`,
    clip: { x: 380, y: 150, width: 700, height: 260 },
  });
  await context.close();
}

await browser.close();
