import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  evaluateFreshness,
  freshnessGateFailed,
} from "@/scripts/check_freshness.mjs";
import { defined } from "@/__tests__/helpers/defined";

const ROOT = process.cwd();

describe("check:freshness advisory lanes", () => {
  it.each(["area_news", "google_places_content"])("does not fail the gate when only %s is stale", async (id) => {
    const now = new Date("2099-06-01T12:00:00.000Z");
    const base = JSON.parse(readFileSync(join(ROOT, "data/freshness_registry.json"), "utf8"));
    const advisory = base.datasets.find((d: { id: string }) => d.id === id);
    expect(advisory).toBeDefined();

    const { results } = await evaluateFreshness({
      registry: { version: base.version, datasets: [advisory] },
      now,
      rootDir: ROOT,
    });
    expect(defined(results[0]).status).toBe("stale");
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
    expect(defined(results[0]).status).toBe("stale");
    expect(freshnessGateFailed(results)).toBe(true);
  });
});
