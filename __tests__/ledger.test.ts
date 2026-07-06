import { describe, it, expect } from "vitest";

import { buildLedgerEntries, formatLedgerDate, toLedgerEntry, type LedgerSourceDrop } from "@/lib/ledger";

function makeDrop(overrides: Partial<LedgerSourceDrop> = {}): LedgerSourceDrop {
  return {
    id: "drop-1",
    handle: "@regular",
    drink: "Lager",
    priceGbp: 5.5,
    passedDownNote: "",
    era: "",
    provenance: "anecdote",
    createdAt: "2024-06-03T12:00:00.000Z",
    ...overrides,
  };
}

describe("formatLedgerDate", () => {
  it("formats a valid ISO date as en-GB long date", () => {
    expect(formatLedgerDate("2024-06-03T12:00:00.000Z")).toBe("3 June 2024");
  });

  it("returns null for an unparseable date", () => {
    expect(formatLedgerDate("not-a-date")).toBeNull();
  });
});

describe("toLedgerEntry", () => {
  it("prefers the passed-down note as the entry body", () => {
    const entry = toLedgerEntry(
      makeDrop({ passedDownNote: "Quiet Tuesday, landlord told us about the flood of '53." }),
    );
    expect(entry.note).toBe("Quiet Tuesday, landlord told us about the flood of '53.");
    expect(entry.priceLabel).toBe("£5.50");
  });

  it("falls back to a logged-price line when there is no note", () => {
    const entry = toLedgerEntry(makeDrop({ passedDownNote: "", drink: "Stout", priceGbp: 4.2 }));
    expect(entry.note).toBe("Logged Stout at £4.20.");
  });

  it("produces an empty note when there is neither a note nor a price", () => {
    const entry = toLedgerEntry(makeDrop({ passedDownNote: "", priceGbp: null }));
    expect(entry.note).toBe("");
    expect(entry.priceLabel).toBeNull();
  });

  it("formats the display handle and date label", () => {
    const entry = toLedgerEntry(makeDrop({ handle: "anonymous" }));
    expect(entry.dateLabel).toBe("3 June 2024");
    expect(typeof entry.handle).toBe("string");
  });
});

describe("buildLedgerEntries", () => {
  it("sorts entries newest first", () => {
    const drops = [
      makeDrop({ id: "old", passedDownNote: "Old note", createdAt: "2023-01-01T00:00:00.000Z" }),
      makeDrop({ id: "new", passedDownNote: "New note", createdAt: "2024-06-03T12:00:00.000Z" }),
    ];
    const entries = buildLedgerEntries(drops);
    expect(entries.map((e) => e.id)).toEqual(["new", "old"]);
  });

  it("drops entries with no note and no price (nothing to log)", () => {
    const drops = [
      makeDrop({ id: "empty", passedDownNote: "", priceGbp: null }),
      makeDrop({ id: "priced", passedDownNote: "", priceGbp: 3.8 }),
      makeDrop({ id: "noted", passedDownNote: "Great pint" }),
    ];
    const entries = buildLedgerEntries(drops);
    expect(entries.map((e) => e.id).sort()).toEqual(["noted", "priced"]);
  });

  it("returns an empty array for no drops", () => {
    expect(buildLedgerEntries([])).toEqual([]);
  });
});
