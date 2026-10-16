import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { legacyPintPriceObservedOn, type LegacyPintPrice } from "@/lib/drinks";
import { cheapestPriceReadDay, priceRowReadDay } from "@/lib/priceReadDay.mjs";

// The map index stamps each pub's `priceObservedAt` at build time
// (scripts/build_slim_index.mjs) so a pin can show an aging price as aging
// (owner decision 16 Oct 2026). The build reads the day through a plain-ESM
// leaf, so this holds that leaf to the app's own reading of the same row.

const dataset = JSON.parse(
  readFileSync(join(process.cwd(), "public/data/pint_prices_app_dataset.json"), "utf8"),
) as LegacyPintPrice[];

describe("priceRowReadDay", () => {
  it("reads every shipped row the way the app does", () => {
    const disagreements = dataset
      .filter((row) => priceRowReadDay(row) !== legacyPintPriceObservedOn(row))
      .map((row) => row.scraped_at_values);
    expect(disagreements).toEqual([]);
  });

  it("takes the latest read, in London, and nothing from a row that records none", () => {
    expect(priceRowReadDay({ scraped_at_values: "2026-01-02T10:00:00Z|2026-10-01T23:30:00Z" })).toBe(
      "2026-10-02",
    );
    expect(priceRowReadDay({ scraped_at_values: "" })).toBeNull();
    expect(priceRowReadDay({ scraped_at_values: "not a day" })).toBeNull();
    expect(priceRowReadDay(null)).toBeNull();
  });
});

describe("cheapestPriceReadDay", () => {
  it("dates the cheapest figure by the freshest row that states it", () => {
    const rows = [
      { price_gbp: 4.5, scraped_at_values: "2026-01-01" },
      { price_gbp: 4.5, scraped_at_values: "2026-09-01" },
      { price_gbp: 6.1, scraped_at_values: "2026-10-10" },
    ];
    expect(cheapestPriceReadDay(rows, 4.5)).toBe("2026-09-01");
  });

  it("gives no day when no row stating the figure records a read", () => {
    expect(cheapestPriceReadDay([{ price_gbp: 4.5, scraped_at_values: "" }], 4.5)).toBeNull();
    expect(cheapestPriceReadDay([{ price_gbp: 4.5, scraped_at_values: "2026-09-01" }], null)).toBeNull();
  });
});

describe("the shipped map index", () => {
  it("dates prices as plain London days, none of them in the future", () => {
    const manifest = JSON.parse(
      readFileSync(join(process.cwd(), "public/data/venues_slim.manifest.json"), "utf8"),
    ) as { shards: { url: string }[] };
    const today = new Date().toISOString().slice(0, 10);
    let dated = 0;
    for (const shard of manifest.shards) {
      const file = join(process.cwd(), "public", shard.url.replace(/^\//, ""));
      const { rows } = JSON.parse(readFileSync(file, "utf8")) as {
        rows: { priceObservedAt?: unknown; cheapestPrice: unknown }[];
      };
      for (const row of rows) {
        if (row.priceObservedAt === undefined) continue;
        dated += 1;
        expect(row.priceObservedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(String(row.priceObservedAt) <= today).toBe(true);
        expect(typeof row.cheapestPrice).toBe("number");
      }
    }
    expect(dated).toBeGreaterThan(0);
  });
});
