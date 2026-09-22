/**
 * Keyless rendered menu fetch for harvest CLIs when Browserbase is unavailable.
 */

import { chromium } from "playwright";
import {
  hostHasLondonDrinkCaptainOverride,
  isHarvestableChainMenuUrl,
} from "../../lib/harvest/sourcePolicy.ts";
import { createRobotsChecker } from "../../lib/harvest/robots.ts";

const HARVEST_USER_AGENT =
  "PUBMAXXHarvest/1.0 (+https://pubmaxxing.com; hello@pubmaxxing.com)";

const RENDERED_PAGE_EXPRESSION = String.raw`(() => {
  const visible = (node) => {
    const style = getComputedStyle(node);
    return style.display !== "none" && style.visibility !== "hidden";
  };
  const blocks = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6,p,li,dt,dd,tr")]
    .filter(visible)
    .map((node) => {
      const text = (node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();
      if (!text) return "";
      const heading = /^H([1-6])$/.exec(node.tagName);
      if (heading) return "#".repeat(Number(heading[1])) + " " + text;
      if (node.tagName === "LI") return "- " + text;
      return text;
    })
    .filter(Boolean);
  const markdown = blocks.length ? blocks.join("\n\n") : document.body.innerText;
  const links = [...new Set([...document.querySelectorAll("a[href]")]
    .map((link) => link.href)
    .filter((href) => /^https?:/.test(href)))];
  return { markdown, links };
})()`;

export async function fetchLocalPlaywrightMenuPage(
  url,
  {
    sourceId,
    associatedHosts = [],
    robotsChecker = createRobotsChecker(),
    browserType = chromium,
    timeoutMs = 30_000,
    maxHtmlBytes = 2 * 1024 * 1024,
    followMenuLink = false,
  } = {},
) {
  if (!sourceId || !isHarvestableChainMenuUrl(url, sourceId, associatedHosts)) {
    throw new Error(`sourcePolicy refused rendered menu URL: ${url}`);
  }
  const origin = new URL(url).origin;
  const robots = await robotsChecker(url);
  if (!robots?.allowed && !hostHasLondonDrinkCaptainOverride(new URL(url).hostname)) {
    throw new Error(`robots.txt refused rendered menu URL: ${robots?.evidence ?? url}`);
  }
  const browser = await browserType.launch({ headless: true });
  try {
    const page = await browser.newPage({ userAgent: HARVEST_USER_AGENT });
    await page.route("**/*", async (route) => {
      const requestUrl = route.request().url();
      const resourceType = route.request().resourceType();
      if (["image", "media", "font"].includes(resourceType)) {
        await route.abort("blockedbyclient");
        return;
      }
      let parsed;
      try {
        parsed = new URL(requestUrl);
      } catch {
        await route.abort("blockedbyclient");
        return;
      }
      if (
        parsed.origin !== origin ||
        !/^https?:$/.test(parsed.protocol) ||
        !isHarvestableChainMenuUrl(parsed.href, sourceId, associatedHosts)
      ) {
        await route.abort("blockedbyclient");
        return;
      }
      try {
        const decision = await robotsChecker(parsed.href);
        if (!decision?.allowed && !hostHasLondonDrinkCaptainOverride(parsed.hostname)) {
          await route.abort("blockedbyclient");
          return;
        }
      } catch {
        await route.abort("blockedbyclient");
        return;
      }
      await route.continue();
    });
    const gotoChecked = async (targetUrl) => {
      const response = await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      if (!response || !response.ok()) {
        throw new Error(`rendered menu returned HTTP ${response?.status() ?? "no response"}`);
      }
      const responseHeaders = await response.allHeaders();
      const contentType = (responseHeaders["content-type"] ?? "").split(";", 1)[0].trim().toLowerCase();
      const declaredLength = Number(responseHeaders["content-length"] ?? 0);
      if (
        !["text/html", "application/xhtml+xml"].includes(contentType) ||
        (declaredLength > 0 && declaredLength > maxHtmlBytes)
      ) {
        throw new Error(`rendered menu response is not bounded HTML (${contentType || "missing type"})`);
      }
      if (new URL(page.url()).origin !== origin) {
        throw new Error(`rendered menu crossed origin: ${page.url()}`);
      }
    };
    await gotoChecked(url);
    if (followMenuLink) {
      const links = await page.locator("a[href]").evaluateAll((anchors) =>
        anchors.map((anchor) => ({
          href: anchor.href,
          text: (anchor.innerText || anchor.textContent || "").replace(/\s+/g, " ").trim(),
        })),
      );
      const candidates = new Set();
      for (const link of Array.isArray(links) ? links : []) {
        if (typeof link?.href !== "string") continue;
        let candidate;
        try {
          candidate = new URL(link.href);
        } catch {
          continue;
        }
        const pathLooksLikeMenu = /\/(?:food(?:-and)?-?drink(?:s)?|menus?)(?:\/|$)/i.test(candidate.pathname);
        const labelLooksLikeMenu = /^(?:our\s+)?(?:menus?|food(?:\s*(?:and|&)\s*)?drink(?:s)?)$/i.test(link.text ?? "");
        if (!pathLooksLikeMenu && !labelLooksLikeMenu) continue;
        candidate.hash = "";
        if (
          candidate.origin !== origin ||
          !isHarvestableChainMenuUrl(candidate.href, sourceId, associatedHosts)
        ) {
          continue;
        }
        const decision = await robotsChecker(candidate.href);
        if (!decision?.allowed && !hostHasLondonDrinkCaptainOverride(candidate.hostname)) continue;
        candidates.add(candidate.href);
      }
      if (candidates.size !== 1) {
        throw new Error(`expected one same-origin menu link; found ${candidates.size}`);
      }
      await gotoChecked([...candidates][0]);
    }
    const evaluated = await page.evaluate(RENDERED_PAGE_EXPRESSION);
    const html = await page.content();
    if (Buffer.byteLength(html, "utf8") > maxHtmlBytes) {
      throw new Error(`rendered menu HTML exceeds ${maxHtmlBytes} byte limit`);
    }
    return {
      markdown: `${evaluated?.markdown ?? ""}\n\n<!-- html -->\n${html}`,
      links: Array.isArray(evaluated?.links) ? evaluated.links : [],
      html,
      finalUrl: page.url(),
    };
  } finally {
    await browser.close();
  }
}
