import { describe, expect, it } from "vitest";

import historicPubs from "@/public/data/historic_pubs.json";
import {
  judgePubOfTheDay,
  pickPubOfTheDay,
  pubOfTheDayMarkers,
  pubOfTheDayRefusals,
  type PubOfTheDayCandidate,
} from "@/lib/pubOfTheDay";

// Astra F08 (6 Sep 2026), reproduced from the shipped record: the daily card
// printed the Sun Inn over a Wikidata classification, with no venue action.
const NOW = new Date("2026-07-18T08:00:00.000Z");
const DAY_MS = 86_400_000;

function candidate(over: Partial<PubOfTheDayCandidate> = {}): PubOfTheDayCandidate {
  return {
    venueId: "venue-abc123",
    name: "The Anchor",
    slug: "the-anchor",
    borough: "Southwark",
    facts: [
      {
        source: "wikipedia",
        fact: "The Anchor is a Grade II listed pub on Bankside, rebuilt in 1770.",
        sourceRef: "https://en.wikipedia.org/wiki/The_Anchor",
      },
    ],
    ...over,
  };
}

describe("pubOfTheDayMarkers", () => {
  it("reads a stated date, a statutory listing and a named association", () => {
    expect(pubOfTheDayMarkers("built in 1886")).toEqual(["stated-date"]);
    expect(pubOfTheDayMarkers("an 18th-century tavern")).toEqual(["stated-date"]);
    expect(pubOfTheDayMarkers("a Grade II* listed pub")).toEqual(["statutory-listing"]);
    expect(pubOfTheDayMarkers("one of the oldest pubs in Camden")).toEqual([
      "named-association",
    ]);
  });

  it("finds nothing in a category and a place", () => {
    expect(pubOfTheDayMarkers("pub in Barnes, London, UK")).toEqual([]);
    expect(pubOfTheDayMarkers("public house in Chelsea, London SW3")).toEqual([]);
    expect(pubOfTheDayMarkers("")).toEqual([]);
  });
});

describe("judgePubOfTheDay refuses", () => {
  // The F08 card itself. It breaks two rules at once, and identity is asked
  // first: the sentence is a Wikidata description, so it never names the pub it
  // was printed over, and it says nothing checkable about the building either.
  it("the F08 card itself: a Wikidata description with no subject", () => {
    const sunInn = candidate({
      name: "Sun Inn",
      slug: "sun-inn",
      borough: "Richmond upon Thames",
      facts: [
        {
          source: "wikidata",
          fact: "pub in Barnes, London, UK",
          sourceRef: "https://en.wikipedia.org/wiki/Sun_Inn",
        },
      ],
    });
    const verdict = judgePubOfTheDay(sunInn);
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.refusal.id).toBe("unnamed-subject");
    expect(pubOfTheDayMarkers("pub in Barnes, London, UK")).toEqual([]);
  });

  it("a sentence that names its pub and still says nothing checkable", () => {
    const verdict = judgePubOfTheDay(
      candidate({
        facts: [
          {
            source: "wikidata",
            fact: "The Anchor is a public house in Southwark, London.",
            sourceRef: "https://x.example/t",
          },
        ],
      }),
    );
    expect(verdict.ok === false && verdict.refusal.id).toBe("taxonomy-only");
  });

  it("a record that matched no venue, because the action would point nowhere", () => {
    const verdict = judgePubOfTheDay(candidate({ venueId: null }));
    expect(verdict.ok === false && verdict.refusal.id).toBe("unresolved-venue");
  });

  it("a venue the index records as gone", () => {
    const verdict = judgePubOfTheDay(candidate({ venueStatus: "demolished" }));
    expect(verdict.ok === false && verdict.refusal.id).toBe("venue-gone");
  });

  it("a venue its own words call former", () => {
    const verdict = judgePubOfTheDay(
      candidate({
        facts: [
          {
            source: "wikipedia",
            fact: "The Anchor is a former pub in Southwark, converted in 1998.",
            sourceRef: "https://x.example/a",
          },
        ],
      }),
    );
    expect(verdict.ok === false && verdict.refusal.id).toBe("venue-gone");
  });

  it("a pub whose only material is seeded example content", () => {
    const verdict = judgePubOfTheDay(
      candidate({
        facts: [
          { source: "seed", fact: "Seeded example only.", sourceRef: "https://x.example/s" },
        ],
      }),
    );
    expect(verdict.ok === false && verdict.refusal.id).toBe("no-sourced-fact");
  });

  it("internal vocabulary written for us rather than for a reader", () => {
    const verdict = judgePubOfTheDay(
      candidate({
        facts: [
          {
            source: "wikipedia",
            fact: "A useful Victorian reference stop for the seeded heritage route.",
            sourceRef: "https://x.example/i",
          },
        ],
      }),
    );
    expect(verdict.ok === false && verdict.refusal.id).toBe("internal-language");
  });

  it("an ambiguous venue match: a fact placing the pub in another borough", () => {
    const verdict = judgePubOfTheDay(
      candidate({
        borough: "Southwark",
        facts: [
          {
            source: "wikidata",
            fact: "A Grade II listed pub in Camden, built in 1875.",
            sourceRef: "https://en.wikipedia.org/wiki/The_Anchor",
          },
        ],
      }),
    );
    expect(verdict.ok === false && verdict.refusal.id).toBe("place-conflict");
  });

  // The wrong-venue class, found in the first pass of this fix: "Upper Flask"
  // joined to a live venue of that name while its one sentence describes an
  // 18th-century tavern that has not stood since 1921.
  it("a sentence that never names the pub it is printed over", () => {
    const verdict = judgePubOfTheDay(
      candidate({
        name: "Upper Flask",
        slug: "upper-flask",
        borough: "Camden",
        facts: [
          {
            source: "wikidata",
            fact: "18th-century tavern in Hampstead",
            sourceRef: "https://en.wikipedia.org/wiki/Upper_Flask",
          },
        ],
      }),
    );
    expect(verdict.ok === false && verdict.refusal.id).toBe("unnamed-subject");
  });

  it("a sentence pointing at context we do not publish beside it", () => {
    const verdict = judgePubOfTheDay(
      candidate({
        facts: [
          {
            source: "wikidata",
            fact: "The Anchor is a Southwark pub designed by the above in 1888.",
            sourceRef: "https://x.example/p",
          },
        ],
      }),
    );
    expect(verdict.ok === false && verdict.refusal.id).toBe("dangling-reference");
  });
});

