// THE RECEIPT NAMES THE PAGE THAT SERVED ITS WORDS.
//
// scripts/harvest/uk-prices/record-later-publications.mjs re-reads each source
// page to keep a verbatim excerpt beside the rows it published. The host picks
// the last hop, so the excerpt can come from a page other than the source URL.
// These cases pin that the landing is asked about (source policy, then robots)
// and that the read answers the landing as `evidenceUrl`.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import type { RobotsChecker } from "@/lib/harvest/robots";

import { readCapturedSectionPrices, readEvidence } from "../scripts/harvest/uk-prices/record-later-publications.mjs";

const ROWS = [{ priceGbp: 6.5 }];
const PAGE = "<html><body><p>Neck Oil IPA pint £6.50</p></body></html>";

/** A fetch that answers one page and reports where it landed. */
function landingFetch(landedUrl: string, body = PAGE): typeof fetch {
  return (async () => ({
    ok: true,
    status: 200,
    url: landedUrl,
    headers: new Headers({ "content-type": "text/html" }),
    text: async () => body,
    body: null,
  })) as unknown as typeof fetch;
}

function robotsAllowing(allowed: (url: string) => boolean): RobotsChecker {
  return async (url: string) =>
    allowed(url)
      ? { allowed: true, reason: "no-rules-published", robots: "absent", evidence: "test" }
      : { allowed: false, reason: "robots-disallowed", robots: "rules-file", evidence: "test" };
}

describe("the evidence re-read", () => {
  it("keeps the complete menu for replay, including headings and later prices", async () => {
    const menu = `Cocktails ${"Menu introduction. ".repeat(50)}Golden Fig £12 ${"Menu description. ".repeat(50)}Jungle Bird £13`;
    const read = await readEvidence(
      "https://thelamb.example/menu", [{ priceGbp: 12 }], robotsAllowing(() => true),
      landingFetch("https://thelamb.example/menu", `<html><body>${menu}</body></html>`),
    );
    expect(read.evidence).toBe(menu);
  });

  it("captures the text layer of a permitted PDF menu for replay", async () => {
    const stream = "BT /F1 12 Tf 40 760 Td (Cocktails) Tj 0 -20 Td (Manhattan \\24312.50) Tj ET";
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ];
    let pdf = "%PDF-1.4\n";
    const offsets = objects.map((body, i) => {
      const offset = pdf.length;
      pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
      return offset;
    });
    const xref = pdf.length;
    pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    const response = new Response(Buffer.from(pdf, "latin1"), { headers: { "content-type": "application/pdf" } });
    const read = await readEvidence(
      "https://thelamb.example/menu.pdf", [{ priceGbp: 12.5 }], robotsAllowing(() => true),
      (async () => response) as typeof fetch,
    );
    expect(readCapturedSectionPrices(read.evidence, ["Manhattan"])).toEqual([
      { drinkLabel: "Manhattan", category: "cocktail", priceGbp: 12.5 },
    ]);
  });

  it("names the landing page when a permitted redirect serves the excerpt", async () => {
    const read = await readEvidence(
      "https://thelamb.example/menu",
      ROWS,
      robotsAllowing(() => true),
      landingFetch("https://thelamb.example/drinks/2026"),
    );
    expect(read.evidence).toContain("£6.50");
    expect(read.evidenceUrl).toBe("https://thelamb.example/drinks/2026");
  });

  it("keeps no excerpt when the landing page's robots rules refuse it", async () => {
    const read = await readEvidence(
      "https://thelamb.example/menu",
      ROWS,
      robotsAllowing((url) => !url.includes("/drinks/")),
      landingFetch("https://thelamb.example/drinks/2026"),
    );
    expect(read.evidence).toMatch(/^not re-read: redirected to https:\/\/thelamb\.example\/drinks\/2026, robots/);
    expect(read.evidence).not.toContain("£6.50");
  });

  it("names the source itself when nothing redirected", async () => {
    const read = await readEvidence(
      "https://thelamb.example/menu",
      ROWS,
      robotsAllowing(() => true),
      landingFetch("https://thelamb.example/menu"),
    );
    expect(read.evidenceUrl).toBe("https://thelamb.example/menu");
  });
});

