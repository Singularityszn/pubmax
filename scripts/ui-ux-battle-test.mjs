import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { prepareAuditOutputRoot } from "./lib/uiUxBattleTestOutput.mjs";

const outputRoot = await prepareAuditOutputRoot(process.env.UI_UX_OUTPUT);
const colorScheme = process.env.UI_UX_COLOR_SCHEME ?? "light";
const originFilter = process.env.UI_UX_ORIGINS?.split(",").filter(Boolean);
const routeFilter = process.env.UI_UX_ROUTES?.split(",").filter(Boolean);
const origins = [
  { name: "live", url: "https://pubmaxxing.com" },
  { name: "local", url: "http://127.0.0.1:3000" },
];
const viewports = [
  {
    name: "mobile-390",
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  },
  {
    name: "desktop-1440",
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
  },
];
const routes = [
  { name: "home", path: "/" },
  { name: "today", path: "/today" },
  { name: "tonight", path: "/tonight" },
  { name: "near", path: "/near" },
  { name: "add", path: "/add/karan" },
  { name: "login", path: "/login" },
  { name: "profile", path: "/u/karan" },
  { name: "map", path: "/map/london" },
  { name: "plan", path: "/plan" },
  { name: "crawls", path: "/crawls" },
];
const selectedOrigins = originFilter
  ? origins.filter((origin) => originFilter.includes(origin.name))
  : origins;
const selectedRoutes = routeFilter
  ? routes.filter((route) => routeFilter.includes(route.name) || routeFilter.includes(route.path))
  : routes;

const browser = await chromium.launch({ headless: true });
const findings = [];
const pages = [];

function safeName(value) {
  return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "");
}

function addFinding(finding) {
  findings.push(finding);
}

async function inspectPage(page, origin, viewport, route) {
  const result = await page.evaluate(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number.parseFloat(style.opacity || "1") > 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    const interactive = [...document.querySelectorAll(
      'button, a, input, select, textarea, [role="button"], [role="link"], [tabindex]:not([tabindex="-1"])',
    )]
      .filter(visible)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          tag: element.tagName.toLowerCase(),
          text: (element.getAttribute("aria-label") || element.textContent || "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 100),
          type: element.getAttribute("type") || "",
          width: Math.round(rect.width * 10) / 10,
          height: Math.round(rect.height * 10) / 10,
          x: Math.round(rect.x * 10) / 10,
          y: Math.round(rect.y * 10) / 10,
          overflowX: style.overflowX,
          opacity: style.opacity,
          outline: style.outline,
        };
      });
    const textOverflow = [...document.querySelectorAll("body *")]
      .filter(visible)
      .filter((element) => element.children.length === 0)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          text: (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 100),
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          rectWidth: rect.width,
        };
      })
      .filter((item) => item.scrollWidth > item.clientWidth + 1);
    return {
      url: location.href,
      title: document.title,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      bodyScrollWidth: document.body?.scrollWidth ?? 0,
      interactive,
      textOverflow,
      safeAreaTop: getComputedStyle(document.documentElement).getPropertyValue(
        "env(safe-area-inset-top)",
      ),
      bodyBackground: getComputedStyle(document.body).backgroundColor,
    };
  });

  const prefix = `${origin.name}/${viewport.name}/${route.name}`;
  await page.screenshot({
    path: path.join(outputRoot, `${safeName(prefix)}.png`),
    fullPage: true,
  });
  pages.push({ prefix, ...result });

  if (viewport.isMobile) {
    for (const element of result.interactive) {
      if (element.width < 44 || element.height < 44) {
        addFinding({
          severity: "high",
          category: "tap-target",
          origin: origin.name,
          viewport: viewport.name,
          route: route.path,
          element: `${element.tag} ${element.text || element.type || "unnamed"}`,
          defect: `Interactive target is ${element.width}x${element.height}px, below 44x44 CSS px.`,
          evidence: `${safeName(prefix)}.png`,
        });
      }
    }
  }
  if (result.scrollWidth > result.clientWidth + 1 || result.bodyScrollWidth > result.clientWidth + 1) {
    addFinding({
      severity: "high",
      category: "overflow",
      origin: origin.name,
      viewport: viewport.name,
      route: route.path,
      element: "document",
      defect: `Horizontal overflow: document ${result.scrollWidth}px, body ${result.bodyScrollWidth}px, viewport ${result.clientWidth}px.`,
      evidence: `${safeName(prefix)}.png`,
    });
  }
  if (result.textOverflow.length > 0) {
    addFinding({
      severity: "medium",
      category: "text-overflow",
      origin: origin.name,
      viewport: viewport.name,
      route: route.path,
      element: result.textOverflow.slice(0, 5).map((item) => `${item.tag} ${item.text}`).join(" | "),
      defect: `${result.textOverflow.length} visible text node(s) have scrollWidth greater than clientWidth.`,
      evidence: `${safeName(prefix)}.png`,
    });
  }
}