describe("judgePubOfTheDay admits", () => {
  it("a specific sourced reason, with an internal venue action and its citation", () => {
    const verdict = judgePubOfTheDay(candidate());
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.card.pubName).toBe("The Anchor");
    expect(verdict.card.reason).toContain("rebuilt in 1770");
    expect(verdict.card.provenanceLabel).toBe("Sourced");
    expect(verdict.card.sourceLabel).toBe("Wikipedia");
    // The one internal action: this pub, on the map.
    expect(verdict.card.mapHref).toContain("sel=venue-abc123");
    expect(verdict.card.markers).toContain("statutory-listing");
  });

  it("finds the pub's name through an article, an ampersand and an apostrophe", () => {
    const verdict = judgePubOfTheDay(
      candidate({
        name: "The Dog & Duck",
        slug: "the-dog-and-duck",
        borough: "Westminster",
        facts: [
          {
            source: "wikipedia",
            fact: "The Dog and Duck at 18 Bateman Street, Soho, is a Grade II listed pub.",
            sourceRef: "https://x.example/d",
          },
        ],
      }),
    );
    expect(verdict.ok).toBe(true);
  });

  it("an open pub whose heritage names a past ROLE, never a closure", () => {
    const verdict = judgePubOfTheDay(
      candidate({
        facts: [
          {
            source: "wikipedia",
            fact: "The Anchor is a former coaching inn, now a Grade II listed pub.",
            sourceRef: "https://x.example/b",
          },
        ],
      }),
    );
    expect(verdict.ok).toBe(true);
  });
});

describe("pickPubOfTheDay", () => {
  const anchor = candidate();
  const swan = candidate({
    venueId: "venue-swan",
    name: "The Swan",
    slug: "the-swan",
    facts: [
      {
        source: "wikipedia",
        fact: "The Swan is a riverside pub rebuilt in 1901.",
        sourceRef: "https://x.example/s",
      },
    ],
  });
  const generic = candidate({
    venueId: "venue-sun",
    name: "Sun Inn",
    slug: "sun-inn",
    borough: "Richmond upon Thames",
    facts: [
      { source: "wikidata", fact: "pub in Barnes, London, UK" },
    ],
  });

  it("is deterministic for a London day and rotates across the eligible set", () => {
    const first = pickPubOfTheDay([anchor, swan, generic], NOW);
    const sameDay = pickPubOfTheDay(
      [anchor, swan, generic],
      new Date("2026-07-18T20:00:00.000Z"),
    );
    expect(sameDay?.pubName).toBe(first?.pubName);
    const seen = new Set<string>();
    for (let day = 0; day < 4; day += 1) {
      const pick = pickPubOfTheDay(
        [anchor, swan, generic],
        new Date(NOW.getTime() + day * DAY_MS),
      );
      expect(pick).not.toBeNull();
      // The refused card never surfaces on any day.
      expect(pick?.pubName).not.toBe("Sun Inn");
      if (pick?.pubName) seen.add(pick.pubName);
    }
    expect(seen).toEqual(new Set(["The Anchor", "The Swan"]));
  });

  it("answers null rather than lowering the bar when nothing qualifies", () => {
    expect(pickPubOfTheDay([generic], NOW)).toBeNull();
    expect(pickPubOfTheDay([], NOW)).toBeNull();
  });
});

describe("the shipped historic index", () => {
  const rows = historicPubs as unknown as PubOfTheDayCandidate[];

  it("still earns a card, and the card the audit found is refused", () => {
    const card = pickPubOfTheDay(rows, NOW);
    expect(card).not.toBeNull();
    expect(card?.venueId).toBeTruthy();
    expect(card?.mapHref).toContain("sel=");
    expect(pubOfTheDayMarkers(card?.reason ?? "").length).toBeGreaterThan(0);

    // Every card the gate admits names its own pub, which is what stops a
    // description written beside a name being read as a claim about a venue.
    expect(
      card ? card.reason.toLowerCase() : "",
    ).toContain(card ? card.pubName.replace(/^The /, "").toLowerCase().slice(0, 5) : "");

    const sunInn = rows.find((row) => row.name === "Sun Inn");
    if (sunInn) {
      expect(judgePubOfTheDay(sunInn).ok).toBe(false);
    }
  });

  it("keeps a fortnight of distinct picks, so the card is not one stuck pub", () => {
    const seen = new Set<string>();
    for (let day = 0; day < 14; day += 1) {
      const card = pickPubOfTheDay(rows, new Date(NOW.getTime() + day * DAY_MS));
      expect(card).not.toBeNull();
      if (card) seen.add(card.venueId);
    }
    expect(seen.size).toBe(14);
  });

  it("names a reason for every refusal, so a person can fix the record", () => {
    const refusals = pubOfTheDayRefusals(rows);
    expect(refusals.length).toBeGreaterThan(0);
    for (const entry of refusals) {
      expect(entry.refusal.why.length).toBeGreaterThan(10);
    }
  });
});
