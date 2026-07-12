import { describe, expect, it } from "vitest";

import type { TonightOpportunity } from "@/lib/tonight";
import {
  coverageLabel,
  deriveKindFacets,
  filterByKind,
  kindSlug,
  provenanceLabel,
  walkLabel,
  walkMinutes,
} from "@/lib/tonight";

function op(partial: Partial<TonightOpportunity>): TonightOpportunity {
  return { title: "Untitled", ...partial };
}

describe("kindSlug", () => {
  it("falls back to 'other' for missing/blank kinds", () => {
    expect(kindSlug(op({ kind: "gig" }))).toBe("gig");
    expect(kindSlug(op({ kind: "  theatre " }))).toBe("theatre");
    expect(kindSlug(op({ kind: "" }))).toBe("other");
    expect(kindSlug(op({}))).toBe("other");
  });
});

describe("deriveKindFacets", () => {
  it("derives facets from the kinds present, most common first", () => {
    const facets = deriveKindFacets([
      op({ kind: "gig" }),
      op({ kind: "gig" }),
      op({ kind: "theatre" }),
      op({}), // → other
    ]);
    expect(facets).toEqual([
      { kind: "gig", label: "Gig", count: 2 },
      { kind: "other", label: "Other", count: 1 },
      { kind: "theatre", label: "Theatre", count: 1 },
    ]);
  });

  it("breaks count ties alphabetically by label", () => {
    const facets = deriveKindFacets([
      op({ kind: "theatre" }),
      op({ kind: "comedy" }),
    ]);
    expect(facets.map((f) => f.kind)).toEqual(["comedy", "theatre"]);
  });

  it("returns [] for an empty list", () => {
    expect(deriveKindFacets([])).toEqual([]);
  });
});

describe("filterByKind", () => {
  const ops = [op({ kind: "gig" }), op({ kind: "theatre" }), op({})];

  it("returns everything when no kind is active", () => {
    expect(filterByKind(ops, null)).toHaveLength(3);
  });

  it("filters to the active kind, treating missing kind as 'other'", () => {
    expect(filterByKind(ops, "gig")).toHaveLength(1);
    expect(filterByKind(ops, "other")).toHaveLength(1);
    expect(filterByKind(ops, "market")).toHaveLength(0);
  });
});

describe("provenanceLabel", () => {
  it("formats a valid ISO timestamp from UTC parts (timezone-stable)", () => {
    expect(provenanceLabel("2026-07-12T18:30:00Z")).toBe("Checked 12 Jul");
    expect(provenanceLabel("2026-01-01T00:00:00Z")).toBe("Checked 1 Jan");
  });

  it("labels missing/unparseable freshness honestly", () => {
    expect(provenanceLabel(null)).toBe("Freshness unknown");
    expect(provenanceLabel(undefined)).toBe("Freshness unknown");
    expect(provenanceLabel("not-a-date")).toBe("Freshness unknown");
  });
});

describe("coverageLabel", () => {
  it("owns the zero, thin, and healthy cases honestly", () => {
    expect(coverageLabel(0)).toBe("Nothing confirmed tonight yet");
    expect(coverageLabel(1)).toBe("Thin tonight — 1 confirmed");
    expect(coverageLabel(2)).toBe("Thin tonight — 2 confirmed");
    expect(coverageLabel(7)).toBe("7 things on tonight");
  });
});

describe("walkMinutes / walkLabel", () => {
  const origin = { lat: 51.5074, lng: -0.1278 }; // Charing Cross-ish

  it("estimates a positive, clamped walk from finite coords", () => {
    const near = { lat: 51.509, lng: -0.128 };
    const mins = walkMinutes(origin, near);
    expect(mins).not.toBeNull();
    expect(mins).toBeGreaterThanOrEqual(1);
    expect(walkLabel(mins)).toBe(`~${mins} min walk`);
  });

  it("returns null (and no label) when either coord is missing/non-finite", () => {
    expect(walkMinutes(null, origin)).toBeNull();
    expect(walkMinutes(origin, undefined)).toBeNull();
    expect(walkMinutes(origin, { lat: Number.NaN, lng: -0.1 })).toBeNull();
    expect(walkLabel(null)).toBeNull();
  });

  it("clamps a co-located venue to at least 1 minute", () => {
    expect(walkMinutes(origin, origin)).toBe(1);
  });
});
