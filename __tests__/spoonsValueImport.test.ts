import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  MAX_ROW_TEXT,
  SPOONME_AUTHOR,
  SPOONME_PUBLISHED_AT,
  SPOONME_REPORT_URL,
  checkRowArithmetic,
  checkRowText,
  extractReportData,
  isCreditUrl,
  rankByUnits,
} from "@/scripts/spoonme/import-report.mjs";

const ROOT = process.cwd();

// The importer is what stands between somebody else's table and our pages, so
// its refusals are the interesting half. A row it cannot vouch for is
// QUARANTINED and never repaired: a corrected figure would be a number the
// source never stated.

describe("the basket rule", () => {
  const good = {
    pence: 995,
    milliunits: 12_785,
    drinkCount: 5,
    lines: [
      {
        name: "Stowford Press Apple cider",
        servingLabel: "Pint",
        quantity: 5,
        glasses: 5,
        linePricePence: 995,
        lineMilliunits: 12_785,
      },
    ],
  };

  it("accepts a basket whose own lines add up", () => {
    expect(checkRowArithmetic(good, 1000)).toBeNull();
  });

  it("refuses a basket that costs more than it says", () => {
    const row = { ...good, pence: 900 };
    expect(checkRowArithmetic(row, 1000)).toMatch(/basket costs 995p, row states 900p/);
  });

  it("refuses a basket holding units it did not add up", () => {
    const row = { ...good, milliunits: 20_000 };
    expect(checkRowArithmetic(row, 1000)).toMatch(/milliunits/);
  });

  it("refuses a basket over the budget it was built against", () => {
    const row = {
      ...good,
      pence: 1200,
      lines: [{ ...good.lines[0], linePricePence: 1200 }],
    };
    expect(checkRowArithmetic(row, 1000)).toMatch(/over the 1000p budget/);
  });

  it("refuses a basket whose glass count disagrees with its lines", () => {
    expect(checkRowArithmetic({ ...good, drinkCount: 9 }, 1000)).toMatch(/glasses/);
  });

  it("refuses a row with no basket at all, rather than scoring it zero", () => {
    expect(checkRowArithmetic({ ...good, lines: [] }, 1000)).toBe("no basket lines");
  });

  it("refuses a line that states no price or no units", () => {
    expect(
      checkRowArithmetic(
        { ...good, lines: [{ ...good.lines[0], linePricePence: null }] },
        1000,
      ),
    ).toMatch(/states no price/);
    expect(
      checkRowArithmetic(
        { ...good, lines: [{ ...good.lines[0], lineMilliunits: 0 }] },
        1000,
      ),
    ).toMatch(/states no units/);
  });
});

describe("the rank rule", () => {
  it("ranks most units first", () => {
    const ranks = rankByUnits([
      { id: "a", milliunits: 10_000, pence: 999 },
      { id: "b", milliunits: 15_000, pence: 999 },
    ]);
    expect(ranks.get("b")).toBe(1);
    expect(ranks.get("a")).toBe(2);
  });

  it("ties on units alone, because a tenner buys the same either way", () => {
    // The two pubs hand over identical units; one has 3p left over. That is
    // not a better answer to the question, so they share a rank.
    const ranks = rankByUnits([
      { id: "a", milliunits: 15_000, pence: 999 },
      { id: "b", milliunits: 15_000, pence: 996 },
      { id: "c", milliunits: 10_000, pence: 999 },
    ]);
    expect(ranks.get("a")).toBe(1);
    expect(ranks.get("b")).toBe(1);
    expect(ranks.get("c")).toBe(3);
  });
});

