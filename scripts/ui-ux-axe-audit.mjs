import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";

const output = process.env.UI_UX_AXE_OUTPUT ?? "/tmp/pubmax-ui-ux-battle-test/axe.json";
const origin = process.env.UI_UX_AXE_ORIGIN ?? "http://127.0.0.1:3000";
const colorScheme = process.env.UI_UX_AXE_COLOR_SCHEME ?? "light";
const routes = ["/", "/today", "/tonight", "/near", "/add/karan", "/login", "/u/karan", "/map/london", "/plan", "/crawls"];
const viewports = [
  { name: "mobile-390", viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  { name: "desktop-1440", viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
];

const browser = await chromium.launch({ headless: true });
const results = [];

for (const viewport of viewports) {
  const context = await browser.newContext({ ...viewport, colorScheme, serviceWorkers: "block" });
  const page = await context.newPage();
  for (const route of routes) {
    await page.goto(`${origin}${route}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(600);
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    results.push({
      viewport: viewport.name,
      route,
      violations: axe.violations.map(({ id, impact, description, help, nodes }) => ({
        id,
        impact,
        description,
        help,
        nodes: nodes.map((node) => ({ html: node.html, target: node.target })),
      })),
    });
  }
  await context.close();
}

await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, JSON.stringify({ origin, results }, null, 2));
await Promise.race([
  browser.close(),
  new Promise((resolve) => setTimeout(resolve, 5_000)),
]);
console.log(JSON.stringify({ output, colorScheme, routeCount: results.length, violationCount: results.reduce((sum, item) => sum + item.violations.length, 0) }, null, 2));
