import { describe, expect, it } from "vitest";
import {
  buildPalTaste,
  palTasteAsk,
  palTastePreamble,
  type PalTasteDiaryInput,
  type PalTasteDropInput,
  type PalTastePlace,
} from "@/lib/palTaste";

const PLACES: Record<string, PalTastePlace> = {
  crown: { name: "The Crown", patch: "Soho" },
  lamb: { name: "The Lamb", patch: "Bloomsbury" },
  dog: { name: "The Dog", patch: "Soho" },
  anchor: { name: "The Anchor", patch: "Borough" },
  ship: { name: "The Ship", patch: "Wapping" },
};
const placeOf = (venueId: string) => PLACES[venueId] ?? null;

function diary(venueId: string, visitedOn: string, rating: number | null = null): PalTasteDiaryInput {
  return { venueId, venueName: PLACES[venueId]?.name ?? "", visitedOn, rating };
}

function drop(venueId: string, day: string, extra: Partial<PalTasteDropInput> = {}): PalTasteDropInput {
  return { venueId, day, drink: "Guinness", pintPriceGbp: null, vibeTags: [], ...extra };
}

describe("buildPalTaste", () => {
  it("is null when the person has logged nothing", () => {
    expect(buildPalTaste({ diary: [], drops: [], saved: [], placeOf })).toBeNull();
  });

  it("counts one visit per pub per London day across the diary and drops", () => {
    const taste = buildPalTaste({
      diary: [diary("crown", "2026-10-02")],
      drops: [drop("crown", "2026-10-02"), drop("crown", "2026-10-02", { drink: "Camden Hells" })],
      saved: [],
      placeOf,
    });
    expect(taste?.visits).toBe(1);
    expect(taste?.distinctPubs).toBe(1);
    expect(taste?.regulars).toEqual([]);
    expect(taste?.lastVisit).toEqual({ name: "The Crown", on: "2026-10-02" });
  });

  it("reads patches, regulars, ratings, drinks and vibes from the person's own logs", () => {
    const taste = buildPalTaste({
      diary: [
        diary("crown", "2026-09-04", 3),
        diary("crown", "2026-09-11", 5),
        diary("dog", "2026-09-18", 4),
        diary("lamb", "2026-09-25", 1.5),
      ],
      drops: [
        drop("crown", "2026-10-02", { pintPriceGbp: 5.5, vibeTags: ["quiet pint", "old local"] }),
        drop("dog", "2026-10-09", { pintPriceGbp: 6.1, vibeTags: ["quiet pint"] }),
        drop("dog", "2026-10-09", { drink: "Camden Hells", pintPriceGbp: 5.9 }),
      ],
      saved: [
        { venueId: "anchor", venueName: "The Anchor" },
        { venueId: "crown", venueName: "The Crown" },
      ],
      placeOf,
    });
    expect(taste).toMatchObject({
      visits: 6,
      distinctPubs: 3,
      patches: ["Soho", "Bloomsbury"],
      regulars: ["The Crown", "The Dog"],
      loved: ["The Crown", "The Dog"],
      notKeen: ["The Lamb"],
      drinks: ["Guinness", "Camden Hells"],
      usualPintGbp: 5.9,
      vibes: ["quiet pint", "old local"],
      wishlist: ["The Anchor"],
    });
  });

  it("uses only pint prices and needs two of them for a usual pint", () => {
    const one = buildPalTaste({ diary: [], drops: [drop("crown", "2026-10-02", { pintPriceGbp: 5 })], saved: [], placeOf });
    expect(one?.usualPintGbp).toBeNull();
    const halfOnly = buildPalTaste({
      diary: [],
      drops: [drop("crown", "2026-10-02", { pintPriceGbp: null }), drop("dog", "2026-10-03", { pintPriceGbp: null })],
      saved: [],
      placeOf,
    });
    expect(halfOnly?.usualPintGbp).toBeNull();
  });

  it("calls an explorer an explorer and a regular a regular, with a favourite night", () => {
    const explorer = buildPalTaste({
      diary: ["crown", "lamb", "dog", "anchor", "ship"].map((id, i) => diary(id, `2026-10-0${i + 1}`)),
      drops: [],
      saved: [],
      placeOf,
    });
    expect(explorer?.style).toBe("explorer");

    // Five Fridays running, mostly the same local.
    const regular = buildPalTaste({
      diary: [
        diary("crown", "2026-09-04"),
        diary("crown", "2026-09-11"),
        diary("crown", "2026-09-18"),
        diary("crown", "2026-09-25"),
        diary("dog", "2026-10-02"),
      ],
      drops: [],
      saved: [],
      placeOf,
    });
    expect(regular?.style).toBe("regular");
    expect(regular?.favouriteNight).toBe("Fridays");
  });

  it("says nothing about a pattern under four visits", () => {
    const taste = buildPalTaste({ diary: [diary("crown", "2026-09-04"), diary("lamb", "2026-09-11")], drops: [], saved: [], placeOf });
    expect(taste?.style).toBeNull();
    expect(taste?.favouriteNight).toBeNull();
  });
});

