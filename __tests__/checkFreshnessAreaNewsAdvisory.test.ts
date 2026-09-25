import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  evaluateFreshness,
  freshnessGateFailed,
} from "@/scripts/check_freshness.mjs";

const ROOT = process.cwd();

describe("check:freshness area_news advisory", () => {
  it("does not fail the gate when only area_news is stale", async () => {
    const now = new Date("2099-06-01T12:00:00.000Z");
    const base = JSON.parse(readFileSync(join(ROOT, "data/freshness_registry.json"), "utf8"));
    const areaNews = base.datasets.find((d: { id: string }) => d.id === "area_news");
    expect(areaNews).toBeDefined();

    const { results } = await evaluateFreshness({
      registry: { version: base.version, datasets: [areaNews] },
      now,
      rootDir: ROOT,
    });
    expect(results[0].status).toBe("stale");
    expect(freshnessGateFailed(results)).toBe(false);
  });

  it("still fails the gate when a non-advisory dataset is stale", async () => {
    const now = new Date("2099-06-01T12:00:00.000Z");
    const base = JSON.parse(readFileSync(join(ROOT, "data/freshness_registry.json"), "utf8"));
    const pintPrices = base.datasets.find((d: { id: string }) => d.id === "pint_prices");
    expect(pintPrices).toBeDefined();

    const { results } = await evaluateFreshness({
      registry: { version: base.version, datasets: [pintPrices] },
      now,
      rootDir: ROOT,
    });
    expect(results[0].status).toBe("stale");
    expect(freshnessGateFailed(results)).toBe(true);
  });
});