async function navigate(page, origin, viewport, routePath) {
  try {
    await page.goto(`${origin.url}${routePath}`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    return true;
  } catch (error) {
    addFinding({
      severity: "high",
      category: "navigation",
      origin: origin.name,
      viewport: viewport.name,
      route: routePath,
      element: "document",
      defect: `Navigation failed: ${error.message}`,
      evidence: "navigation",
    });
    return false;
  }
}

async function interact(origin, viewport) {
  const videoName = `${origin.name}-${viewport.name}-key-flow.webm`;
  const videoPage = await browser.newPage({
    viewport: viewport.viewport,
    deviceScaleFactor: viewport.deviceScaleFactor,
    isMobile: viewport.isMobile,
    hasTouch: viewport.hasTouch,
    colorScheme,
    recordVideo: { dir: path.join(outputRoot, "videos"), size: viewport.viewport },
  });
  if (!await navigate(videoPage, origin, viewport, "/")) {
    await videoPage.close();
    return;
  }
  await videoPage.waitForTimeout(1200);
  const buttons = videoPage.locator("button:visible");
  const count = Math.min(await buttons.count(), 5);
  for (let index = 0; index < count; index += 1) {
    if (index >= await buttons.count()) continue;
    const button = buttons.nth(index);
    const label = ((await button.getAttribute("aria-label").catch(() => "")) || (await button.innerText().catch(() => "")).trim()).slice(0, 80);
    if (!label || /delete|remove|sign out|logout|publish|send|submit/i.test(label)) continue;
    try {
      await button.click({ timeout: 1500 });
      await videoPage.waitForTimeout(250);
      const close = videoPage.locator('button[aria-label*="Close" i], [role="dialog"] button').first();
      if (await close.isVisible().catch(() => false)) await close.click({ timeout: 1000 }).catch(() => {});
    } catch {
      // A route can expose a transient or disabled control. The static sweep remains authoritative.
    }
  }
  if (!await navigate(videoPage, origin, viewport, "/today")) {
    await videoPage.close();
    return;
  }
  await videoPage.waitForTimeout(800);
  await videoPage.keyboard.press("Tab");
  await videoPage.waitForTimeout(250);
  await videoPage.screenshot({ path: path.join(outputRoot, `${origin.name}-${viewport.name}-key-flow.png`) });
  const video = videoPage.video();
  await videoPage.close();
  const videoPath = video ? await video.path() : undefined;
  if (videoPath) {
    await fs.rename(videoPath, path.join(outputRoot, "videos", videoName)).catch(() => {});
  }
}

for (const origin of selectedOrigins) {
  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: viewport.viewport,
      deviceScaleFactor: viewport.deviceScaleFactor,
      isMobile: viewport.isMobile,
      hasTouch: viewport.hasTouch,
      colorScheme,
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => addFinding({
      severity: "medium",
      category: "runtime",
      origin: origin.name,
      viewport: viewport.name,
      route: page.url(),
      element: "page",
      defect: `Page error: ${error.message}`,
      evidence: "console",
    }));
    for (const route of selectedRoutes) {
      if (!await navigate(page, origin, viewport, route.path)) continue;
      await page.waitForTimeout(1200);
      try {
        await inspectPage(page, origin, viewport, route);
      } catch (error) {
        await page.waitForTimeout(500);
        try {
          await inspectPage(page, origin, viewport, route);
        } catch (retryError) {
          addFinding({
            severity: "medium",
            category: "audit",
            origin: origin.name,
            viewport: viewport.name,
            route: route.path,
            element: "document",
            defect: `Audit capture failed after retry: ${retryError.message || error.message}`,
            evidence: "audit.json",
          });
        }
      }
    }
    await page.close();
    await context.close();
    await interact(origin, viewport);
  }
}

await fs.writeFile(path.join(outputRoot, "audit.json"), JSON.stringify({ pages, findings }, null, 2));
await Promise.race([
  browser.close(),
  new Promise((resolve) => setTimeout(resolve, 5_000)),
]);
console.log(JSON.stringify({ outputRoot, pageCount: pages.length, findingCount: findings.length }, null, 2));
