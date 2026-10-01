import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const fixture = vi.hoisted(() => ({
  rows: [] as import("@/lib/ukPriceBundle").UkPriceBundleRow[],
  status: "ready" as "ready" | "empty" | "unavailable",
  community: vi.fn(),
}));
vi.mock("@/lib/communityPriceStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/communityPriceStore")>();
  return { ...actual, readCommunityPriceCategoryIndex: fixture.community };
});
vi.mock("@/lib/ukPriceBundle.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ukPriceBundle.server")>();
  return { ...actual, ukPriceBundleRowsFor: async (venueId: string) => ({
    status: fixture.status, rows: fixture.rows.filter((row) => row.venueId === venueId),
  }) };
});

import { resolvePlanSelectedDrinkPriceEvidence } from "@/lib/planSelectedDrinkPriceEvidence.server";
import { inferNightContext } from "@/lib/nightPlanning";
import type { UkPriceBundleRow } from "@/lib/ukPriceBundle";

const NOW = Date.parse("2026-09-30T12:00:00.000Z");
const OBSERVED = "2026-09-29T12:00:00.000Z";
const LISTED = { category: "wine", pence: 525, serving: "125ml", source: "listed",
  sourceUrl: "https://pub.example/menu", observedAt: OBSERVED };
function row(overrides: Partial<UkPriceBundleRow> = {}): UkPriceBundleRow {
  return { venueId: "venue-a", name: "Venue A", category: "wine", priceGbp: 5.25,
    drinkLabel: "Rioja", servingSize: "125ml", lane: "site-harvest", standing: "listed",
    sourceUrl: LISTED.sourceUrl, observedAt: OBSERVED, publisher: "Fixture publisher", basis: null,
    sampleSize: null, ...overrides };
}
function resolve(hint: unknown = LISTED, contextChanges = {}, venueId = "venue-a") {
  return resolvePlanSelectedDrinkPriceEvidence(
    [{ venueId, venueName: "Canonical pub" }], [{ selectedDrinkPriceEvidence: hint }],
    { ...inferNightContext("wine").context, nightArea: "piccadilly-soho", drinkCategory: "wine", ...contextChanges },
  );
}

