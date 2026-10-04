import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const fixture = vi.hoisted(() => ({
  rows: [] as import("@/lib/ukPriceBundle").UkPriceBundleRow[],
  community: vi.fn(),
}));
vi.mock("@/lib/communityPriceStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/communityPriceStore")>();
  return { ...actual, readCommunityPriceCategoryIndex: fixture.community };
});
vi.mock("@/lib/ukPriceBundle.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ukPriceBundle.server")>();
  return {
    ...actual,
    ukPriceBundleRowsFor: async (venueId: string) => ({
      status: "ready" as const,
      rows: fixture.rows.filter((row) => row.venueId === venueId),
    }),
  };
});

import { bundleDrinkFieldsFromPrintedName } from "@/lib/bundleDrinkFields";
import { inferNightContext } from "@/lib/nightPlanning";
import { cleanSelectedDrinkPriceEvidence } from "@/lib/planSelectedDrinkPriceEvidence";
import { resolvePlanSelectedDrinkPriceEvidence } from "@/lib/planSelectedDrinkPriceEvidence.server";
import type { UkPriceBundleRow } from "@/lib/ukPriceBundle";

const NOW = Date.parse("2026-10-01T12:00:00.000Z");
const SOURCE_URL = "https://pub.example/menu";
const WHITE_LABEL = "Chardonnay, Pays D’oc, France";
const OBSERVED = "2026-09-29T10:40:17.846Z";
const LEGACY = {
  category: "wine",
  pence: 550,
  serving: "125ml",
  source: "listed",
  sourceUrl: SOURCE_URL,
  observedAt: OBSERVED,
} as const;
const WHITE = {
  ...LEGACY,
  drinkLabel: WHITE_LABEL,
  drinkSubtype: "wine-white",
} as const;

function row(overrides: Partial<UkPriceBundleRow> = {}): UkPriceBundleRow {
  return {
    venueId: "venue-a",
    name: "The One",
    category: "wine",
    priceGbp: 5.5,
    drinkLabel: WHITE_LABEL,
    drinkSubtype: "wine-white",
    servingSize: "125ml",
    lane: "site-harvest",
    standing: "listed",
    sourceUrl: SOURCE_URL,
    observedAt: OBSERVED,
    publisher: "The One",
    basis: null,
    sampleSize: null,
    ...overrides,
  };
}

function resolve(hint: unknown = WHITE, contextChanges: Record<string, unknown> = {}) {
  const context = inferNightContext("wine").context;
  return resolvePlanSelectedDrinkPriceEvidence(
    [{ venueId: "venue-a", venueName: "Canonical pub" }],
    [{ selectedDrinkPriceEvidence: hint }],
    { ...context, nightArea: "piccadilly-soho", drinkCategory: "wine", ...contextChanges },
  );
}