describe("palTastePreamble", () => {
  it("recalls the last visit's recorded drink price without inventing a bill total", () => {
    const last = buildPalTaste({
      diary: [diary("crown", "2026-10-10")],
      drops: [
        drop("crown", "2026-10-10", { drink: "Camden Hells", pintPriceGbp: 5.8 }),
        drop("crown", "2026-10-09", { drink: "Guinness", pintPriceGbp: 6.2 }),
        drop("dog", "2026-10-09", { drink: "Ale", pintPriceGbp: 5 }),
      ], saved: [], placeOf,
    });
    const context = palTastePreamble(last, "third").join("\n");
    expect(context).toContain("At that visit they recorded Camden Hells at £5.80 a pint.");
    expect(context).toContain("These are recorded prices, not a bill total or proof of what they drank.");
    expect(context).not.toContain("£6.20");
    expect(context).not.toContain("spent £");
  });
  const taste = buildPalTaste({
    diary: [diary("crown", "2026-09-04", 5), diary("crown", "2026-09-11")],
    drops: [
      drop("crown", "2026-10-02", { pintPriceGbp: 5.5, vibeTags: ["quiet pint"] }),
      drop("dog", "2026-10-09", { pintPriceGbp: 6 }),
    ],
    saved: [{ venueId: "anchor", venueName: "The Anchor" }],
    placeOf,
  });

  it("is empty with no read, so the agent knows to ask", () => {
    expect(palTastePreamble(null)).toEqual([]);
  });

  it("speaks as the person in a typed turn and labels the read as habit, never pub fact", () => {
    const lines = palTastePreamble(taste);
    expect(lines[0]).toBe(
      "What my own logs say about my taste. It is my history, never a fact about a pub or tonight's price:",
    );
    expect(lines).toContain("- I have logged 4 visits to 2 pubs, most recently The Dog on 9 Oct.");
    expect(lines).toContain("- I usually pay about £5.75 a pint. That is my habit, not a price at any pub.");
    expect(lines).toContain("- Saved but not tried yet: The Anchor.");
  });

  it("speaks about them in the voice recall answer", () => {
    const lines = palTastePreamble(taste, "third");
    expect(lines[0]).toMatch(/^What their own logs say about their taste/);
    expect(lines).toContain("- They have logged 4 visits to 2 pubs, most recently The Dog on 9 Oct.");
    expect(lines.join(" ")).not.toMatch(/\b(?:I|my)\b/);
  });

  it("keeps the house voice: no exclamation marks and no em dashes", () => {
    for (const line of [...palTastePreamble(taste), ...palTastePreamble(taste, "third")]) {
      expect(line).not.toMatch(/[!—]/);
    }
  });
});

describe("palTasteAsk", () => {
  const known = ["Soho", "Camden", "Shoreditch"];

  it("builds an ask the router reads from their patch, vibe and usual price", () => {
    const taste = buildPalTaste({
      diary: [],
      drops: [
        drop("crown", "2026-10-02", { pintPriceGbp: 5.5, vibeTags: ["quiet pint"] }),
        drop("dog", "2026-10-09", { pintPriceGbp: 5.7 }),
      ],
      saved: [],
      placeOf,
    });
    expect(palTasteAsk(taste, known)).toEqual({
      query: "quiet pub in Soho under £6",
      because: "Going off Soho, your usual patch, the quiet pints you log and about what you usually pay.",
    });
  });

  it("is null when the read has no known patch and no mood to lean on", () => {
    const taste = buildPalTaste({ diary: [diary("ship", "2026-10-02")], drops: [], saved: [], placeOf });
    expect(palTasteAsk(taste, known)).toBeNull();
    expect(palTasteAsk(null, known)).toBeNull();
  });
});
