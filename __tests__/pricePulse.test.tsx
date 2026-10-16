import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  isCalendarDay,
  MAX_QUOTE_WORDS,
  NOT_CHECKED_LABEL,
  parsePricePulseEdition,
  pricePulseLastModified,
  publishedEditions,
  type PricePulseEdition,
} from "@/lib/pricePulse";
import {
  DRAUGHT_BEER_DUTY_PER_LITRE_ALCOHOL_GBP,
  EXAMPLE_PINT_GBP,
  EXPLAINER_RATES,
  EXPLAINER_VIEWS,
  PINT_LITRES,
  splitPintPrice,
} from "@/lib/pricePulseExplainer";

// Price Pulse is research about other people's words. THREE rules hold it, and
// this file is where each one is proved (lib/pricePulse.ts owns the law):
//
// 1. AN UNAPPROVED EDITION NEVER RENDERS. Not on the page, not in the share
//    card, not in the archive.
// 2. EVERY LINE CARRIES A SOURCE URL AND A DATE, in our own words, with no
//    username and no more than a short quote.
// 3. NOTHING HERE FEEDS A PRICE SURFACE. No item has a number to read, and no
//    module that answers "what does a pint cost here now" imports this lane.

const ROOT = resolve(__dirname, "..");
const EDITIONS_DIR = join(ROOT, "data/price-pulse");

const editionFiles = readdirSync(EDITIONS_DIR).filter((file) => file.endsWith(".json")).sort();
const rawEditions = editionFiles.map((file) => ({
  file,
  raw: JSON.parse(readFileSync(join(EDITIONS_DIR, file), "utf8")) as unknown,
}));

function walkSource(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkSource(full, out);
    else if (/\.(ts|tsx|mts|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

const sourceFiles = ["app", "components", "lib", "scripts"].flatMap((dir) => walkSource(join(ROOT, dir)));

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: "a-line",
    kind: "drinkers",
    said: "A drinker in r/london said a pint cost £9 at a pub on Carnaby Street.",
    source: {
      label: "r/london",
      url: "https://www.reddit.com/r/london/comments/abc/a_thread/",
      publishedOn: "2026-10-02",
    },
    ...overrides,
  };
}

function edition(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    edition: "2026-10-16",
    title: "A test edition",
    summary: "Drinkers talked about prices.",
    windowStart: "2026-09-15",
    windowEnd: "2026-10-15",
    approved: false,
    approvedAt: null,
    items: [item()],
    ...overrides,
  };
}

function parsed(raw: unknown): PricePulseEdition {
  const result = parsePricePulseEdition(raw);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.edition;
}

function errorsOf(raw: unknown): string[] {
  const result = parsePricePulseEdition(raw);
  return result.ok ? [] : result.errors;
}

// ── The page, rendered with editions this file controls ───────────────────────

let editionFilesForPage: unknown[] = [];
let confirmedPrices = new Map<string, unknown>();

vi.mock("@/lib/pricePulseEditions", () => ({
  get PRICE_PULSE_EDITION_FILES() {
    return editionFilesForPage;
  },
}));
vi.mock("@/lib/pricePulse.server", () => ({
  confirmedPricesForEditions: async () => confirmedPrices,
}));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));

async function renderPage(): Promise<string> {
  const { default: PricePulsePage } = await import("@/app/price-pulse/page");
  return renderToStaticMarkup(await PricePulsePage());
}

describe("Price Pulse: the shipped editions", () => {
  it("ships at least one edition, and every file is registered", () => {
    expect(editionFiles.length).toBeGreaterThan(0);
    const registry = readFileSync(join(ROOT, "lib/pricePulseEditions.ts"), "utf8");
    for (const file of editionFiles) {
      expect(registry, `${file} is not in lib/pricePulseEditions.ts`).toContain(
        `@/data/price-pulse/${file}"`,
      );
    }
  });

  it.each(rawEditions)("$file parses, and its name is its edition day", ({ file, raw }) => {
    const result = parsePricePulseEdition(raw);
    expect(result.ok ? [] : result.errors).toEqual([]);
    expect(`${parsed(raw).edition}.json`).toBe(file);
  });

  it.each(rawEditions)("$file: every line has an https source and a real date", ({ raw }) => {
    const ed = parsed(raw);
    for (const line of ed.items) {
      expect(line.source.url).toMatch(/^https:\/\/[^\s]+$/);
      expect(isCalendarDay(line.source.publishedOn)).toBe(true);
      // A source published after the edition is a typo, not news.
      expect(line.source.publishedOn <= ed.edition, line.id).toBe(true);
    }
  });

  it.each(rawEditions)("$file: the words follow docs/VOICE.md", ({ raw }) => {
    const ed = parsed(raw);
    const prose = [ed.title, ed.summary, ...ed.items.flatMap((l) => [l.said, l.quote?.text ?? "", l.quote?.attribution ?? ""])];
    for (const text of prose) {
      expect(text).not.toContain("—");
      expect(text).not.toContain("!");
    }
  });

  it("the first edition is a draft until the owner approves it", () => {
    const first = parsed(rawEditions[0]?.raw);
    expect(first.edition).toBe("2026-10-16");
    expect(first.approved).toBe(false);
    expect(first.approvedAt).toBeNull();
  });
});

