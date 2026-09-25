/**
 * Soft drinks and bottled water extraction for the London chain harvest lane.
 * Reuses ukPriceCrawl verbatim rules and M&B markdown section parsing.
 */

import { MAX_PDF_BYTES, readPdfText } from "../../lib/harvest/pdfText.ts";
import {
  isHarvestableChainMenuUrl,
} from "../../lib/harvest/sourcePolicy.ts";
import { createRobotsChecker } from "../../lib/harvest/robots.ts";
import { drinkSubtypeFromText } from "../../lib/drinkSubtypes.ts";
import {
  cheapestPerCategory,
  pageStatesADrinksList,
  readVenueDrinkPrices,
} from "../../lib/harvest/ukPriceCrawl.ts";
import { fetchBoundedHarvestResource } from "./boundedHarvestResource.mjs";

const TAP_WATER = /\btap\s+water\b/i;

const MBPLC_TOP = /^##\s+(.+)$/;
const MBPLC_SUB = /^###\s+(.+)$/;
const MBPLC_ITEM = /^####\s+(.+)$/;
const POUND = /£\s*(\d+(?:\.\d{2})?)/;
const BARE = /^\s*(\d+\.\d{2})\s*$/;
const LEADING_MEASURE = /^\s*\d+(?:\.\d+)?\s*(?:ml|cl|l|oz)\b\s*/i;
const CLEAR_SOFT_DRINK =
  /\b(?:coke|coca[- ]cola|cola|pepsi|sprite|fanta|7\s?up|lemonade|j2o|fruit shoot|juice|squash|cordial|still water|sparkling water|mineral water|tonic|soda|ginger ale|ginger beer|bitter lemon|root beer|dandelion and burdock|red bull|energy drink|fentiman|fever[- ]tree|elderflower|press[eé]|aqua libra|appetiser)\b/i;
const ALCOHOL_OR_COCKTAIL =
  /\b(?:\d+(?:\.\d+)?\s*%\s*(?:abv)?|abv|cocktail|mocktail|fizz|marg|martini|negroni|margarita|mojito|daiquiri|old fashioned|aperol|spritz|bloody mary|cosmopolitan|long island iced tea|cuba libre|tequila sunrise|mimosa|pi(?:n|ñ)a colada|mai tai|caipirinha|vodka|gin|rum|tequila|whisk(?:y|ey)|bourbon|brandy|cognac|prosecco|champagne|wine|cider|lager|helles|stout|pilsner|ipa|ale|spirit|liqueur|schnapps|vermouth)\b/i;
const SOFT_DRINK_SECTION_ONLY = /^\s*(?:soft drinks?|sodas?|water|juices?|mixers?)\s*$/i;

function mapMbplcSectionToCategory(section) {
  const s = section.toLowerCase();
  if (
    s.includes("fever-tree") ||
    s.includes("mixer") ||
    s.includes("tonic") ||
    s.includes("main menu") ||
    s.includes("sandwich") ||
    s.includes("buffet") ||
    s.includes("breakfast") ||
    s.includes("food")
  ) {
    return null;
  }
  if (s.includes("soft drink") || s.includes("soda") || s.includes("bottled")) return "soft-drink";
  if (s.includes("water") && !s.includes("tonic")) return "soft-drink";
  return null;
}

function priceFromLines(lines) {
  for (const line of lines) {
    const trimmed = line.trim().toLowerCase();
    if (
      trimmed === "glass" ||
      trimmed === "bottle" ||
      trimmed === "pint" ||
      trimmed.endsWith(" kcal") ||
      trimmed.includes(" vol.")
    ) {
      continue;
    }
    const pound = line.match(POUND);
    if (pound) return parseFloat(pound[1]);
    const bare = line.match(BARE);
    if (bare) {
      const value = parseFloat(bare[1]);
      if (value >= 0.8 && value <= 12) return value;
    }
  }
  return null;
}


const PROPELLER_MENU_ITEM =
  /MenuItem-module[^>]*__title">([^<]+?)<span[^>]*__price">£\s*([\d.]+)/gi;

function isLikelySoftDrinkLabel(label) {
  const s = String(label ?? "").toLowerCase();
  return /coke|pepsi|sprite|fanta|lemonade|tonic|water|juice|j2o|red bull|appletiser|ginger beer|fever|cordial|soda|still|sparkling/i.test(
    s,
  );
}

