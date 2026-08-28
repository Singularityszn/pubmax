import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  HarvestFoldError,
  applyHarvestWebsiteMenu,
  canonicalOsmId,
  heritageFactFromOverlay,
  loreMayFold,
  loreNameTownGate,
  overlayLookupKeys,
  parseFoldStatsMarkdown,
  parseOverlayJsonl,
  parseOverlayRow,
  parsePublicOverlay,
  reconcileFoldStats,
  summariseOverlay,
} from "@/lib/harvestFold";

const LORE_TEXT =
  "The Red Lion in Clapham has stood on the common since the eighteenth century.";

function row(overrides: Record<string, unknown> = {}) {
  return {
    osmId: "node/123",
    website: "https://redlion.example/",
    menuUrl: "https://redlion.example/menu",
    matchedLore: {
      text: LORE_TEXT,
      citations: ["https://history.example/red-lion-clapham"],
    },
    sources: ["https://redlion.example/", "https://history.example/red-lion-clapham"],
    ...overrides,
  };
}

describe("loreNameTownGate", () => {
  it("passes only when every name token and the town sit in the lore text", () => {
    expect(loreNameTownGate(LORE_TEXT, "The Red Lion", "Clapham")).toBe("pass");
  });

  it("fails when the OSM town tag is missing", () => {
    expect(loreNameTownGate(LORE_TEXT, "The Red Lion", null)).toBe("town-missing");
    expect(loreNameTownGate(LORE_TEXT, "The Red Lion", "")).toBe("town-missing");
  });

  it("fails when the town tag is present but not in the text", () => {
    expect(loreNameTownGate(LORE_TEXT, "The Red Lion", "Camden")).toBe("town-mismatch");
  });

  it("fails when name tokens are not in the text", () => {
    expect(loreNameTownGate(LORE_TEXT, "The Prospect of Whitby", "Clapham")).toBe(
      "name-mismatch",
    );
  });
});

describe("loreMayFold", () => {
  it("requires a name+town match and at least one https citation", () => {
    expect(
      loreMayFold({
        text: LORE_TEXT,
        name: "The Red Lion",
        town: "Clapham",
        citations: ["https://history.example/red-lion-clapham"],
      }),
    ).toBe(true);
  });

  it("refuses uncited lore even when the name and town match", () => {
    expect(
      loreMayFold({
        text: LORE_TEXT,
        name: "The Red Lion",
        town: "Clapham",
        citations: [],
      }),
    ).toBe(false);
  });

  it("refuses http citations", () => {
    expect(
      loreMayFold({
        text: LORE_TEXT,
        name: "The Red Lion",
        town: "Clapham",
        citations: ["http://history.example/red-lion-clapham"],
      }),
    ).toBe(false);
  });

  it("refuses a namesake hit that never names the town", () => {
    expect(
      loreMayFold({
        text: "The Red Lion is a famous coaching inn.",
        name: "The Red Lion",
        town: "Clapham",
        citations: ["https://history.example/red-lion"],
      }),
    ).toBe(false);
  });
});

describe("parseOverlayRow", () => {
  it("keeps https website, menu, and cited lore against the OSM id", () => {
    const parsed = parseOverlayRow(row());
    expect(parsed.osmId).toBe("node/123");
    expect(parsed.osmRef).toBe("n123");
    expect(parsed.website).toBe("https://redlion.example/");
    expect(parsed.menuUrl).toBe("https://redlion.example/menu");
    expect(parsed.matchedLore?.citations).toEqual([
      "https://history.example/red-lion-clapham",
    ]);
  });

  it("fails loud on a malformed row", () => {
    expect(() => parseOverlayRow("nope")).toThrow(HarvestFoldError);
    expect(() => parseOverlayRow({ website: "https://x.example/" })).toThrow(
      HarvestFoldError,
    );
  });

  it("fails loud on an http website or menu URL", () => {
    expect(() => parseOverlayRow(row({ website: "http://redlion.example/" }))).toThrow(
      HarvestFoldError,
    );
    expect(() => parseOverlayRow(row({ menuUrl: "http://redlion.example/menu" }))).toThrow(
      HarvestFoldError,
    );
  });

  it("stores a concatenated https observation but serving drops it from CTAs", () => {
    const parsed = parseOverlayRow(
      row({
        website: "https://theimperialpub.com, https://imperialarmschislehurst.co.uk",
        menuUrl: null,
        matchedLore: null,
      }),
    );
    expect(parsed.website?.startsWith("https://")).toBe(true);
    expect(parsePublicOverlay(parsed)?.website).toBeNull();
  });

  it("fails loud on lore without an https citation", () => {
    expect(() =>
      parseOverlayRow(
        row({
          matchedLore: { text: LORE_TEXT, citations: [] },
        }),
      ),
    ).toThrow(HarvestFoldError);
    expect(() =>
      parseOverlayRow(
        row({
          matchedLore: {
            text: LORE_TEXT,
            citations: ["http://history.example/red-lion-clapham"],
          },
        }),
      ),
    ).toThrow(HarvestFoldError);
  });

  it("fails loud when a social observation is present", () => {
    expect(() => parseOverlayRow(row({ social: "https://instagram.com/redlion" }))).toThrow(
      HarvestFoldError,
    );
    expect(() =>
      parseOverlayRow(row({ socials: [{ handle: "@redlion" }] })),
    ).toThrow(HarvestFoldError);
  });

  it("accepts a website-only row with social absent or null", () => {
    const parsed = parseOverlayRow(
      row({ matchedLore: null, menuUrl: null, social: null }),
    );
    expect(parsed.website).toBe("https://redlion.example/");
    expect(parsed.matchedLore).toBeNull();
  });
});