describe("Price Pulse: the parser refuses a bad line", () => {
  it("accepts a good draft", () => {
    expect(errorsOf(edition())).toEqual([]);
  });

  it("refuses a line with no source link or an http one", () => {
    expect(errorsOf(edition({ items: [item({ source: undefined })] }))).toContain("items[0].source is missing");
    const http = item({ source: { label: "Metro", url: "http://metro.co.uk/x", publishedOn: "2026-09-28" } });
    expect(errorsOf(edition({ items: [http] }))).toContain("items[0].source.url must be an https link");
  });

  it("refuses a line with no date or an impossible one", () => {
    for (const publishedOn of [undefined, "2 Oct", "2026-02-30"]) {
      const bad = item({ source: { label: "r/london", url: "https://reddit.com/r/london", publishedOn } });
      expect(errorsOf(edition({ items: [bad] }))).toContain("items[0].source.publishedOn must be YYYY-MM-DD");
    }
  });

  it("refuses a username anywhere in the prose", () => {
    for (const said of [
      "u/drtchockk said £8.90 near Liverpool Street.",
      "As /u/someone put it, £9 is a lot.",
      "@pintwatcher said £9.",
      "Posted by a regular, £9 at the bar.",
    ]) {
      expect(errorsOf(edition({ items: [item({ said })] }))).toContain("items[0].said names a user");
    }
    const quote = { text: "Too dear.", attribution: "u/LaMorro" };
    expect(errorsOf(edition({ items: [item({ quote })] }))).toContain("items[0].quote.attribution names a user");
  });

  it("refuses loaded words about a venue", () => {
    for (const said of ["A rip-off at £9.", "Daylight robbery near Liverpool Street.", "An extortionate pint."]) {
      expect(errorsOf(edition({ items: [item({ said })] }))).toContain(
        "items[0].said uses loaded wording about a venue",
      );
    }
  });

  it("refuses a quote longer than a short one", () => {
    const words = Array.from({ length: MAX_QUOTE_WORDS + 1 }, () => "pint").join(" ");
    const quote = { text: words, attribution: "A reply" };
    expect(errorsOf(edition({ items: [item({ quote })] }))).toContain("items[0].quote.text is longer than a short quote");
  });

  it("refuses a price field, so no figure can leave the prose", () => {
    for (const field of ["priceGbp", "pricePence", "cheapestPrice", "observedAt", "confirmedPrice"]) {
      expect(errorsOf(edition({ items: [item({ [field]: 9 })] }))).toContain(
        `items[0].${field} is not a Price Pulse field`,
      );
    }
  });

  it("one bad line refuses the whole edition", () => {
    const ed = edition({ approved: true, approvedAt: "2026-10-16T09:00:00.000Z", items: [item(), item({ id: "b", said: "" })] });
    expect(parsePricePulseEdition(ed).ok).toBe(false);
    expect(publishedEditions([ed])).toEqual([]);
  });
});

