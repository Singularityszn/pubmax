import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET } from "@/app/api/freshness/route";
import {
  __resetFeedFreshnessStore,
  memoryFeedFreshnessStore,
} from "@/lib/feedFreshnessStore";

beforeEach(() => {
  __resetFeedFreshnessStore();
});

afterEach(() => {
  __resetFeedFreshnessStore();
});

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
    const known = new Set(["live", "fresh", "stale", "untracked", "unknown"]);
    for (const d of body.datasets) {
      expect(known.has(d.status)).toBe(true);
      expect(typeof d.cadence).toBe("string");
      expect(d.cadence.length).toBeGreaterThan(0);
    }

    // The summary counts sum to the dataset count.
    const summed = Object.values(body.summary).reduce((a, b) => a + b, 0);
    expect(summed).toBe(body.datasets.length);
  });

  it("never surfaces a broken bundled artifact as an unresolved stamp", async () => {
    // The shipped, artifact-backed datasets are all valid, so none of THEM should
    // read as "unknown" (that status is reserved for a genuinely missing/broken
    // file). The two store-only feeds (price_update_retrieval,
    // night_signal_candidates) have no artifact at all: with no Supabase
    // configured in this test run they honestly read "unknown" — unmeasurable
    // without credentials, never a silent fresh — which is the whole point of
    // the store-kind stamp, not a broken artifact.
    const STORE_ONLY_FEEDS = new Set(["price_update_retrieval", "night_signal_candidates"]);
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

  it("reads price_update_retrieval only from the durable store, never from a disk fallback", async () => {
    // price_update_retrieval has no committed artifact — it declares a
    // {kind:"store"} stamp and resolves ONLY from the real feed_freshness table
    // (lib/freshnessStoreOverlay.ts resolveDurableFeedStoreReads, covered
    // end-to-end with a mocked Supabase client in freshnessStoreOverlay.test.ts,
    // including the unreachable case). Stamping the legacy in-memory overlay
    // store must NOT leak into this dataset's reading: that store is for feeds
    // that still fall back to a disk stamp, which this feed no longer has.
    const observedAt = "2026-07-27T07:00:00.000Z";
    await memoryFeedFreshnessStore.stamp({
      feed: "price_update_retrieval",
      observedAt,
      rowsServed: 2,
      note: "valid permissible-source rows retrieved",
    });

    const res = await GET();
    const body = (await res.json()) as {
      datasets: Array<{ id: string; observedAt: string | null; status: string; detail: string }>;
    };

    const retrieval = body.datasets.find((dataset) => dataset.id === "price_update_retrieval");
    // With no Supabase configured in this test run, the durable store is
    // genuinely unmeasurable — the memory-store stamp above must not surface.
    expect(retrieval?.observedAt).not.toBe(observedAt);
    expect(retrieval?.status).toBe("unknown");
    expect(retrieval?.detail).toContain("unmeasurable without credentials");

    // A retrieval the cron cannot publish must never freshen the served file.
    const published = body.datasets.find((dataset) => dataset.id === "price_updates");
    expect(published?.observedAt).not.toBe(observedAt);
  });
});
