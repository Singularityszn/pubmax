/**
 * Keyless rendered menu fetch for harvest CLIs when Browserbase is unavailable.
 */

import { chromium } from "playwright";

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

export async function fetchLocalPlaywrightMenuPage(url) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ userAgent: HARVEST_USER_AGENT });
    await page.goto(url, { waitUntil: "networkidle", timeout: 90_000 });
    await page.waitForTimeout(4000);
    try {
      await page.getByRole("button", { name: /accept all/i }).click({ timeout: 2500 });
      await page.waitForTimeout(3000);
    } catch {
      /* no cookie banner */
    }
    const evaluated = await page.evaluate(RENDERED_PAGE_EXPRESSION);
    const html = await page.content();
    return {
      markdown: `${evaluated?.markdown ?? ""}\n\n<!-- html -->\n${html}`,
      links: Array.isArray(evaluated?.links) ? evaluated.links : [],
      html,
    };
  } finally {
    await browser.close();
  }
}
