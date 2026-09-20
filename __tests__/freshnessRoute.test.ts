import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { GET } from "@/app/api/freshness/route";
import { SNAPSHOT_AFTER_DAYS } from "@/lib/freshness";

/** The pint bundle's collection stamp, read from its single source of truth. */
function registryPintStamp(): string {
  const registry = JSON.parse(
    readFileSync(join(process.cwd(), "data", "freshness_registry.json"), "utf8"),
  ) as { datasets: { id: string; stamp: { value?: string } | null }[] };
  const value = registry.datasets.find((d) => d.id === "pint_prices")?.stamp?.value;
  if (typeof value !== "string") {
    throw new Error("data/freshness_registry.json: pint_prices has no literal stamp value");
  }
  return value;
}

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
      // A live lane this spine holds no observation of. Never fresh, never
      // stale, and never reported as healthy (finding F12).
      "unmeasured",
      // A CLOSED lane: no producer for it exists in this tree, so no run is
      // owed and none can be made. Never fresh, never stale, and never
      // reported as progress somebody is behind on.
      "retired",
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

  it("dates the hand-collected pint bundle, and names it a snapshot once it ages", async () => {
    // The bundle is EPISODIC, so past SNAPSHOT_AFTER_DAYS it is named for the
    // day it was collected rather than called fresh, and past its 2160h neglect
    // ceiling it is stale. Inside that first window a genuinely re-collected
    // bundle IS fresh, and saying otherwise would punish a real refresh.
    //
    // The route ages against the real clock, so the expected status is DERIVED
    // from the registry stamp's own age rather than typed. The
    // clock-independent proof of each naming is in
    // __tests__/priceFreshnessHonesty.test.ts, on fixed dates.
    const res = await GET();
    const body = (await res.json()) as {
      datasets: Array<{ id: string; status: string; observedAt: string | null }>;
    };
    const pint = body.datasets.find((d) => d.id === "pint_prices");

    expect(pint?.observedAt).toBe(registryPintStamp());

    const ageDays =
      (Date.now() - Date.parse(registryPintStamp())) / (24 * 60 * 60 * 1000);
    if (ageDays <= SNAPSHOT_AFTER_DAYS) {
      expect(pint?.status).toBe("fresh");
    } else {
      expect(pint?.status).not.toBe("fresh");
      expect(["snapshot", "stale"]).toContain(pint?.status);
    }
  });

  it("reports the closed per-drink lane as a dated snapshot, never stale", async () => {
    // Captain ruling 2026-09-05. The lane's only permitted source (Wetherspoons)
    // publishes no per-drink web prices, so no run can advance the file and the
    // 336h budget it used to carry alarmed for ageing exactly as designed. The
    // route must date it and stop warning: the collection day is the whole
    // claim, and the release gate stays quiet.
    const res = await GET();
    const body = (await res.json()) as {
      datasets: Array<{
        id: string;
        status: string;
        observedAt: string | null;
        stalenessBudgetHours: number | null;
      }>;
    };
    const drink = body.datasets.find((d) => d.id === "drink_price_updates");

    expect(drink?.status).toBe("snapshot");
    expect(drink?.stalenessBudgetHours).toBeNull();
    expect(typeof drink?.observedAt).toBe("string");
    expect(Number.isFinite(Date.parse(drink?.observedAt ?? ""))).toBe(true);
  });

  it("reports a lane nobody writes as retired, which is not the same word", async () => {
    // Two closed lanes and two different facts, so two different words. The
    // per-drink lane above HAS a producer: a weekly retrieval-only workflow
    // that runs and finds nothing, so its rows are dated and final and
    // `snapshot` is the honest name. These two have no writer at all - the
    // baseline publish and its stub parser are deleted, and nothing has ever
    // written the food pack - so a word that describes a lane somebody might
    // still refresh would leave a reader waiting. Neither is a breach.
    const res = await GET();
    const body = (await res.json()) as {
      summary: Record<string, number>;
      datasets: Array<{ id: string; status: string; observedAt: string | null }>;
    };

    for (const id of ["price_updates", "food_price_updates"]) {
      const row = body.datasets.find((d) => d.id === id);
      expect(row?.status, id).toBe("retired");
      // The artifact's own date still rides along: a reader is owed it even
      // when no refresh is.
      expect(Number.isFinite(Date.parse(row?.observedAt ?? "")), id).toBe(true);
    }
    expect(body.summary.retired).toBe(2);
    // A retired lane is never counted as stale. Other lanes may be over their
    // cadence budget on the day the suite runs, so the stale count is checked
    // against the rows themselves rather than pinned to zero.
    const staleIds = body.datasets.filter((d) => d.status === "stale").map((d) => d.id);
    expect(staleIds).not.toContain("price_updates");
    expect(staleIds).not.toContain("food_price_updates");
    expect(body.summary.stale ?? 0).toBe(staleIds.length);
  });

  it("never surfaces a broken bundled artifact as an unresolved stamp", async () => {
    // The shipped, artifact-backed datasets are all valid, so none of THEM should
    // read as "unknown" (that status is reserved for a genuinely missing/broken
    // file). The store-stamped feeds are measured in the durable store instead,
    // and with no Supabase configured in this test run they honestly read
    // "unknown" - unmeasurable without credentials, never a silent fresh -
    // which is the whole point of the store-kind stamp, not a broken artifact.
    // `weather` is store-stamped and still names a committed file, because that
    // file is the degraded fallback the site serves when the store is away; a
    // Vercel filesystem is read-only, so dating the feed by it reported a
    // healthy 6-hourly cron as stale.
    const STORE_STAMPED_FEEDS = new Set([
      "night_signal_candidates",
      "whats_on",
      "weather",
    ]);
    const res = await GET();
    const body = (await res.json()) as { datasets: Array<{ id: string; status: string }> };
    const unexpectedUnknown = body.datasets.filter(
      (d) => d.status === "unknown" && !STORE_STAMPED_FEEDS.has(d.id),
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
