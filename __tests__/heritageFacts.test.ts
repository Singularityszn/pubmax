import { describe, expect, it } from "vitest";

import {
  heritageSourceLabel,
  sanitizeHeritageFacts,
} from "@/components/map/VenueInspector";

describe("heritageSourceLabel", () => {
  it("names each public source honestly", () => {
    expect(heritageSourceLabel("wikipedia")).toBe("Wikipedia");
    expect(heritageSourceLabel("wikidata")).toBe("Wikidata");
    expect(heritageSourceLabel("osm")).toBe("OSM");
  });

  it("labels our own seed curation as the generic 'on record'", () => {
    expect(heritageSourceLabel("seed")).toBe("on record");
  });

  it("degrades an unknown source to 'on record' rather than leaking a raw token", () => {
    expect(heritageSourceLabel("mystery")).toBe("on record");
    expect(heritageSourceLabel("")).toBe("on record");
  });
});

describe("sanitizeHeritageFacts", () => {
  it("returns [] for a non-array (fail-soft on a malformed payload)", () => {
    expect(sanitizeHeritageFacts(undefined)).toEqual([]);
    expect(sanitizeHeritageFacts(null)).toEqual([]);
    expect(sanitizeHeritageFacts({})).toEqual([]);
    expect(sanitizeHeritageFacts("nope")).toEqual([]);
  });

  it("keeps well-formed facts with their source + citation", () => {
    const facts = sanitizeHeritageFacts([
      {
        source: "wikipedia",
        fact: "Rebuilt in 1897.",
        sourceRef: "https://en.wikipedia.org/wiki/Example",
      },
      { source: "seed", fact: "A coaching inn on the old road." },
    ]);
    expect(facts).toEqual([
      {
        source: "wikipedia",
        fact: "Rebuilt in 1897.",
        sourceRef: "https://en.wikipedia.org/wiki/Example",
      },
      { source: "seed", fact: "A coaching inn on the old road." },
    ]);
  });

  it("drops entries with no usable fact text / source and trims whitespace", () => {
    const facts = sanitizeHeritageFacts([
      { source: "osm", fact: "   " }, // blank fact
      { source: "wikidata" }, // no fact
      { source: "wikipedia", fact: "  Grade II listed.  " }, // trimmed
      null,
      "bogus",
      { fact: "no source here" }, // missing source
    ]);
    expect(facts).toEqual([{ source: "wikipedia", fact: "Grade II listed." }]);
  });

  it("de-dupes case-insensitively on fact text, first occurrence wins, order preserved", () => {
    const facts = sanitizeHeritageFacts([
      { source: "wikipedia", fact: "Oldest pub in Southwark." },
      { source: "seed", fact: "oldest pub in southwark." },
      { source: "osm", fact: "Riverside terrace." },
    ]);
    expect(facts).toEqual([
      { source: "wikipedia", fact: "Oldest pub in Southwark." },
      { source: "osm", fact: "Riverside terrace." },
    ]);
  });

  it("omits sourceRef when absent or empty (never a fabricated citation)", () => {
    const [fact] = sanitizeHeritageFacts([
      { source: "osm", fact: "Has a beer garden.", sourceRef: "" },
    ]);
    expect(fact).toEqual({ source: "osm", fact: "Has a beer garden." });
    expect("sourceRef" in fact).toBe(false);
  });
});