/** Young's / Propeller microsites embed menu rows in RSC HTML blobs. */
export function parsePropellerMenuSoftDrinks(text) {
  const out = [];
  for (const match of String(text).matchAll(PROPELLER_MENU_ITEM)) {
    const drinkLabel = match[1].trim();
    if (!isLikelySoftDrinkLabel(drinkLabel)) continue;
    const priceGbp = parseFloat(match[2]);
    if (!Number.isFinite(priceGbp)) continue;
    out.push({ drinkLabel, category: "soft-drink", priceGbp });
  }
  return filterSoftDrinkHarvestRows(out);
}

export function parseMbplcSoftDrinkLines(markdown) {
  const lines = markdown.split(/\r?\n/);
  const out = [];
  let topSection = null;
  let subSection = null;
  let itemName = null;
  let itemLines = [];
  const activeSection = () => subSection ?? topSection;

  const flushItem = () => {
    if (!itemName) {
      itemLines = [];
      return;
    }
    const section = activeSection();
    if (!section || !mapMbplcSectionToCategory(section)) {
      itemName = null;
      itemLines = [];
      return;
    }
    const price = priceFromLines(itemLines);
    if (price !== null) {
      out.push({ drinkLabel: itemName.trim(), category: "soft-drink", priceGbp: price });
    }
    itemName = null;
    itemLines = [];
  };

  for (const line of lines) {
    const topMatch = line.match(MBPLC_TOP);
    if (topMatch) {
      flushItem();
      topSection = topMatch[1].trim();
      subSection = null;
      continue;
    }
    const subMatch = line.match(MBPLC_SUB);
    if (subMatch) {
      flushItem();
      subSection = subMatch[1].trim();
      continue;
    }
    const itemMatch = line.match(MBPLC_ITEM);
    if (itemMatch) {
      flushItem();
      itemName = itemMatch[1].trim();
      itemLines = [];
      continue;
    }
    if (itemName) itemLines.push(line);
  }
  flushItem();
  return out;
}

export function isTapWaterLabel(label) {
  return TAP_WATER.test(String(label ?? ""));
}

/** Keep soft-drink rows; drop tap water; require a drink label for subtype lanes. */
export function filterSoftDrinkHarvestRows(rows) {
  return rows.filter((row) => {
    if (row.category !== "soft-drink") return false;
    const rawLabel = typeof row.drinkLabel === "string" ? row.drinkLabel : "";
    const label = rawLabel.normalize("NFKC").replace(LEADING_MEASURE, "").trim();
    if (
      !Number.isFinite(row.priceGbp) ||
      row.priceGbp < 0.8 ||
      row.priceGbp > 7 ||
      label.length < 2 ||
      label.length > 96 ||
      SOFT_DRINK_SECTION_ONLY.test(label) ||
      isTapWaterLabel(label) ||
      ALCOHOL_OR_COCKTAIL.test(label) ||
      !/^[a-z]/i.test(label) && !/^7\s?up\b/i.test(label) ||
      !CLEAR_SOFT_DRINK.test(label)
    ) {
      return false;
    }
    return true;
  });
}

export function softDrinkRowsFromPageText(text) {
  const reading = readVenueDrinkPrices(text);
  if (!pageStatesADrinksList(reading)) return [];
  const priced = cheapestPerCategory(reading);
  return filterSoftDrinkHarvestRows(
    priced.map((row) => ({
      category: row.category,
      priceGbp: row.priceGbp,
      drinkLabel: row.drinkLabel ?? "",
    })),
  );
}



const GK_SECTION = /^###\s+(.+)$/;
const GK_ITEM = /^####\s+(.+)$/;

function mapGkSectionToCategory(section) {
  const s = section.toLowerCase();
  if (s.includes("soft drink") || s.includes("bottled") || s.includes("mixer")) return "soft-drink";
  if (s.includes("water") && !s.includes("tonic")) return "soft-drink";
  return null;
}

function gkPriceFromLines(lines) {
  for (const line of lines) {
    const m = line.match(/£\s*(\d+(?:\.\d{2})?)/);
    if (m) return parseFloat(m[1]);
  }
  return null;
}

export function parseGkSoftDrinkLines(markdown) {
  const lines = markdown.split(/\r?\n/);
  const out = [];
  let section = null;
  let itemName = null;
  let itemLines = [];
  const flush = () => {
    if (!itemName || !section || !mapGkSectionToCategory(section)) {
      itemName = null;
      itemLines = [];
      return;
    }
    const price = gkPriceFromLines(itemLines);
    if (price !== null) out.push({ drinkLabel: itemName.trim(), category: "soft-drink", priceGbp: price });
    itemName = null;
    itemLines = [];
  };
  for (const line of lines) {
    const sm = line.match(GK_SECTION);
    if (sm) {
      flush();
      section = sm[1].trim();
      continue;
    }
    const im = line.match(GK_ITEM);
    if (im) {
      flush();
      itemName = im[1].trim();
      itemLines = [];
      continue;
    }
    if (itemName) itemLines.push(line);
  }
  flush();
  return out;
}