describe("Plan named listed quote identity", () => {
  let restoreClock: () => void;

  beforeEach(() => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(NOW);
    restoreClock = () => clock.mockRestore();
    fixture.rows = [row()];
    fixture.community.mockReset();
    fixture.community.mockResolvedValue({ prices: [], degraded: false, truncated: false });
  });

  afterEach(() => restoreClock());

  it("keeps legacy evidence and accepts canonical named evidence including explicit unknown subtype", () => {
    expect(cleanSelectedDrinkPriceEvidence(LEGACY)).toEqual(LEGACY);
    expect(cleanSelectedDrinkPriceEvidence({ ...WHITE, contributor: "private-canary" })).toEqual(WHITE);

    expect(bundleDrinkFieldsFromPrintedName("Cellar selection", "wine")).toEqual({
      drinkLabel: "Cellar selection",
    });
    const unknownSubtype = {
      ...LEGACY,
      drinkLabel: "Cellar selection",
      drinkSubtype: null,
    };
    expect(cleanSelectedDrinkPriceEvidence(unknownSubtype)).toEqual(unknownSubtype);
  });

  it("rejects malformed named identity instead of downgrading it to legacy evidence", () => {
    const withoutLabel = { ...WHITE } as Record<string, unknown>;
    delete withoutLabel.drinkLabel;
    const withoutSubtype = { ...WHITE } as Record<string, unknown>;
    delete withoutSubtype.drinkSubtype;

    const invalid = [
      withoutLabel,
      withoutSubtype,
      { ...WHITE, drinkSubtype: undefined },
      { ...WHITE, drinkSubtype: "beer-cider" },
      { ...WHITE, drinkSubtype: "wine-red" },
      { ...WHITE, drinkSubtype: null },
      { ...WHITE, drinkLabel: ` ${WHITE_LABEL}` },
      { ...WHITE, drinkLabel: `${WHITE_LABEL}\u0000` },
      { ...WHITE, drinkLabel: `${WHITE_LABEL}${"x".repeat(81)}` },
      { ...WHITE, drinkLabel: "Cellar selection", drinkSubtype: "wine-white" },
    ];

    for (const value of invalid) {
      expect(cleanSelectedDrinkPriceEvidence(value)).toBeNull();
    }
  });

  it("resolves named White before the cheaper same-serving Red minimum", async () => {
    fixture.rows = [
      row({ drinkLabel: "Rioja, Spain", drinkSubtype: "wine-red", priceGbp: 5.25 }),
      row(),
    ];

    expect((await resolve())[0]?.selectedDrinkPriceEvidence).toEqual(WHITE);
  });

  it("filters other named rows before the four-quote cap", async () => {
    const unservedWhite = { ...WHITE, serving: null };
    fixture.rows = [
      row({ drinkLabel: "Rioja, Spain", drinkSubtype: "wine-red", priceGbp: 4.75,
        servingSize: undefined, observedAt: "2026-09-30T11:59:00.000Z" }),
      row({ drinkLabel: "Merlot, France", drinkSubtype: "wine-red", priceGbp: 5,
        servingSize: undefined, observedAt: "2026-09-30T11:58:00.000Z" }),
      row({ drinkLabel: "Malbec, Argentina", drinkSubtype: "wine-red", priceGbp: 5.25,
        servingSize: undefined, observedAt: "2026-09-30T11:57:00.000Z" }),
      row({ drinkLabel: "Pinot Noir, France", drinkSubtype: "wine-red", priceGbp: 5.4,
        servingSize: undefined, observedAt: "2026-09-30T11:56:00.000Z" }),
      row({ servingSize: undefined, observedAt: OBSERVED }),
    ];

    expect((await resolve(unservedWhite))[0]?.selectedDrinkPriceEvidence).toEqual(unservedWhite);
  });

  it("requires the exact source-named row when legacy fields are identical", async () => {
    const sameLegacyFieldsRed = row({
      drinkLabel: "Merlot, Pays D’oc, France",
      drinkSubtype: "wine-red",
    });
    fixture.rows = [sameLegacyFieldsRed];
    expect((await resolve())[0]?.selectedDrinkPriceEvidence).toBeUndefined();

    fixture.rows = [sameLegacyFieldsRed, row()];
    expect((await resolve())[0]?.selectedDrinkPriceEvidence).toEqual(WHITE);
    expect((await resolve(WHITE, { drinkCategory: "gin" }))[0]?.selectedDrinkPriceEvidence).toBeUndefined();
    expect(fixture.community).not.toHaveBeenCalled();
  });

  it("accepts only the latest authoritative same-name serving observation", async () => {
    const newerAt = "2026-09-30T11:00:00.000Z";
    fixture.rows = [row(), row({ priceGbp: 6, observedAt: newerAt })];

    expect((await resolve())[0]?.selectedDrinkPriceEvidence).toBeUndefined();
    const latest = { ...WHITE, pence: 600, observedAt: newerAt };
    expect((await resolve(latest))[0]?.selectedDrinkPriceEvidence).toEqual(latest);
  });
});

describe("Plan named quote case-folded supersession", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    fixture.community.mockReset();
    fixture.community.mockResolvedValue({ prices: [], degraded: false, truncated: false });
  });

  afterEach(() => vi.restoreAllMocks());

  it("chooses current source spelling before exact named lookup can revive an older quote", async () => {
    const currentLabel = WHITE_LABEL.toLowerCase();
    const currentAt = "2026-09-30T11:00:00.000Z";
    fixture.rows = [row(), row({ drinkLabel: currentLabel, priceGbp: 6, observedAt: currentAt })];

    expect((await resolve(WHITE))[0]?.selectedDrinkPriceEvidence).toBeUndefined();
    const current = { ...WHITE, drinkLabel: currentLabel, pence: 600, observedAt: currentAt };
    expect((await resolve(current))[0]?.selectedDrinkPriceEvidence).toEqual(current);
  });
});