describe("canonicalOsmId / overlayLookupKeys", () => {
  it("maps OSM type/id, short ref, and salted venue ids onto one identity", () => {
    expect(canonicalOsmId("node/123")).toBe("node/123");
    expect(canonicalOsmId("n123")).toBe("node/123");
    expect(canonicalOsmId("venue-uk-n123")).toBe("node/123");
    expect(canonicalOsmId("venue-osm-w99")).toBe("way/99");
    expect(canonicalOsmId("venue-7l4pei")).toBeNull();
  });

  it("never uses the pub name as a lookup key", () => {
    const keys = overlayLookupKeys("node/123");
    expect(keys).toEqual(
      expect.arrayContaining(["node/123", "n123", "venue-uk-n123", "venue-osm-n123"]),
    );
    expect(keys.some((key) => /red lion/i.test(key))).toBe(false);
  });
});

describe("fold-stats reconciliation", () => {
  const markdown = `# Fold-ready harvest stats

| Field | Rows | Share of 38484 pubs |
|---|---:|---:|
| Overlay row (any usable field) | 2 | 42.7% |
| https website | 2 | 39.2% |
| https menu URL | 1 | 8.2% |
| Matched lore | 1 | 14.2% |
| Social | 0 | 0.0% |
`;

  it("parses the fold-stats table", () => {
    expect(parseFoldStatsMarkdown(markdown)).toEqual({
      overlayRows: 2,
      httpsWebsite: 2,
      httpsMenuUrl: 1,
      matchedLore: 1,
      social: 0,
    });
  });

  it("parses the committed fold-stats.md contract", () => {
    const committed = readFileSync(
      join(process.cwd(), "data/uk-pub-harvest/fold-stats.md"),
      "utf8",
    );
    expect(parseFoldStatsMarkdown(committed)).toEqual({
      overlayRows: 16416,
      httpsWebsite: 15088,
      httpsMenuUrl: 3137,
      matchedLore: 5472,
      social: 0,
    });
  });

  it("fails loud when folded counts disagree with fold-stats.md", () => {
    const rows = parseOverlayJsonl(
      `${JSON.stringify(row())}\n${JSON.stringify(
        row({
          osmId: "node/456",
          menuUrl: null,
          matchedLore: null,
          sources: ["https://redlion.example/"],
        }),
      )}\n`,
    );
    expect(summariseOverlay(rows)).toEqual({
      overlayRows: 2,
      httpsWebsite: 2,
      httpsMenuUrl: 1,
      matchedLore: 1,
      social: 0,
    });
    expect(() =>
      reconcileFoldStats(summariseOverlay(rows), parseFoldStatsMarkdown(markdown)),
    ).not.toThrow();
    expect(() =>
      reconcileFoldStats(
        { overlayRows: 1, httpsWebsite: 2, httpsMenuUrl: 1, matchedLore: 1, social: 0 },
        parseFoldStatsMarkdown(markdown),
      ),
    ).toThrow(HarvestFoldError);
  });
});

describe("heritageFactFromOverlay / public overlay", () => {
  it("emits source web with the first https citation", () => {
    const fact = heritageFactFromOverlay(parseOverlayRow(row()));
    expect(fact).toEqual({
      source: "web",
      fact: LORE_TEXT,
      sourceRef: "https://history.example/red-lion-clapham",
    });
  });

  it("drops lore from a public overlay when the citation is missing", () => {
    expect(parsePublicOverlay({ website: "https://ok.example/", lore: { fact: LORE_TEXT, source: "web" } })?.lore).toBeNull();
    expect(parsePublicOverlay({ lore: { fact: LORE_TEXT, source: "web", sourceRef: "http://insecure.example/" } })?.lore).toBeNull();
  });

  it("fills empty https website and menu, never overwrites an existing https URL, never copies lore", () => {
    const overlay = parseOverlayRow(row());
    const filled = applyHarvestWebsiteMenu({ website: "", id: "venue-uk-n123" }, overlay);
    expect(filled.website).toBe("https://redlion.example/");
    expect(filled.menuUrl).toBe("https://redlion.example/menu");
    expect("matchedLore" in filled).toBe(false);

    const kept = applyHarvestWebsiteMenu(
      { website: "https://curated.example/", menuUrl: "https://curated.example/menu" },
      overlay,
    );
    expect(kept.website).toBe("https://curated.example/");
    expect(kept.menuUrl).toBe("https://curated.example/menu");

    const skipped = applyHarvestWebsiteMenu(
      { website: "" },
      parseOverlayRow(
        row({
          website: "https://theimperialpub.com, https://other.example/",
          menuUrl: null,
          matchedLore: null,
        }),
      ),
    );
    expect(skipped.website).toBe("");
  });
});

describe("harvest overlay payload boundary", () => {
  it("never rides in the slim index builder or UK base pin encoder", () => {
    const files = [
      "scripts/build_slim_index.mjs",
      "lib/ukBasePubs.ts",
      "components/map/canvas/geojson.ts",
    ];
    for (const file of files) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      expect(source).not.toMatch(/harvestFold|harvestOverlay|harvest-overlay/);
    }
  });
});