describe("saved menu section reader", () => {
  it("reads printed titles after ingredients and letter-spaced PDF headings", () => {
    const text = "CO C K TA I L S\nNegroni £12.50\nGin, Campari, vermouth\nJungle Bird £12.50\nRum, pineapple\nGolden Fig   .......... £11.50\nTequila, fig\nSPARKLING & CHAMPAGNE\nProsecco £39.50";
    expect(readCapturedSectionPrices(text, ["Negroni", "Jungle Bird", "Golden Fig", "Gin"])).toEqual([
      { drinkLabel: "Negroni", category: "cocktail", priceGbp: 12.5 },
      { drinkLabel: "Jungle Bird", category: "cocktail", priceGbp: 12.5 },
      { drinkLabel: "Golden Fig", category: "cocktail", priceGbp: 11.5 },
    ]);
  });

  it("reads a title before its price after the preceding drink's inline ingredients", () => {
    expect(readCapturedSectionPrices("Cocktails Picante Spritz £12 Tequila, Honey, Lime, Soda Yuzu Honeybee £13 Jameson Irish Whiskey, Ginger Ale", ["Picante Spritz", "Yuzu Honeybee", "Tequila"])).toEqual([
      { drinkLabel: "Picante Spritz", category: "cocktail", priceGbp: 12 },
      { drinkLabel: "Yuzu Honeybee", category: "cocktail", priceGbp: 13 },
    ]);
  });

  it("reads the Marquess drinks excerpt without classifying its snacks as drinks", () => {
    const text = "Savoursmith crisps £1.6 Dry Roasted Peanuts or Salted Crust Peanuts £2.25 Tea & Coffee Birchall Tea £3.5 English Breakfast, Peppermint, Earl Grey, Green Tea Flat White £3.75 Cafe Latte £4 Espresso £3 Hot Chocolate £4.25";
    expect(readCapturedSectionPrices(text)).toEqual([
      { drinkLabel: "Birchall Tea", category: "other", priceGbp: 3.5 },
      { drinkLabel: "Flat White", category: "coffee", priceGbp: 3.75 },
      { drinkLabel: "Cafe Latte", category: "coffee", priceGbp: 4 },
      { drinkLabel: "Espresso", category: "coffee", priceGbp: 3 },
      { drinkLabel: "Hot Chocolate", category: "other", priceGbp: 4.25 },
    ]);
  });

  it("does not keep an unnamed item under a drinks heading when it is food", () => {
    expect(readCapturedSectionPrices("Cocktails Garlic bread, mozzarella, rocket £6.50 Negroni Gin, Campari £12", ["Negroni"])).toEqual([
      { drinkLabel: "Negroni", category: "cocktail", priceGbp: 12 },
    ]);
  });

  it("names a drink by the clean title printed just before its price", () => {
    const foggs = "Cocktails\n12 Years Old Scotch whisky,\nBacardi Caribbean Spiced rum, chocolate & orange bitters \nPERFECT TIMING   £15 \nSPICY / VIBRANT \n"
      + "Patrón Silver tequila, Cointreau, chipotle chilli\nAZTEC EMBERS   £15 \nAROMATIC / CITRUSY \nDel Maguey Vida mezcal, Aperol\n"
      + "Moscow Mule   £13.5 \n42 Below vodka, lime,\nFranklin & Sons Ginger Beer \n";
    expect(readCapturedSectionPrices(foggs)).toEqual([
      { drinkLabel: "PERFECT TIMING", category: "cocktail", priceGbp: 15 },
      { drinkLabel: "AZTEC EMBERS", category: "cocktail", priceGbp: 15 },
      { drinkLabel: "Moscow Mule", category: "cocktail", priceGbp: 13.5 },
    ]);
  });

  it("names a flattened drink by the title after the previous drink's calorie note", () => {
    const richard = "Winter Coolers Apple & Elderflower £5.20 Elderflower, Apple, Raspberry, Orange Blossom, Soda 88 kcal Cranberry & Mint £5.20 "
      + "Cranberry, Moroccan & English Mint, Fever-Tree Ginger Ale 45 kcal Mindful Blends TRIP Elderflower Mint £4.70 Magnesium, Lion's Mane, Lemon Balm 22 kcal "
      + "Ginger Yuzu Fizz £7.50 Three Spirit Social, Yuzu Sherbet, Fever-Tree Ginger Ale 84 kcal";
    expect(readCapturedSectionPrices(richard)).toEqual([
      { drinkLabel: "Apple & Elderflower", category: "soft-drink", priceGbp: 5.2 },
      { drinkLabel: "Cranberry & Mint", category: "soft-drink", priceGbp: 5.2 },
      { drinkLabel: "TRIP Elderflower Mint", category: "alcohol-free", priceGbp: 4.7 },
      { drinkLabel: "Ginger Yuzu Fizz", category: "alcohol-free", priceGbp: 7.5 },
    ]);
  });

  it("reads a dot-leader title and files a zero-strength cocktail as alcohol-free", () => {
    const bear = "Cocktails\nFig Negroni   ...............................   £13.5 \nPlymouth Gin, Campari, Fig Liqueur \n"
      + "Negroni 0.0   AF   ...................   £10.5 \nTanqueray 0.0%, Lyre’s Italian Spritz \n";
    expect(readCapturedSectionPrices(bear)).toEqual([
      { drinkLabel: "Fig Negroni", category: "cocktail", priceGbp: 13.5 },
      { drinkLabel: "Negroni 0.0 AF", category: "alcohol-free", priceGbp: 10.5 },
    ]);
  });

  it("does not file an alcoholic title under a scrambled alcohol-free heading", () => {
    const balls = "NO & LOW \nSHOOTERS \nAperol Spritz   £12.50 \nAperol, prosecco, soda \nHugo Spritz   £12.50 \nBeefeater gin, prosecco \n";
    expect(readCapturedSectionPrices(balls)).toEqual([]);
  });

  it("skips a glass, bottle and magnum row whose columns state no measure on the line", () => {
    const foggs = "Cocktails\nGlass   Bottle   Magnum \nMOËT & CHANDON IMPÉRIAL BLANC N.V.   £15   £79   £185 \n";
    expect(readCapturedSectionPrices(foggs)).toEqual([]);
    for (const columns of ["£12 / £23 / £46", "£12/£23/£46", "£12 | £23 | £46"]) {
      expect(readCapturedSectionPrices(`Cocktails\nGarden Punch ${columns}\n`)).toEqual([]);
    }
  });

  it("never takes an ingredient list, a size word or a serving marker as a title", () => {
    const text = "Menu Spritz Pomegranate gi Fizz Plymouth Gin, Elderflower, Pomegranate, Cranberry, Prosecco, Soda £12.00 "
      + "Cocktails\nLarge   £5 \nGermany   ..........   S   £7 \n";
    expect(readCapturedSectionPrices(text)).toEqual([]);
  });

  it("uses a drink heading for the Duke titles without using their ingredients as names", () => {
    const text = "Back to the top of the Menu Spritz Winter Sangria Martini Rosso, Burnt Faith Peach Liqueur, Fever-Tree Blood Orange Soda £11.50 Yuzu Honeybee Jameson Irish Whiskey, Beesou Honey Aperitif, Yuzu Sherbet, Fever-Tree Ginger Ale £13.00 Cocktails Espresso Martini Absolut Vodka, Kahlúa, Coffee £12.50";
    expect(readCapturedSectionPrices(text, ["Winter Sangria", "Yuzu Honeybee", "Espresso Martini", "Jameson"])).toEqual([
      { drinkLabel: "Winter Sangria", category: "cocktail", priceGbp: 11.5 },
      { drinkLabel: "Yuzu Honeybee", category: "cocktail", priceGbp: 13 },
      { drinkLabel: "Espresso Martini", category: "cocktail", priceGbp: 12.5 },
    ]);
    expect(readCapturedSectionPrices("Yuzu Honeybee Jameson Irish Whiskey, Soda £13", ["Yuzu Honeybee"])).toEqual([]);
  });

  it("takes figures from the saved page and preserves each explicit measure", () => {
    expect(readCapturedSectionPrices("Bottled Beers/Ciders\nHeineken £4.35\nStella £4.35\nWine\nOrchard Light 125ml £5.50 250ml £9 Bottle £25", ["Heineken", "Stella", "Orchard Light"])).toEqual([
      { drinkLabel: "Heineken", category: "beer", priceGbp: 4.35, servingSize: "bottle" },
      { drinkLabel: "Stella", category: "beer", priceGbp: 4.35, servingSize: "bottle" },
      { drinkLabel: "Orchard Light", category: "wine", priceGbp: 5.5, servingSize: "125ml" },
      { drinkLabel: "Orchard Light", category: "wine", priceGbp: 9, servingSize: "250ml" },
      { drinkLabel: "Orchard Light", category: "wine", priceGbp: 25, servingSize: "bottle" },
    ]);
  });

  it("ends category inheritance at a food heading", () => {
    expect(readCapturedSectionPrices("Cocktails\nGolden Fig £12\nFood\nBombay Aloo £6\nSoft Drinks\nGarden Fizz £4", ["Golden Fig", "Bombay Aloo", "Garden Fizz"])).toEqual([
      { drinkLabel: "Golden Fig", category: "cocktail", priceGbp: 12 },
      { drinkLabel: "Garden Fizz", category: "soft-drink", priceGbp: 4 },
    ]);
    expect(readCapturedSectionPrices("not re-read as text: the page is a PDF", ["Jungle Bird"])).toEqual([]);
    expect(readCapturedSectionPrices("Cocktails\nGolden Fig 2 for £9", ["Golden Fig"])).toEqual([]);
    expect(readCapturedSectionPrices("Beer\nHeineken £4.35", ["Heineken"])).toEqual([]);
  });
});