describe("Price Pulse: an unapproved edition never renders", () => {
  const draft = edition({ edition: "2026-10-23", title: "Draft title nobody approved", items: [item({ id: "draft-line", said: "Draft line nobody approved." })] });
  const approved = edition({
    edition: "2026-10-16",
    title: "Approved title",
    approved: true,
    approvedAt: "2026-10-16T09:00:00.000Z",
    items: [item({ id: "approved-line", said: "Approved line." })],
  });
  const older = edition({
    edition: "2026-10-09",
    title: "Older approved title",
    approved: true,
    approvedAt: "2026-10-09T09:00:00.000Z",
    items: [item({ id: "older-line", said: "Older line." })],
  });

  beforeEach(() => {
    vi.resetModules();
    confirmedPrices = new Map();
  });

  it("publishes only literal approvals, latest first", () => {
    expect(publishedEditions([draft])).toEqual([]);
    expect(publishedEditions([edition({ approved: true, approvedAt: null })])).toEqual([]);
    expect(publishedEditions([edition({ approved: "yes", approvedAt: "2026-10-16T09:00:00.000Z" })])).toEqual([]);
    expect(publishedEditions([edition({ approved: false, approvedAt: "2026-10-16T09:00:00.000Z" })])).toEqual([]);
    expect(publishedEditions([older, draft, approved]).map((e) => e.edition)).toEqual(["2026-10-16", "2026-10-09"]);
  });

  it("the page shows the approved editions and never the draft", async () => {
    editionFilesForPage = [older, draft, approved];
    const html = await renderPage();
    expect(html).toContain("Approved title");
    expect(html).toContain("Approved line.");
    expect(html).toContain("Earlier editions");
    expect(html).toContain("Older approved title");
    expect(html.indexOf("Approved title")).toBeLessThan(html.indexOf("Older approved title"));
    expect(html).not.toContain("Draft title nobody approved");
    expect(html).not.toContain("Draft line nobody approved.");
  });

  it("the page shows none of the shipped draft, and still shows the explainer", async () => {
    editionFilesForPage = rawEditions.map((e) => e.raw);
    const html = await renderPage();
    for (const { raw } of rawEditions) {
      const ed = parsed(raw);
      if (ed.approved) continue;
      expect(html).not.toContain(ed.title.replace(/'/g, "&#x27;"));
      for (const line of ed.items) expect(html).not.toContain(line.said.replace(/"/g, "&quot;").replace(/'/g, "&#x27;"));
    }
    expect(html).toContain("No edition is published yet");
    expect(html).toContain('id="where-your-6-goes"');
    expect(html).toContain("Where your £6 goes");
  });

  it("the share card carries no edition at all", () => {
    const card = readFileSync(join(ROOT, "app/price-pulse/opengraph-image.tsx"), "utf8");
    expect(card).not.toMatch(/pricePulseEditions|publishedEditions|data\/price-pulse/);
  });

  it("a line says Not checked unless the pub holds a Confirmed price", async () => {
    const withVenue = edition({
      approved: true,
      approvedAt: "2026-10-16T09:00:00.000Z",
      items: [item({ id: "named-pub", venueId: "venue-eltcmh" }), item({ id: "unnamed" })],
    });
    editionFilesForPage = [withVenue];
    confirmedPrices = new Map([
      [
        "venue-eltcmh",
        {
          standing: "confirmed",
          reason: "confirmed_in_window",
          priceGbp: 6.2,
          sourceUrl: null,
          asOf: "2026-10-10T20:00:00.000Z",
          basis: null,
          sampleSize: null,
        },
      ],
    ]);
    const html = await renderPage();
    expect(html).toContain("Our price");
    expect(html).toContain("£6.20");
    expect(html.match(new RegExp(NOT_CHECKED_LABEL, "g"))?.length).toBe(1);
  });
});

describe("Price Pulse: nothing feeds a price surface", () => {
  // The only files allowed to know Price Pulse exists. A new importer is a
  // review question, so it fails here until it is named.
  const ALLOWED_IMPORTERS = new Set([
    "app/price-pulse/page.tsx",
    "app/price-pulse/opengraph-image.tsx",
    "app/sitemap.ts",
    "lib/pricePulse.server.ts",
    "lib/pricePulseExplainer.ts",
  ]);

  it("is imported by its own route and nothing else", () => {
    const importers = sourceFiles
      .filter((file) => /from\s+["']@\/lib\/pricePulse(Editions|Explainer|\.server)?["']/.test(readFileSync(file, "utf8")))
      .map((file) => relative(ROOT, file));
    expect(new Set(importers)).toEqual(ALLOWED_IMPORTERS);
  });

  it("its edition files are read by the registry and the draft script alone", () => {
    const readers = sourceFiles
      .filter((file) => readFileSync(file, "utf8").includes("data/price-pulse"))
      .map((file) => relative(ROOT, file));
    expect(new Set(readers)).toEqual(
      new Set(["lib/pricePulseEditions.ts", "lib/pricePulse.ts", "scripts/price-pulse/draft-edition.mjs"]),
    );
  });

  it("is not reached by any module that answers a price today", () => {
    const CURRENT_PRICE_MODULES = [
      "components/map/canvas/geojson.ts",
      "components/map/canvas/buildScene.ts",
      "components/map/canvas/filters.ts",
      "components/map/communityPriceSignals.ts",
      "lib/venues.ts",
      "lib/venuePriceLane.ts",
      "lib/venuePriceIndex.ts",
      "lib/priceTier.ts",
      "lib/pintTrust.ts",
      "lib/pintDropsStore.ts",
      "lib/pintDropConfirmation.ts",
      "lib/communityPrice.ts",
      "lib/mapPriceLegend.ts",
      "lib/pintIndex.ts",
      "lib/pintIndexFromConfirmations.ts",
      "lib/ukPriceBundle.ts",
      "lib/freshness.ts",
    ];
    for (const modulePath of CURRENT_PRICE_MODULES) {
      let source: string;
      try {
        source = readFileSync(join(ROOT, modulePath), "utf8");
      } catch {
        continue;
      }
      expect(source, `${modulePath} must not read Price Pulse`).not.toMatch(/pricePulse|price-pulse/);
    }
  });

  it("an item holds no number, so a merge has no figure to take", () => {
    for (const { raw } of rawEditions) {
      const items = (raw as { items: unknown[] }).items;
      const walk = (value: unknown, path: string) => {
        expect(typeof value, `${path} is a number`).not.toBe("number");
        if (value && typeof value === "object") {
          for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`);
        }
      };
      items.forEach((line, i) => walk(line, `items[${i}]`));
    }
  });

  it("no edition source has been written into a price feed", () => {
    const feeds = [
      "public/data/drink_price_updates/latest.json",
      "public/data/price_updates/latest.json",
      "public/data/pint_index_snapshot.json",
      "data/freshness_registry.json",
    ];
    const urls = rawEditions.flatMap(({ raw }) => parsed(raw).items.map((line) => line.source.url));
    for (const feed of feeds) {
      let text: string;
      try {
        text = readFileSync(join(ROOT, feed), "utf8");
      } catch {
        continue;
      }
      expect(text, `${feed} must not mention Price Pulse`).not.toMatch(/price-pulse|pricePulse/);
      for (const url of urls) expect(text, `${feed} must not cite ${url}`).not.toContain(url);
    }
  });
});

describe("Where your £6 goes", () => {
  it("splits £6 into VAT, duty and the rest, and the parts sum to the price", () => {
    const split = splitPintPrice();
    expect(split.vatGbp).toBe(1);
    expect(split.dutyGbp).toBe(0.5);
    expect(split.restGbp).toBe(4.5);
    expect(Math.round((split.vatGbp + split.dutyGbp + split.restGbp) * 100)).toBe(EXAMPLE_PINT_GBP * 100);
  });

  it("computes duty from the published rate, never a typed figure", () => {
    expect(splitPintPrice(6, 5).dutyGbp).toBe(
      Math.round(PINT_LITRES * 0.05 * DRAUGHT_BEER_DUTY_PER_LITRE_ALCOHOL_GBP * 100) / 100,
    );
  });

  it("cites a dated GOV.UK page for every rate", () => {
    expect(EXPLAINER_RATES.map((r) => r.id).sort()).toEqual(["duty", "vat"]);
    for (const rate of EXPLAINER_RATES) {
      expect(rate.source.url).toMatch(/^https:\/\/www\.gov\.uk\//);
      expect(isCalendarDay(rate.source.publishedOn)).toBe(true);
    }
  });

  it("puts the tax view and the pub-company view side by side, each sourced and dated", () => {
    expect(EXPLAINER_VIEWS.map((v) => v.id)).toEqual(["tax", "tie"]);
    for (const view of EXPLAINER_VIEWS) {
      expect(view.points.length).toBeGreaterThan(0);
      for (const point of view.points) {
        expect(point.source.url).toMatch(/^https:\/\//);
        expect(isCalendarDay(point.source.publishedOn)).toBe(true);
      }
    }
  });

  it("estimates no margin for any pub", () => {
    const source = readFileSync(join(ROOT, "lib/pricePulseExplainer.ts"), "utf8");
    expect(source).not.toMatch(/venueId|marginGbp|profitGbp/);
  });
});

describe("Price Pulse: the doors in", () => {
  it("the map's price key links to it", async () => {
    const { default: MapKey } = await import("@/components/map/MapKey");
    const { mapPriceLegend } = await import("@/lib/mapPriceLegend");
    const html = renderToStaticMarkup(
      createElement(MapKey, {
        legend: mapPriceLegend({
          kind: "default",
          renderedState: { priceBands: [], storyColour: null, clusterPrices: false },
        }),
      }),
    );
    expect(html).toContain('href="/price-pulse"');
  });

  it("/today's pint card links to it", () => {
    expect(readFileSync(join(ROOT, "app/today/TodayPintsCard.tsx"), "utf8")).toContain('href="/price-pulse"');
  });

  it("the sitemap dates it by its newest approval", () => {
    const approved = parsed(edition({ approved: true, approvedAt: "2026-10-23T09:00:00.000Z" }));
    expect(pricePulseLastModified([approved], "2026-10-16").toISOString()).toBe("2026-10-23T09:00:00.000Z");
    expect(pricePulseLastModified([], "2026-10-16").toISOString()).toBe("2026-10-16T00:00:00.000Z");
  });
});
