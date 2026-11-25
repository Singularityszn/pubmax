import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fairPintSearchSuppresses } from "@/lib/fairPint";
import { compactFairPintPayload } from "@/lib/slimListingPrices.mjs";
import { fairPintRequest, transitionFairPintPlan } from "@/lib/fairPintTransitions";
import { isFairPint } from "@/lib/fairPintPricing";
import { buildPriceEvidence, priceEvidenceUsableForCeiling } from "@/lib/planRouteEvidence";
import { planPriceEvidenceForVenues } from "@/lib/planRouteEvidence.server";
import { rowsFromSlimPayload } from "@/lib/slimPayload";
import { slimVenuesToPins } from "@/lib/slimPins";
import type { SlimVenue } from "@/lib/venuesSlim";

afterEach(() => vi.useRealTimers());
const now = Date.parse("2026-11-17T12:00:00Z");
const source = { label: "Pint Prices", url: "https://example.com/pub", observedAt: "2026-11-01T12:00:00Z" };

describe("fair pint parity", () => {
  it("round trips source URLs, exact timestamps and existing pin metadata", () => {
    for (const url of ["https://www.pint-prices.com/pub/A%20B/C%20D", "https://www.pint-prices.com/pub/A B/C D", "https://example.com/pub", "https://www.pint-prices.com/pub/Street/A%20%26%20B"]) {
      const pin = { id: "a", name: "A & B", borough: "Camden", fairPint: [550, url, "2026-11-01T12:03:04.123Z"] as const, priceSource: "Pint Prices", priceObservedAt: "2026-11-01" };
      expect(rowsFromSlimPayload(compactFairPintPayload([pin, pin]))).toEqual([pin, pin]);
    }
  });
  it("round trips boroughs on unpriced rows and still accepts unpacked cells", () => {
    const rows = [{ id: "unpriced", borough: "", cheapestPrice: null }, { id: "missing" }];
    expect(rowsFromSlimPayload(compactFairPintPayload(rows))).toEqual(rows);
    expect(rowsFromSlimPayload({ rows })).toEqual(rows);
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

  it.each([now, now + 61 * 86400000])("matches every shipped cell at three ceilings at %s", async (observedNow) => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(observedNow);
    const root = path.join(__dirname, "../public/data");
    const manifest = JSON.parse(readFileSync(path.join(root, "venues_slim.manifest.json"), "utf8"));
    const rows: SlimVenue[] = manifest.shards.flatMap((shard: { url: string }) => {
      const payload = JSON.parse(readFileSync(path.join(root, path.basename(shard.url)), "utf8"));
      return rowsFromSlimPayload(payload) as SlimVenue[];
    });
    expect(manifest.shards.some((shard: { core: boolean }) => shard.core)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
    const evidence = await planPriceEvidenceForVenues(rows.map((row) => ({ ...row, area: row.borough })), observedNow);
    expect(evidence.get("venue-1fabngq")).toEqual({ pence: null, source: null, confidenceState: "unknown" });
    const pins = slimVenuesToPins(rows);
    expect(pins.length).toBeGreaterThan(0);
    expect(pins.some((pin) => pin.id === "venue-1fabngq")).toBe(false);
    const mismatches = [400, 550, 700].flatMap((ceiling) => pins.flatMap((row) => {
      const price = evidence.get(row.id)!;
      const expected = priceEvidenceUsableForCeiling(price) && price.pence! <= ceiling;
      return isFairPint(row, ceiling, observedNow) === expected ? [] : [`${row.id}:${ceiling}`];
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
  const last = { generated: {} as import("@/lib/fairPint").FairPintGenerated, pence: 530, start: "2026-11-17T18:00", startIso: "2026-11-17T18:00:00.000Z" };
  expect(transitionFairPintPlan(pending, { type: "drawn", request: 1, last })).toBe(pending);
  const result = transitionFairPintPlan(pending, { type: "drawn", request: 2, last });
  const revalidating = transitionFairPintPlan(result, { type: "draw", request: 3 });
  const failed = transitionFairPintPlan(revalidating, { type: "failed", request: 3, error: "No connection", retryAt: 0 });
  expect(failed.last).toBe(last);
  expect(failed.phase).toBe("result");
});

it.each(["sel=a", "log=1", "q=Camden", "%71=Camden", "plan=night", "occasion=birthday", "place=pub", "uk=pub", "mode=build"])("preserves the explicit arrival for %s", (search) => {
  expect(fairPintSearchSuppresses("?" + search)).toBe(true);
});
it.each(["", "?max=5.3", "?utm_source=group-chat", "?max=5.3&utm_campaign=night"])("keeps the fair-pint arrival for %s", (search) => {
  expect(fairPintSearchSuppresses(search)).toBe(false);
});