export function classifySoftDrinkSubtypeId(drinkLabel) {
  return drinkSubtypeFromText(drinkLabel, "soft-drink")?.id ?? null;
}

function menuPdfUrlsFromPageText(text) {
  const input = String(text);
  const labelled = [];
  const seen = new Set();
  const add = (rawUrl, label = "") => {
    let url;
    try {
      url = new URL(rawUrl.trim());
    } catch {
      return;
    }
    if (!/^https?:$/.test(url.protocol) || !/\.pdf$/i.test(url.pathname)) return;
    url.hash = "";
    const normalized = url.href;
    if (seen.has(normalized)) return;
    seen.add(normalized);
    if (/\b(?:drinks?\s+(?:list|menu)|soft[- ]?drinks?\s+(?:list|menu))\b/i.test(label)) {
      labelled.push(normalized);
    }
  };

  for (const match of input.matchAll(/\[([^\]]+)\]\((https?:\/\/[^\s)]+?\.pdf(?:\?[^\s)]*)?)\)/gi)) {
    add(match[2], match[1]);
  }
  for (const match of input.matchAll(/<a\b[^>]*href=["']([^"']+\.pdf(?:\?[^"']*)?)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    add(match[1], match[2].replace(/<[^>]+>/g, " "));
  }
  if (labelled.length > 0) return labelled;

  const fallback = [];
  for (const match of input.matchAll(/https?:\/\/[^\s"'<>]+?\.pdf(?:\?[^\s"'<>]*)?/gi)) {
    const href = match[0];
    if (!/drink/i.test(href) || /wine|spritz|cocktail|food/i.test(href)) continue;
    try {
      const normalized = new URL(href).href;
      if (!seen.has(normalized)) fallback.push(normalized);
    } catch {
      continue;
    }
  }
  return fallback;
}

/** Follow a same-origin, policy-approved menu PDF with bounded network reads. */
export async function softDrinkRowsFromMenuPdfLinks(
  pageText,
  {
    pageUrl,
    sourceId,
    associatedHosts = [],
    fetchImpl = fetch,
    robotsChecker = createRobotsChecker(),
    waitForCrawlSpacing = async () => {},
    markRequestCompleted = () => {},
    onPdfEvent = () => {},
  } = {},
) {
  if (!pageUrl || !sourceId || !isHarvestableChainMenuUrl(pageUrl, sourceId, associatedHosts)) {
    return [];
  }
  const pageOrigin = new URL(pageUrl).origin;
  const pdfUrls = menuPdfUrlsFromPageText(pageText);
  const rows = [];
  if (pdfUrls.length === 0) onPdfEvent({ url: pageUrl, status: "no-pdf-link" });
  for (const pdfUrl of pdfUrls.slice(0, 2)) {
    let parsedUrl;
    try {
      parsedUrl = new URL(pdfUrl);
    } catch {
      continue;
    }
    if (
      parsedUrl.origin !== pageOrigin ||
      !isHarvestableChainMenuUrl(parsedUrl.href, sourceId, associatedHosts)
    ) {
      onPdfEvent({ url: parsedUrl.href, status: "policy-refused" });
      continue;
    }
    await waitForCrawlSpacing();
    let resource;
    try {
      resource = await fetchBoundedHarvestResource({
        url: parsedUrl.href,
        fetchImpl,
        isAllowedUrl: (value) =>
          new URL(value).origin === pageOrigin &&
          isHarvestableChainMenuUrl(value, sourceId, associatedHosts),
        robotsChecker,
        expectedContentTypes: ["application/pdf"],
        maxBytes: MAX_PDF_BYTES,
      });
    } catch (error) {
      markRequestCompleted();
      onPdfEvent({
        url: parsedUrl.href,
        status: "fetch-refused",
        code: typeof error?.code === "string" ? error.code : "fetch-failed",
      });
      continue;
    }
    markRequestCompleted();
    const text = await readPdfText(resource.bytes);
    if (!text) {
      onPdfEvent({ url: parsedUrl.href, status: "unreadable-pdf" });
      continue;
    }
    const pdfRows = softDrinkRowsFromPageText(text);
    onPdfEvent({ url: parsedUrl.href, status: pdfRows.length ? "priced-soft-drinks" : "no-soft-drink-prices" });
    rows.push(...pdfRows);
  }
  return filterSoftDrinkHarvestRows(rows);
}
