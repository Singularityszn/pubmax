import { describe, expect, it } from "vitest";

import { GET } from "@/app/api/freshness/route";

// The route reads the real registry (data/freshness_registry.json) and the real
// bundled artifacts from process.cwd(), so it exercises the whole spine end to
// end. It must never throw, must return a cacheable 200, and must expose one
// status per registered dataset.
describe("GET /api/freshness", () => {
  it("returns a cacheable 200 with a dataset per registry entry", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("s-maxage");

    const body = (await res.json()) as {
      version: number;
      generatedAt: string;
      summary: Record<string, number>;
      datasets: Array<{ id: string; status: string; cadence: string }>;
    };

    expect(body.version).toBe(1);
    expect(Number.isFinite(Date.parse(body.generatedAt))).toBe(true);
    expect(Array.isArray(body.datasets)).toBe(true);
    expect(body.datasets.length).toBeGreaterThan(0);

    // Every entry carries a known status and its human cadence label.
    const known = new Set([
      "live",
      "fresh",
      "snapshot",
      "stale",
      "untracked",
      "unknown",
    ]);
    for (const d of body.datasets) {
      expect(known.has(d.status)).toBe(true);
      expect(typeof d.cadence).toBe("string");
      expect(d.cadence.length).toBeGreaterThan(0);
    }

    // The summary counts sum to the dataset count.
    const summed = Object.values(body.summary).reduce((a, b) => a + b, 0);
    expect(summed).toBe(body.datasets.length);
  });

  it("names the hand-collected pint bundle a snapshot, with its observed date", async () => {
    // The bundle sits months inside its 2160h neglect ceiling, so the budget
    // alone would report it "fresh". An episodic feed past 30 days is named for
    // the day it was collected instead, and the date rides with the name.
    //
    // The route ages against the real clock, so the assertion is what the route
    // may NEVER say (fresh) plus the two honest answers: snapshot today, and
    // stale once nobody has re-collected the bundle inside its budget. The
    // clock-independent proof that this exact registry entry reads "snapshot"
    // is in __tests__/priceFreshnessHonesty.test.ts, on fixed dates.
    const res = await GET();
    const body = (await res.json()) as {
      datasets: Array<{ id: string; status: string; observedAt: string | null }>;
    };
    const pint = body.datasets.find((d) => d.id === "pint_prices");

    expect(pint?.status).not.toBe("fresh");
    expect(["snapshot", "stale"]).toContain(pint?.status);
    expect(pint?.observedAt).toBe("2026-07-03T12:00:00Z");
  });

  it("never surfaces a broken bundled artifact as an unresolved stamp", async () => {
    // The shipped, artifact-backed datasets are all valid, so none of THEM should
    // read as "unknown" (that status is reserved for a genuinely missing/broken
    // file). The store-only night_signal_candidates and whats_on feeds have no
    // artifact at all:
    // with no Supabase
    // configured in this test run they honestly read "unknown" — unmeasurable
    // without credentials, never a silent fresh — which is the whole point of
    // the store-kind stamp, not a broken artifact.
    const STORE_ONLY_FEEDS = new Set(["night_signal_candidates", "whats_on"]);
    const res = await GET();
    const body = (await res.json()) as { datasets: Array<{ id: string; status: string }> };
    const unexpectedUnknown = body.datasets.filter(
      (d) => d.status === "unknown" && !STORE_ONLY_FEEDS.has(d.id),
    );
    expect(unexpectedUnknown).toEqual([]);
  });

  it("exposes the corroborated community-price count", async () => {
    const res = await GET();
    const body = (await res.json()) as {
      communityPrices?: {
        corroboratedCategories: number;
        truncated: boolean;
        degraded: boolean;
      };
    };
    // Read-only aggregation: with no submissions in this process it is an
    // honest 0, never absent and never degraded.
    expect(body.communityPrices).toEqual({
      corroboratedCategories: 0,
      truncated: false,
      degraded: false,
    });
  });

});