describe("the credit the pack is required to carry", () => {
  const pack = JSON.parse(
    readFileSync(join(ROOT, "public", "data", "spoonme", "rows.json"), "utf8"),
  );

  it("names the source, the author, the day and the bytes it was read from", () => {
    expect(pack.provenance.sourceUrl).toBe(SPOONME_REPORT_URL);
    expect(pack.provenance.author).toBe(SPOONME_AUTHOR);
    expect(pack.provenance.publishedAt).toBe(SPOONME_PUBLISHED_AT);
    expect(pack.provenance.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(pack.provenance.kind).toBe("third-party-analysis");
  });

  it("states the licence honestly rather than claiming one", () => {
    expect(pack.provenance.licence).toMatch(/no licence stated/i);
    expect(pack.provenance.licence).toMatch(/credit/i);
  });

  it("says out loud what the pack may not be used for", () => {
    const notes = pack.provenance.notes.join(" ");
    expect(notes).toMatch(/not affiliated with J D Wetherspoon plc/i);
    expect(notes).toMatch(/pin price colour/i);
    expect(notes).toMatch(/Pint Index/);
  });

  it("carries the retrieval day where the freshness registry reads it", () => {
    // The registry reads a stamp by a FLAT field name, so this mirror is what
    // makes the lane measurable at all.
    expect(pack.retrievedAt).toBe(pack.provenance.retrievedAt);
    const registry = JSON.parse(
      readFileSync(join(ROOT, "data", "freshness_registry.json"), "utf8"),
    );
    const row = registry.datasets.find(
      (dataset: { id: string }) => dataset.id === "spoons_value",
    );
    expect(row.stamp).toEqual({ kind: "field", pointer: "retrievedAt" });
    expect(row.artifact).toBe("public/data/spoonme/rows.json");
    // Nothing we run can advance somebody else's reading of a menu, so the
    // lane carries no budget and is named for the day it was retrieved.
    expect(row.class).toBe("snapshot");
    expect(row.stalenessBudgetHours).toBeNull();
  });

  it("keeps a SOURCE.md beside the bytes naming the licence status", () => {
    const source = readFileSync(
      join(ROOT, "public", "data", "spoonme", "SOURCE.md"),
      "utf8",
    );
    expect(source).toContain(SPOONME_REPORT_URL);
    expect(source).toMatch(/unofficial analysis, no licence stated, credited and linked/i);
  });
});

describe("reading the report", () => {
  it("recovers the ranking from a page that inlines it in its flight payload", () => {
    const payload = JSON.stringify({
      builtAt: "2026-09-05T14:26:48.182Z",
      budgetPence: 1000,
      rows: [{ id: "1", name: "The Test", milliunits: 1, pence: 1, lines: [] }],
    });
    const html = `<html><body><script>self.__next_f.push([1,${JSON.stringify(
      `26:I[1,[],"X"]\n27:${payload}\n`,
    )}])</script></body></html>`;
    const data = extractReportData(html);
    expect(data.budgetPence).toBe(1000);
    expect(data.rows).toHaveLength(1);
  });

  it("refuses a page with no ranking rather than writing an empty pack", () => {
    expect(() => extractReportData("<html><body>nothing</body></html>")).toThrow(
      /No ranking rows/,
    );
  });
});

describe("what the importer refuses to write down", () => {
  it("takes only an https credit URL, which is what three surfaces link to", () => {
    expect(isCreditUrl(SPOONME_REPORT_URL)).toBe(true);
    for (const value of [
      "http://spoonme.vercel.app/report",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "spoonme.vercel.app/report",
      "https://spoonme.vercel.app/report with a space",
      "",
      null,
    ]) {
      expect(isCreditUrl(value), String(value)).toBe(false);
    }
  });

  it("quarantines a row whose words would bloat a committed file", () => {
    const row = { name: "The Test", town: "Testbury", postcode: "T1 1TT" };
    expect(checkRowText(row)).toBeNull();
    const long = { ...row, name: "x".repeat(MAX_ROW_TEXT + 1) };
    // The reason names the field and never echoes the value.
    expect(checkRowText(long)).toBe(`name is longer than ${MAX_ROW_TEXT} characters`);
    expect(checkRowText(long)).not.toContain("xxx");
  });
});