describe("saved publication replay ledger preservation", () => {
  function fixture(unrecordedTail: boolean) {
    const root = mkdtempSync(join(process.cwd(), ".publication-replay-"));
    const row = {
      venueId: "venue-test", category: "cocktail", drinkLabel: "Negroni", priceGbp: 12,
      sourceUrl: "https://thelamb.example/menu", observedAt: "2026-11-22T12:00:00.000Z",
    };
    const prefix = `${JSON.stringify({ ...row, drinkLabel: "Old Fashioned" })}\n`;
    const evidencePath = "data/uk_prices/later_publications/menu.json";
    const files = {
      "data/uk_prices/site_harvest.jsonl": prefix + `${JSON.stringify(row)}\n`
        + (unrecordedTail ? `${JSON.stringify({ ...row, drinkLabel: "Unrecorded Martini" })}\n` : ""),
      "data/uk_prices/site_harvest_reconciliation.json": JSON.stringify({
        postReconciliationPublication: {
          currentLedger: { rowCount: 1, sha256: createHash("sha256").update(prefix).digest("hex") },
        },
        laterPublications: [{
          sourceEvidencePath: evidencePath, sourceObservedAt: row.observedAt,
          sourceUrl: row.sourceUrl, currentLedger: { rowCount: 2 },
        }],
      }),
      [evidencePath]: JSON.stringify({
        sourceUrl: row.sourceUrl, reader: "test capture", rows: [row],
        evidence: "Cocktails Negroni £12 Jungle Bird £13",
      }),
      "public/data/uk_prices/rows.json": "[]",
      "candidates.jsonl": JSON.stringify({ sourceUrl: row.sourceUrl, drinkLabel: "Jungle Bird" }),
    };
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), text);
    }
    const replay = (options: string[] = []) => spawnSync(process.execPath, [
      "--import", join(process.cwd(), "node_modules/tsx/dist/loader.mjs"),
      join(process.cwd(), "scripts/harvest/uk-prices/record-later-publications.mjs"),
      "--replay-saved", "2026-11-22", "--candidates", join(root, "candidates.jsonl"), ...options,
    ], {
      cwd: root, encoding: "utf8",
      env: { ...process.env, TSX_TSCONFIG_PATH: join(process.cwd(), "tsconfig.json") },
    });
    return { root, files, replay };
  }

  it.each([false, true])("refuses an unrecorded crawl tail before any write (dry run: %s)", (dryRun) => {
    const { root, files, replay } = fixture(true);
    try {
      const result = replay(dryRun ? ["--dry-run"] : []);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("unrecorded ledger rows");
      for (const [file, text] of Object.entries(files)) {
        expect(readFileSync(join(root, file), "utf8")).toBe(text);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("preserves recorded rows and adds a named drink when the ledger ends at the publication", () => {
    const { root, replay } = fixture(false);
    try {
      const result = replay();
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      const ledger = readFileSync(join(root, "data/uk_prices/site_harvest.jsonl"), "utf8")
        .trim().split("\n").map((line) => JSON.parse(line));
      expect(ledger.map((row) => row.drinkLabel)).toEqual(["Old Fashioned", "Negroni", "Jungle Bird"]);
      expect(ledger[2]).toMatchObject({ category: "cocktail", priceGbp: 13 });
      const report = JSON.parse(readFileSync(join(root, "data/uk_prices/site_harvest_reconciliation.json"), "utf8"));
      expect(report.laterPublications[0].currentLedger.rowCount).toBe(3);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
