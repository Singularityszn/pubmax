import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  heritagePlaceConflict,
  partitionFactsByPlace,
  referenceDisambiguator,
  statedBoroughs,
} from "../lib/heritagePlaceConflict.mjs";
import { LONDON_BOROUGHS } from "@/lib/boroughs";
import { LONDON_BOROUGH_NAMES } from "../lib/londonBoroughNames.mjs";
import { defined } from "@/__tests__/helpers/defined";

// F06. Heritage facts are keyed by pub NAME, and London has several of nearly
// every name. One key therefore collects facts about several pubs, and the join
// hangs them all on whichever venue the dataset offered first. The Cheshire
// Cheese card was labelled Westminster over a description of a pub at 48
// Crutched Friars in the City of London, a different pub again from Ye Olde
// Cheshire Cheese on Fleet Street.
//
// The rule is quarantine, never merge.

const ROOT = path.join(__dirname, "..");

type Row = {
  name: string;
  slug: string;
  borough: string | null;
  venueId: string | null;
  lat: number | null;
  lng: number | null;
  facts: { fact: string; sourceRef?: string }[];
};

function historicRows(): Row[] {
  return JSON.parse(
    readFileSync(path.join(ROOT, "public/data/historic_pubs.json"), "utf8"),
  ) as Row[];
}

function bySlug(slug: string): Row {
  const found = historicRows().find((r) => r.slug === slug);
  if (!found) throw new Error(`no historic record at slug ${slug}`);
  return found;
}

describe("the borough list has one owner", () => {
  it("the app and the build scripts read the same 33 names", () => {
    expect(LONDON_BOROUGHS).toEqual(LONDON_BOROUGH_NAMES);
    expect(LONDON_BOROUGH_NAMES).toHaveLength(33);
  });
});

describe("what a fact states about where it is", () => {
  it("reads a borough the fact names", () => {
    expect(statedBoroughs("pub in Wandsworth, London")).toEqual(["Wandsworth"]);
    expect(statedBoroughs("pub in the London Borough of Hackney")).toEqual(["Hackney"]);
  });

  it("stays silent about a neighbourhood it cannot resolve to a borough", () => {
    expect(statedBoroughs("pub in Limehouse, London")).toEqual([]);
    expect(statedBoroughs("pub on Duke of York Street, St James's, London")).toEqual([]);
  });

  it("reads the place a wiki reference disambiguates itself by", () => {
    expect(
      referenceDisambiguator("https://en.wikipedia.org/wiki/The_Grapes,_Wandsworth"),
    ).toBe("Wandsworth");
    expect(referenceDisambiguator("https://en.wikipedia.org/wiki/The_Cheshire_Cheese")).toBeNull();
    expect(referenceDisambiguator(null)).toBeNull();
  });
});

describe("a fact about another borough is refused", () => {
  it("refuses the Crutched Friars description under a Westminster venue", () => {
    const conflict = heritagePlaceConflict({
      text: "The Cheshire Cheese at 48 Crutched Friars sits beneath the viaduct of Fenchurch Street station in the City of London.",
      venueBorough: "Westminster",
    });
    expect(conflict?.reason).toBe("borough-stated-in-fact");
    expect(conflict?.why).toContain("City of London");
    expect(conflict?.why).toContain("Westminster");
  });

  it("refuses on the source reference when the sentence names no borough", () => {
    const conflict = heritagePlaceConflict({
      text: "pub in Whitehall, London",
      sourceRef: "https://en.wikipedia.org/wiki/Red_Lion,_Westminster",
      venueBorough: "Hillingdon",
    });
    expect(conflict?.reason).toBe("borough-named-in-source-reference");
  });

  it("publishes a fact that agrees with its venue", () => {
    expect(
      heritagePlaceConflict({
        text: "pub in Hayes, London Borough of Hillingdon",
        venueBorough: "Hillingdon",
      }),
    ).toBeNull();
  });

  it("publishes a fact that names no borough at all", () => {
    expect(
      heritagePlaceConflict({
        text: "The Grapes is a Grade II listed public house at 76 Narrow Street, Limehouse.",
        venueBorough: "Tower Hamlets",
      }),
    ).toBeNull();
  });

  it("cannot refuse anything when the venue has no borough to disagree with", () => {
    expect(
      heritagePlaceConflict({ text: "pub in Harrow, London", venueBorough: null }),
    ).toBeNull();
  });
});

describe("similarly named pubs in different areas", () => {
  const FACTS = [
    { fact: "pub in Limehouse, London", sourceRef: "https://en.wikipedia.org/wiki/The_Grapes,_Limehouse" },
    { fact: "pub in Wandsworth, London", sourceRef: "https://en.wikipedia.org/wiki/The_Grapes,_Wandsworth" },
  ];

  it("keeps the fact about this pub and quarantines the one about the other", () => {
    const { published, quarantined } = partitionFactsByPlace(FACTS, "Tower Hamlets");
    expect(published.map((f) => f.fact)).toEqual(["pub in Limehouse, London"]);
    expect(quarantined).toHaveLength(1);
    expect(defined(quarantined[0]).conflict.stated).toBe("Wandsworth");
  });

  it("withholds everything when no fact survives, rather than showing the wrong pub", () => {
    const { published, quarantined } = partitionFactsByPlace(
      [{ fact: "pub in Harrow, London" }],
      "Islington",
    );
    expect(published).toEqual([]);
    expect(quarantined).toHaveLength(1);
  });
});

describe("the shipped index keeps the three Cheshire Cheeses apart", () => {
  const crutchedFriars = bySlug("cheshire-cheese");
  const strand = bySlug("the-cheshire-cheese");
  const fleetStreet = bySlug("ye-olde-cheshire-cheese");

  it("gives each one its own identity", () => {
    const ids = [crutchedFriars.venueId, strand.venueId, fleetStreet.venueId];
    expect(new Set(ids).size).toBe(3);
    expect(new Set([crutchedFriars.lat, strand.lat, fleetStreet.lat]).size).toBe(3);
  });

  it("labels the Crutched Friars pub with the borough its own description names", () => {
    expect(crutchedFriars.borough).toBe("City of London");
    expect(defined(crutchedFriars.facts[0]).fact).toContain("48 Crutched Friars");
  });

  it("leaves the Strand pub with only the fact that is about it", () => {
    expect(strand.borough).toBe("Westminster");
    expect(strand.facts.map((f) => f.fact)).toEqual(["pub in Essex Street, Strand, London"]);
    expect(JSON.stringify(strand)).not.toContain("Crutched Friars");
  });

  it("leaves the Fleet Street pub untouched and distinct", () => {
    expect(fleetStreet.borough).toBe("City of London");
    expect(fleetStreet.name).toBe("Ye Olde Cheshire Cheese");
  });
});

describe("no shipped record contradicts its own borough", () => {
  it("every published fact agrees with the venue it was joined to", () => {
    const offences: string[] = [];
    for (const row of historicRows()) {
      for (const fact of row.facts) {
        const conflict = heritagePlaceConflict({
          text: fact.fact,
          sourceRef: fact.sourceRef,
          venueBorough: row.borough,
        });
        if (conflict) offences.push(`${row.name}: ${conflict.why}`);
      }
    }
    expect(offences).toEqual([]);
  });
});
