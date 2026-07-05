import { describe, it, expect } from "vitest";

import {
  deriveProfileFromDrops,
  normalizeHandle,
  profileStats,
  type ProfileDrop,
} from "@/lib/profiles";
import {
  removeSaved,
  upsertSaved,
  isSaved,
  groupByList,
  type SavedPub,
} from "@/lib/savedPubs";

function drop(overrides: Partial<ProfileDrop> = {}): ProfileDrop {
  return { handle: "someone", priceGbp: 5, venueId: "v1", ...overrides };
}

function saved(overrides: Partial<SavedPub> = {}): SavedPub {
  return {
    venueId: "v1",
    listType: "Want to Visit",
    savedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("normalizeHandle", () => {
  it("lowercases and strips a leading @", () => {
    expect(normalizeHandle("@Foo_Bar")).toBe("foo_bar");
  });

  it("strips junk to the [a-z0-9_] alphabet", () => {
    expect(normalizeHandle("  @Cheap-Pint Ken! 🍺 ")).toBe("cheappintken");
    expect(normalizeHandle("a.b/c")).toBe("abc");
  });

  it("keeps underscores and digits", () => {
    expect(normalizeHandle("borough_9_regular")).toBe("borough_9_regular");
  });

  it("strips multiple leading @ signs", () => {
    expect(normalizeHandle("@@@name")).toBe("name");
  });

  it("caps the length at 30 characters", () => {
    const long = "a".repeat(50);
    expect(normalizeHandle(long)).toHaveLength(30);
  });

  it("is total: null/undefined/non-strings yield an empty string", () => {
    expect(normalizeHandle(null)).toBe("");
    expect(normalizeHandle(undefined)).toBe("");
    // @ts-expect-error — guarding a non-string caller
    expect(normalizeHandle(42)).toBe("");
  });
});

describe("profileStats", () => {
  it("counts pints logged", () => {
    const stats = profileStats([drop(), drop(), drop()]);
    expect(stats.pintsLogged).toBe(3);
  });

  it("computes the cheapest priced pint", () => {
    const stats = profileStats([
      drop({ priceGbp: 6.5 }),
      drop({ priceGbp: 4.2 }),
      drop({ priceGbp: 5.75 }),
    ]);
    expect(stats.cheapestPintGbp).toBe(4.2);
  });

  it("ignores null / non-finite / non-positive prices when finding the cheapest", () => {
    const stats = profileStats([
      drop({ priceGbp: null }),
      drop({ priceGbp: undefined }),
      drop({ priceGbp: 0 }),
      drop({ priceGbp: 7 }),
    ]);
    // Four drops logged, but only £7 is a real price.
    expect(stats.pintsLogged).toBe(4);
    expect(stats.cheapestPintGbp).toBe(7);
  });

  it("returns null cheapest when no drop has a price", () => {
    const stats = profileStats([drop({ priceGbp: null }), drop({ priceGbp: null })]);
    expect(stats.cheapestPintGbp).toBeNull();
  });

  it("handles an empty / missing drop list without throwing", () => {
    expect(profileStats([])).toEqual({ pintsLogged: 0, cheapestPintGbp: null });
    expect(profileStats(null)).toEqual({ pintsLogged: 0, cheapestPintGbp: null });
    expect(profileStats(undefined)).toEqual({ pintsLogged: 0, cheapestPintGbp: null });
  });

  it("omits boroughs entirely when no drop names one", () => {
    expect(profileStats([drop()])).not.toHaveProperty("boroughs");
  });

  it("collects unique sorted boroughs when present", () => {
    const stats = profileStats([
      drop({ borough: "Southwark" }),
      drop({ borough: "Camden" }),
      drop({ borough: "Southwark" }),
      drop({ borough: null }),
    ]);
    expect(stats.boroughs).toEqual(["Camden", "Southwark"]);
  });
});

describe("deriveProfileFromDrops", () => {
  it("synthesizes a display name from the handle", () => {
    const p = deriveProfileFromDrops("@Cheap_Pint_Ken", []);
    expect(p.handle).toBe("cheap_pint_ken");
    expect(p.displayName).toBe("Cheap Pint Ken");
  });

  it("summarizes stats into a bio when there are drops", () => {
    const p = deriveProfileFromDrops("ken", [drop({ priceGbp: 4.2 }), drop({ priceGbp: 6 })]);
    expect(p.bio).toContain("2 pints logged");
    expect(p.bio).toContain("£4.20");
  });

  it("has no bio for a handle with no drops", () => {
    const p = deriveProfileFromDrops("ghost", []);
    expect(p.bio).toBeUndefined();
  });

  it("falls back to a placeholder name for an empty handle", () => {
    const p = deriveProfileFromDrops("@@@", []);
    expect(p.handle).toBe("");
    expect(p.displayName).toBe("Anonymous Drinker");
  });
});

describe("upsertSaved / removeSaved — (venueId,listType) uniqueness", () => {
  it("adds a new entry", () => {
    const list = upsertSaved([], saved());
    expect(list).toHaveLength(1);
    expect(isSaved(list, "v1", "Want to Visit")).toBe(true);
  });

  it("never duplicates the same (venueId,listType) — re-save replaces in place", () => {
    const first = upsertSaved([], saved({ note: "old" }));
    const second = upsertSaved(first, saved({ note: "new", savedAt: "2026-02-02T00:00:00.000Z" }));
    expect(second).toHaveLength(1);
    expect(second[0].note).toBe("new");
    expect(second[0].savedAt).toBe("2026-02-02T00:00:00.000Z");
  });

  it("allows the same venue in different lists", () => {
    let list = upsertSaved([], saved({ listType: "Want to Visit" }));
    list = upsertSaved(list, saved({ listType: "Cheap Pint" }));
    expect(list).toHaveLength(2);
    expect(isSaved(list, "v1", "Want to Visit")).toBe(true);
    expect(isSaved(list, "v1", "Cheap Pint")).toBe(true);
  });

  it("removeSaved deletes only the matching (venueId,listType)", () => {
    let list = upsertSaved([], saved({ listType: "Want to Visit" }));
    list = upsertSaved(list, saved({ listType: "Cheap Pint" }));
    list = removeSaved(list, "v1", "Want to Visit");
    expect(list).toHaveLength(1);
    expect(isSaved(list, "v1", "Want to Visit")).toBe(false);
    expect(isSaved(list, "v1", "Cheap Pint")).toBe(true);
  });

  it("removeSaved on a missing key is an idempotent no-op", () => {
    const list = upsertSaved([], saved());
    const after = removeSaved(list, "does-not-exist", "Want to Visit");
    expect(after).toHaveLength(1);
    // idempotent: removing again is stable
    expect(removeSaved(after, "does-not-exist", "Want to Visit")).toHaveLength(1);
  });

  it("does not mutate the input list (pure)", () => {
    const original = [saved()];
    const snapshot = JSON.stringify(original);
    upsertSaved(original, saved({ listType: "Cheap Pint" }));
    removeSaved(original, "v1", "Want to Visit");
    expect(JSON.stringify(original)).toBe(snapshot);
  });
});

describe("groupByList", () => {
  it("groups by list type and sorts newest-first within a group", () => {
    const groups = groupByList([
      saved({ venueId: "a", listType: "Cheap Pint", savedAt: "2026-01-01T00:00:00.000Z" }),
      saved({ venueId: "b", listType: "Cheap Pint", savedAt: "2026-03-01T00:00:00.000Z" }),
      saved({ venueId: "c", listType: "Historic", savedAt: "2026-02-01T00:00:00.000Z" }),
    ]);
    expect(Object.keys(groups).sort()).toEqual(["Cheap Pint", "Historic"]);
    expect(groups["Cheap Pint"]!.map((p) => p.venueId)).toEqual(["b", "a"]);
    expect(groups["Historic"]).toHaveLength(1);
  });

  it("omits empty lists", () => {
    expect(groupByList([])).toEqual({});
  });
});
