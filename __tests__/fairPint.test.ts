import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compactFairPintPayload, fairPintRequest, transitionFairPintPlan, isFairPint } from "@/lib/fairPint";
import { buildPriceEvidence, priceEvidenceUsableForCeiling } from "@/lib/planRouteEvidence";
import { planPriceEvidenceForVenues } from "@/lib/planRouteEvidence.server";
import { rowsFromSlimPayload } from "@/lib/slimPayload";
import type { SlimVenue } from "@/lib/venuesSlim";

const now = Date.parse("2026-11-17T12:00:00Z");
const source = { label: "Pint Prices", url: "https://example.com/pub", observedAt: "2026-11-01T12:00:00Z" };

describe("fair pint parity", () => {
  it("round trips source URLs, exact timestamps and existing pin metadata", () => {
    for (const url of ["https://www.pint-prices.com/pub/A%20B/C%20D", "https://example.com/pub", "https://www.pint-prices.com/pub/Street/A%20%26%20B"]) {
      const pin = { id: "a", name: "A & B", fairPint: [550, url, "2026-11-01T12:03:04.123Z"] as const, priceSource: "Pint Prices", priceObservedAt: "2026-11-01" };
      expect(rowsFromSlimPayload(compactFairPintPayload([pin, pin]))).toEqual([pin, pin]);
    }
  });
  it("keeps exactly the generator ceiling's fixture venues", () => {
    const fixtures = [
      { id: "under", pence: 400, ...source },
      { id: "equal", pence: 550, ...source },
      { id: "over", pence: 600, ...source },
      { id: "estimated", pence: null, ...source },
      { id: "unattributed", pence: 400, ...source, url: null },
      { id: "undated", pence: 400, ...source, observedAt: null },
      { id: "stale", pence: 400, ...source, observedAt: "2026-01-01" },
    ];
    const generator = fixtures.filter((row) => {
      const evidence = buildPriceEvidence({ ...row, now });
      return priceEvidenceUsableForCeiling(evidence) && evidence.pence! <= 550;
    }).map(({ id }) => id);
    const pins = fixtures.filter((row) => isFairPint({
      fairPint: [row.pence, row.url, row.observedAt],
    }, 550, now)).map(({ id }) => id);
    expect(pins).toEqual(generator);
    expect(pins).toEqual(["under", "equal"]);
  });

  it("matches the generator for every shipped slim cell at three ceilings", async () => {
    const root = path.join(__dirname, "../public/data");
    const manifest = JSON.parse(readFileSync(path.join(root, "venues_slim.manifest.json"), "utf8"));
    const rows: SlimVenue[] = manifest.shards.flatMap((shard: { url: string }) => {
      const payload = JSON.parse(readFileSync(path.join(root, path.basename(shard.url)), "utf8"));
      return rowsFromSlimPayload(payload) as SlimVenue[];
    });
    expect(rows.length).toBeGreaterThan(0);
    const evidence = await planPriceEvidenceForVenues(rows.map((row) => ({ ...row, area: row.borough })), now);
    const mismatches = [400, 550, 700].flatMap((ceiling) => rows.flatMap((row) => {
      const price = evidence.get(row.id)!;
      const expected = priceEvidenceUsableForCeiling(price) && price.pence! <= ceiling;
      return isFairPint(row, ceiling, now) === expected ? [] : [`${row.id}:${ceiling}`];
    }));
    expect(mismatches).toEqual([]);
  });
});

it("builds a three-stop per-pint request without using the route budget", () => {
  expect(fairPintRequest("london", "camden", 530)).toEqual({ cityId: "london", query: "maximum £5.30 per pint", context: { nightArea: "camden", stopCount: 3 } });
});
it("ignores superseded draw results and keeps the last route on failure", () => {
  const first = { phase: "dial" as const, request: 0, last: null, error: "", retryAt: 0 };
  const pending = transitionFairPintPlan(first, { type: "draw", request: 2 });
  const last = { generated: {} as import("@/lib/fairPint").FairPintGenerated, pence: 530, start: "2026-11-17T18:00" };
  expect(transitionFairPintPlan(pending, { type: "drawn", request: 1, last })).toBe(pending);
  const result = transitionFairPintPlan(pending, { type: "drawn", request: 2, last });
  const revalidating = transitionFairPintPlan(result, { type: "draw", request: 3 });
  const failed = transitionFairPintPlan(revalidating, { type: "failed", request: 3, error: "No connection", retryAt: 0 });
  expect(failed.last).toBe(last);
  expect(failed.phase).toBe("result");
});
