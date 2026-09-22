/**
 * Soft drinks and bottled water extraction for the London chain harvest lane.
 * Reuses ukPriceCrawl verbatim rules and M&B markdown section parsing.
 */

import { drinkSubtypeFromText } from "../../lib/drinkSubtypes.ts";
import {
  cheapestPerCategory,
  pageStatesADrinksList,
  readVenueDrinkPrices,
} from "../../lib/harvest/ukPriceCrawl.ts";

const TAP_WATER = /\btap\s+water\b/i;

const MBPLC_TOP = /^##\s+(.+)$/;
const MBPLC_SUB = /^###\s+(.+)$/;
const MBPLC_ITEM = /^####\s+(.+)$/;
const POUND = /£\s*(\d+(?:\.\d{2})?)/;
const BARE = /^\s*(\d+\.\d{2})\s*$/;

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
    const label = row.drinkLabel ?? "";
    if (isTapWaterLabel(label)) return false;
    return label.trim().length > 0;
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
