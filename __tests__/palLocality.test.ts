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

  it("never says it could not place London itself", () => {
    const locality = resolvePalLocality("cheap pints in London tonight", null);
    expect(locality.scope).toBe("london-wide");
    expect(locality.unplaced).toBeUndefined();
    expect(palLocalityLine(locality)).not.toMatch(/could not place/i);
    for (const query of ["cheap pints in Central London", "quiet pubs in East London"]) {
      const wide = resolvePalLocality(query, null);
      expect(wide.unplaced, query).toBeUndefined();
      expect(palLocalityLine(wide), query).not.toMatch(/could not place/i);
    }
  });

  it("never reads a brewery or owner after \"by\" as a place", () => {
    for (const query of ["cheap pubs run by Young's", "pubs owned by Sam Smith's"]) {
      const wide = resolvePalLocality(query, null);
      expect(wide.unplaced, query).toBeUndefined();
      expect(palLocalityLine(wide), query).not.toMatch(/could not place/i);
    }
  });

  it("does not apply to an area the taxonomy does place", () => {
    expect(resolvePalLocality("pubs in Brixton", null).unplaced).toBeUndefined();
    expect(resolvePalLocality("pubs in Brixton", REMEMBERED_SOHO).unplaced).toBeUndefined();
  });
});

describe("a named place the taxonomy cannot place, with a remembered area", () => {
  it("beats the remembered area instead of inheriting it", () => {
    const locality = resolvePalLocality("pubs in Blackfriars", REMEMBERED_SOHO);
    expect(locality.scope).toBe("london-wide");
    expect(locality.area).toBeNull();
    expect(locality.grounded).toBe(false);
    expect(locality.unplaced).toBe("Blackfriars");
    expect(palLocalityLine(locality)).toContain("Blackfriars");
  });

  it("keeps the remembered area when the phrase names a time, not a place", () => {
    for (const query of [
      "Christmas pub crawl in December",
      "pubs around Christmas",
      "a quiet pint in New Year",
      "cheap pints near Friday night",
      "somewhere open in the Weekend",
      "pubs open around Boxing Day",
      "a pint near Bonfire Night",
      "pubs open around New Years Eve",
      "pubs open around NYE",
    ]) {
      const locality = resolvePalLocality(query, REMEMBERED_SOHO);
      expect(locality.scope, query).toBe("remembered");
      expect(locality.area, query).toEqual({ kind: "night-patch", id: "soho" });
      expect(locality.unplaced, query).toBeUndefined();
      expect(palLocalityLine(locality), query).toBe("Grounded around Soho, your remembered area.");
    }
  });

  it("keeps the place named before a time word and drops the time", () => {
    for (const query of [
      "pubs near Blackfriars Friday night",
      "a pint in Blackfriars Saturday",
      "drinks around Blackfriars December",
      "pubs near Blackfriars New Year",
      "pubs in Blackfriars Boxing Day",
      "a pint near Blackfriars Bonfire Night",
      "drinks around Blackfriars New Year's",
      "pubs near Blackfriars New Years Eve",
      "drinks in December near Blackfriars",
    ]) {
      const locality = resolvePalLocality(query, REMEMBERED_SOHO);
      expect(locality.scope, query).toBe("london-wide");
      expect(locality.area, query).toBeNull();
      expect(locality.unplaced, query).toBe("Blackfriars");
    }
  });

  it("takes a place whose first word also opens a holiday", () => {
    expect(resolvePalLocality("pubs near New Malden", REMEMBERED_SOHO).unplaced).toBe(
      "New Malden",
    );
  });

  it("reads 'in London' as London-wide, never the remembered area", () => {
    const locality = resolvePalLocality("cheap pints in London tonight", REMEMBERED_SOHO);
    expect(locality.scope).toBe("london-wide");
    expect(locality.area).toBeNull();
    expect(locality.unplaced).toBeUndefined();
    expect(palLocalityLine(locality)).toBe(
      "Across London. No area set, so these are not ranked by distance.",
    );
  });

  it("grounds a London-named place the taxonomy knows", () => {
    const locality = resolvePalLocality("pubs near London Bridge", REMEMBERED_SOHO);
    expect(locality.scope).toBe("query");
    expect(locality.area).toEqual({ kind: "night-patch", id: "london-bridge" });
  });

  it("reports a London-named place the taxonomy cannot place", () => {
    for (const place of ["London Fields", "London Wall"]) {
      const locality = resolvePalLocality(`pubs near ${place}`, REMEMBERED_SOHO);
      expect(locality.scope, place).toBe("london-wide");
      expect(locality.area, place).toBeNull();
      expect(locality.unplaced, place).toBe(place);
    }
  });

  it("still uses the remembered area when the query names no place", () => {
    const locality = resolvePalLocality("somewhere cheap and quiet", REMEMBERED_SOHO);
    expect(locality.scope).toBe("remembered");
    expect(locality.area).toEqual({ kind: "night-patch", id: "soho" });
  });
});
