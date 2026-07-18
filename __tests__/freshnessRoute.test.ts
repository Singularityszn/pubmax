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
    // The shipped datasets are all valid, so no budgeted dataset should read as
    // "unknown" (that status is reserved for a genuinely missing/broken file).
    const res = await GET();
    const body = (await res.json()) as { datasets: Array<{ id: string; status: string }> };
    expect(body.datasets.some((d) => d.status === "unknown")).toBe(false);
  });
});
