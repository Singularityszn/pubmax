import { describe, expect, it } from "vitest";

import {
  PAL_DISTANCE_UNKNOWN,
  palLocalityLine,
  palWalkLabel,
  resolvePalLocality,
} from "@/lib/palLocality";
import type { RememberedArea } from "@/lib/nightPatches";

const REMEMBERED_SOHO: RememberedArea = { kind: "patch", id: "soho" };

describe("resolvePalLocality", () => {
  it("lets an area named in the query beat the remembered area", () => {
    const locality = resolvePalLocality("cheap pints in Brixton tonight", REMEMBERED_SOHO);
    expect(locality).toEqual({
      scope: "query",
      area: { kind: "night-patch", id: "brixton" },
      label: "Brixton",
      grounded: true,
    });
  });

  it("falls back to the remembered area when the query names none", () => {
    const locality = resolvePalLocality("somewhere cheap and quiet", REMEMBERED_SOHO);
    expect(locality).toEqual({
      scope: "remembered",
      area: { kind: "night-patch", id: "soho" },
      label: "Soho",
      grounded: true,
    });
  });

  it("becomes an honest London-wide scope with no context at all", () => {
    const locality = resolvePalLocality("cheap and lively", null);
    expect(locality).toEqual({ scope: "london-wide", area: null, label: "London", grounded: false });
  });

  it("recognises a borough the taxonomy knows, patches taking precedence", () => {
    expect(resolvePalLocality("pubs in Lambeth", null).area).toEqual({ kind: "borough", name: "Lambeth" });
    // Brixton (patch) is checked before Lambeth (borough) when both appear.
    expect(resolvePalLocality("Brixton in Lambeth", null).area).toEqual({ kind: "night-patch", id: "brixton" });
  });

  it("ignores a remembered area the taxonomy no longer knows", () => {
    const locality = resolvePalLocality("quiet pint", { kind: "patch", id: "not-a-real-patch" });
    expect(locality.scope).toBe("london-wide");
  });
});

describe("palLocalityLine", () => {
  it("names the area for a grounded answer and never calls London-wide local", () => {
    expect(palLocalityLine(resolvePalLocality("in Brixton", null))).toContain("Brixton");
    const wide = palLocalityLine(resolvePalLocality("cheap", null));
    expect(wide).toContain("Across London");
    expect(wide).toMatch(/not ranked by distance/i);
    expect(wide).not.toMatch(/near you|nearby|local/i);
  });
});

describe("palWalkLabel — honest distance", () => {
  it("labels a real walk time and never fabricates a missing one", () => {
    expect(palWalkLabel(7)).toBe("about 7 min on foot");
    expect(palWalkLabel(0)).toBe("about 0 min on foot");
    expect(palWalkLabel(null)).toBeNull();
    expect(palWalkLabel(undefined)).toBeNull();
    expect(palWalkLabel(Number.NaN)).toBeNull();
    expect(PAL_DISTANCE_UNKNOWN).toMatch(/not sourced/i);
  });
});

describe("a place the taxonomy cannot place", () => {
  it("is named in the London-wide line instead of claiming no area was given", () => {
    const locality = resolvePalLocality("Two cheap pubs in Blackfriars for a quiet pint", null);
    expect(locality.scope).toBe("london-wide");
    expect(locality.unplaced).toBe("Blackfriars");
    const line = palLocalityLine(locality);
    expect(line).toContain("Blackfriars");
    expect(line).toMatch(/could not place/i);
    expect(line).toMatch(/not ranked by distance/i);
    expect(line).not.toMatch(/no area set/i);
  });

  it("keeps a multi-word name whole and stops at the next plain word", () => {
    expect(resolvePalLocality("pints near Elephant and Castle tonight", null).unplaced).toBe(
      "Elephant and Castle",
    );
  });

  it("never mistakes a lower-case phrase for a place", () => {
    expect(resolvePalLocality("something in the cheapest bracket", null).unplaced).toBeUndefined();
    expect(palLocalityLine(resolvePalLocality("cheap and lively", null))).toContain("No area set");
  });

  it("does not apply to an area the taxonomy does place", () => {
    expect(resolvePalLocality("pubs in Brixton", null).unplaced).toBeUndefined();
    expect(resolvePalLocality("pubs in Blackfriars", REMEMBERED_SOHO).unplaced).toBeUndefined();
  });
});