describe("Plan listed evidence is rebuilt from the exact server venue bundle", () => {
  let restoreClock: () => void;
  beforeEach(() => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(NOW);
    restoreClock = () => { clock.mockRestore(); };
    fixture.rows = [row()];
    fixture.status = "ready";
    fixture.community.mockReset();
    fixture.community.mockResolvedValue({ prices: [], degraded: false, truncated: false });
  });
  afterEach(() => { restoreClock(); });

  it.each([
    { category: "wine", priceGbp: 5.25, servingSize: "125ml", drinkLabel: "Rioja" },
    { category: "gin", priceGbp: 4.5, servingSize: "25ml", drinkLabel: "Sacred Gin" },
    { category: "cocktail", priceGbp: 11, servingSize: undefined, drinkLabel: "Negroni" },
  ] as const)("retains trusted $category with the recorded serving and no client-only fields", async (quote) => {
    fixture.rows = [row(quote)];
    const evidence = { ...LISTED, category: quote.category, pence: Math.round(quote.priceGbp * 100),
      serving: quote.servingSize ?? null };
    const result = await resolve({ ...evidence, contributor: "private-canary" }, { drinkCategory: quote.category });
    expect(result[0]?.selectedDrinkPriceEvidence).toEqual(evidence);
    expect(JSON.stringify(result)).not.toContain("private-canary");
  });

  it("keeps two source-stated servings at the same pub distinct when re-reading a selected quote", async () => {
    fixture.rows = [row(), row({ priceGbp: 10.5, servingSize: "250ml" })];
    expect((await resolve())[0]?.selectedDrinkPriceEvidence).toEqual(LISTED);
    const large = { ...LISTED, pence: 1050, serving: "250ml" };
    expect((await resolve(large))[0]?.selectedDrinkPriceEvidence).toEqual(large);
    expect((await resolve({ ...large, pence: 525 }))[0]?.selectedDrinkPriceEvidence).toBeUndefined();
  });

  it.each([
    { pence: 100 }, { sourceUrl: "https://attacker.example/menu" },
    { observedAt: "2026-09-28T12:00:00.000Z" }, { serving: "250ml" }, { category: "gin" },
  ])("rejects a forged listed hint $pence $sourceUrl $observedAt $serving $category", async (change) => {
    expect((await resolve({ ...LISTED, ...change }))[0]?.selectedDrinkPriceEvidence).toBeUndefined();
  });

  it.each([
    { priceGbp: 6 }, { servingSize: "250ml" }, { category: "gin" },
    { lane: "estimate" as const, standing: "estimate" as const, basis: "model" },
  ] as const)("rejects a hint when the server row changed or lost listed authority", async (change) => {
    fixture.rows = [row(change)];
    expect((await resolve())[0]?.selectedDrinkPriceEvidence).toBeUndefined();
  });

  it("refuses an expired listed row even when every submitted field matches that row", async () => {
    const observedAt = "2025-09-28T12:00:00.000Z";
    fixture.rows = [row({ observedAt })];
    expect((await resolve({ ...LISTED, observedAt }))[0]?.selectedDrinkPriceEvidence).toBeUndefined();
  });

  it("rejects a superseded same-drink same-serving observation even while its raw row remains", async () => {
    fixture.rows = [row(), row({ priceGbp: 6, observedAt: "2026-09-30T11:00:00.000Z" })];
    expect((await resolve())[0]?.selectedDrinkPriceEvidence).toBeUndefined();
    const updated = { ...LISTED, pence: 600, observedAt: "2026-09-30T11:00:00.000Z" };
    expect((await resolve(updated))[0]?.selectedDrinkPriceEvidence).toEqual(updated);
  });

  it("does not transfer another pub's quote or turn a failed bundle read into a verified hint", async () => {
    expect((await resolve(LISTED, {}, "venue-b"))[0]?.selectedDrinkPriceEvidence).toBeUndefined();
    fixture.status = "unavailable";
    expect((await resolve())[0]?.selectedDrinkPriceEvidence).toBeUndefined();
  });

  it("never gives an exact quarantined wrong-category claim Plan authority", async () => {
    fixture.rows = [row({ priceGbp: 4, drinkLabel: "London Pride", servingSize: "500ml",
      sourceUrl: "https://thebellonthegreen.com/drinks/" })];
    const hint = { ...LISTED, pence: 400, serving: "500ml", sourceUrl: "https://thebellonthegreen.com/drinks/" };
    expect((await resolve(hint))[0]?.selectedDrinkPriceEvidence).toBeUndefined();
  });

  it.each(["degraded", "partial", "throw"] as const)("keeps independently readable listed evidence when community is %s", async (state) => {
    if (state === "throw") fixture.community.mockRejectedValue(new Error("community unavailable"));
    else fixture.community.mockResolvedValue({ prices: [], degraded: state === "degraded", truncated: state === "partial" });
    expect((await resolve())[0]?.selectedDrinkPriceEvidence).toEqual(LISTED);
  });

  it("retains community verification and refuses uncorroborated community evidence beside listed rows", async () => {
    const submittedAt = NOW - 1_000;
    const evidence = { category: "wine", pence: 750, serving: null, source: "community",
      reportedAt: new Date(submittedAt).toISOString() };
    const price = { venueId: "venue-a", drinkCategory: "wine", priceGbp: 7.5, submittedAt,
      source: "community", corroborations: 2 };
    fixture.community.mockResolvedValue({ prices: [price], degraded: false, truncated: false });
    expect((await resolve(evidence))[0]?.selectedDrinkPriceEvidence).toEqual(evidence);
    fixture.community.mockResolvedValue({ prices: [{ ...price, corroborations: 1 }], degraded: false, truncated: false });
    expect((await resolve(evidence))[0]?.selectedDrinkPriceEvidence).toBeUndefined();
  });

  it.each([{ zeroProof: true }, { drinkCategory: "beer" }, { drinkCategory: "gin" }])(
    "preserves zero-proof, beer, and selected-category guards", async (contextChanges) => {
      expect((await resolve(LISTED, contextChanges))[0]?.selectedDrinkPriceEvidence).toBeUndefined();
    },
  );
});
