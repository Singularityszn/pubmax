import { describe, expect, it } from "vitest";

import {
  hypedPubCredit,
  hypedPubMapHref,
  hypedPubIsFresh,
  hypedPubPriceIndex,
  hypedPubsForPage,
  hypedPubsMapFirst,
  orderHypedPubs,
  parseHypedPubs,
  HYPED_PUB_FRESH_DAYS,
  HYPED_PUBS_PAGE_LIMIT,
  HYPED_PUBS_TITLE,
  type HypedPub,
} from "@/lib/hypedPubs";

/**
 * The hyped-pubs pack, and what it refuses to publish.
 *
 * Every row on this lane is a claim about what somebody said, so the guards
 * here are the same shape as the archival-price guards in lib/priceHistory.ts:
 * a row with nothing to cite is dropped rather than shown bare, and nothing is
 * repaired on the way in.
 */

const OBSERVED = "2026-09-06T09:00:00.000Z";
const NOW = new Date("2026-09-07T09:00:00.000Z");
const DAY_MS = 86_400_000;

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "The Example Arms",
    area: "Peckham",
    venueId: "venue-example",
    whyLine: "Two threads in a week called it the best new pour in south London.",
    sources: [{ label: "r/london", url: "https://example.com/thread", observedAt: OBSERVED }],
    score: 7,
    mentions: 3,
    ...overrides,
  };
}

describe("hyped pubs pack", () => {
  it("keeps a row that names a pub, an area, a reason and a dated source", () => {
    const file = parseHypedPubs({ generatedAt: OBSERVED, rows: [row()] });
    expect(file.generatedAt).toBe(OBSERVED);
    expect(file.rows).toHaveLength(1);
    expect(file.rows[0]?.name).toBe("The Example Arms");
    expect(file.rows[0]?.venueId).toBe("venue-example");
  });

  it("drops a row with no source at all", () => {
    expect(parseHypedPubs({ rows: [row({ sources: [] })] }).rows).toEqual([]);
  });

  it("drops a source that carries no http link or no readable day", () => {
    const noLink = parseHypedPubs({
      rows: [row({ sources: [{ label: "r/london", url: "not-a-url", observedAt: OBSERVED }] })],
    });
    const noDay = parseHypedPubs({
      rows: [
        row({
          sources: [{ label: "r/london", url: "https://example.com/t", observedAt: "never" }],
        }),
      ],
    });
    expect(noLink.rows).toEqual([]);
    expect(noDay.rows).toEqual([]);
  });

  it("keeps an unmatched pub and leaves its venue id null", () => {
    const file = parseHypedPubs({ rows: [row({ venueId: undefined })] });
    expect(file.rows).toHaveLength(1);
    expect(file.rows[0]?.venueId).toBeNull();
  });

  it("answers no rows for a file that is not a file", () => {
    expect(parseHypedPubs(null).rows).toEqual([]);
    expect(parseHypedPubs({ rows: "nope" }).rows).toEqual([]);
    expect(parseHypedPubs({ rows: [42, null] }).rows).toEqual([]);
  });

  it("orders by score, then mentions, then name", () => {
    const rows = parseHypedPubs({
      rows: [
        row({ name: "B", score: 4, mentions: 9 }),
        row({ name: "A", score: 9, mentions: 1 }),
        row({ name: "C", score: 4, mentions: 9 }),
        row({ name: "D", score: 4, mentions: 12 }),
      ],
    }).rows;
    expect(rows.map((entry) => entry.name)).toEqual(["A", "D", "B", "C"]);
  });

  it("orders a hand-built list the same way", () => {
    const built = orderHypedPubs([
      row({ name: "Low", score: 1 }) as unknown as HypedPub,
      row({ name: "High", score: 8 }) as unknown as HypedPub,
    ]);
    expect(built.map((entry) => entry.name)).toEqual(["High", "Low"]);
  });

  it("credits the freshest reading a row holds", () => {
    const [entry] = parseHypedPubs({
      rows: [
        row({
          sources: [
            {
              label: "Old paper",
              url: "https://example.com/a",
              observedAt: "2026-08-01T00:00:00.000Z",
            },
            { label: "r/london", url: "https://example.com/b", observedAt: OBSERVED },
          ],
        }),
      ],
    }).rows;
    expect(hypedPubCredit(entry as HypedPub)?.label).toBe("r/london");
  });

  it("hands the page the rows it prints and nothing else", () => {
    // The pack carries 48 rows and three sources each. The document is
    // prerendered, so every byte of it is served to every reader: the page
    // takes the rows it can show and the ONE credit each of them prints.
    const rows = parseHypedPubs({
      rows: Array.from({ length: 30 }, (_, index) =>
        row({
          name: `Pub ${index}`,
          score: 30 - index,
          sources: [
            {
              label: "r/london",
              url: "https://example.com/a",
              observedAt: "2026-08-01T00:00:00.000Z",
            },
            { label: "Time Out", url: "https://example.com/b", observedAt: OBSERVED },
          ],
        }),
      ),
    }).rows;
    const page = hypedPubsForPage(rows, { now: NOW });
    expect(page).toHaveLength(HYPED_PUBS_PAGE_LIMIT);
    expect(page[0]?.name).toBe("Pub 0");
    expect(page[0]?.sources).toHaveLength(1);
    expect(page[0]?.sources[0]?.label).toBe("Time Out");
  });

  it("links a matched pub to the map, and an unmatched one nowhere", () => {
    const matched = parseHypedPubs({ rows: [row()] }).rows[0] as HypedPub;
    const unmatched = parseHypedPubs({ rows: [row({ venueId: undefined })] })
      .rows[0] as HypedPub;
    expect(hypedPubMapHref(matched, new Set(["venue-example"]))).toBe("/map?sel=venue-example");
    expect(hypedPubMapHref(matched, new Set())).toBeNull();
    expect(hypedPubMapHref(matched, null)).toBeNull();
    expect(hypedPubMapHref(matched, undefined)).toBe("/map?sel=venue-example");
    expect(hypedPubMapHref(unmatched, new Set(["venue-example"]))).toBeNull();
  });

  it("names the rows as recommendations, never as tonight's talk", () => {
    expect(HYPED_PUBS_TITLE).toBe("Pubs Londoners keep recommending");
    expect(HYPED_PUBS_TITLE.toLowerCase()).not.toContain("tonight");
    expect(HYPED_PUBS_TITLE.toLowerCase()).not.toContain("talking");
  });

  it("drops a row whose freshest credit is older than the freshness window", () => {
    const at = (days: number) => new Date(NOW.getTime() - days * DAY_MS).toISOString();
    const rows = parseHypedPubs({
      rows: [
        row({ name: "Fresh", sources: [{ label: "r/london", url: "https://example.com/a", observedAt: at(10) }] }),
        row({ name: "Edge", sources: [{ label: "r/london", url: "https://example.com/b", observedAt: at(HYPED_PUB_FRESH_DAYS) }] }),
        row({
          name: "Stale",
          sources: [{ label: "r/london", url: "https://example.com/c", observedAt: at(HYPED_PUB_FRESH_DAYS + 1) }],
        }),
        // One fresh credit keeps a row with older ones beside it.
        row({
          name: "Mixed",
          sources: [
            { label: "Old", url: "https://example.com/d", observedAt: at(300) },
            { label: "New", url: "https://example.com/e", observedAt: at(5) },
          ],
        }),
      ],
    }).rows;
    expect(rows.filter((entry) => hypedPubIsFresh(entry, NOW)).map((entry) => entry.name).sort()).toEqual([
      "Edge",
      "Fresh",
      "Mixed",
    ]);
    const page = hypedPubsForPage(rows, { now: NOW });
    expect(page.map((entry) => entry.name)).not.toContain("Stale");
    expect(page.find((entry) => entry.name === "Mixed")?.sources[0]?.label).toBe("New");
    // A pack that has wholly aged out prints nothing rather than old talk.
    expect(hypedPubsForPage(rows, { now: NOW.getTime() + 400 * DAY_MS })).toEqual([]);
  });

  it("carries the listed pint we hold for a matched pub, dated, and nothing for the rest", () => {
    const prices = hypedPubPriceIndex([
      { id: "venue-example", cheapestPrice: 5.2, observedAt: "2026-09-01T10:00:00.000Z" },
      { id: "venue-undated", cheapestPrice: 4.1, observedAt: null },
      { id: "venue-unpriced", cheapestPrice: null, observedAt: "2026-09-01T10:00:00.000Z" },
    ]);
    expect([...prices.keys()]).toEqual(["venue-example"]);
    const rows = parseHypedPubs({
      rows: [
        row(),
        row({ name: "Undated", venueId: "venue-undated" }),
        row({ name: "Unmatched", venueId: undefined }),
      ],
    }).rows;
    const page = hypedPubsForPage(rows, { now: NOW, prices });
    expect(page.find((entry) => entry.name === "The Example Arms")?.listedPint).toEqual({
      priceGbp: 5.2,
      observedAt: "2026-09-01T10:00:00.000Z",
    });
    expect(page.find((entry) => entry.name === "Undated")).not.toHaveProperty("listedPint");
    expect(page.find((entry) => entry.name === "Unmatched")).not.toHaveProperty("listedPint");
  });

  it("puts the pubs the map can open before the ones not on it yet", () => {
    const rows = parseHypedPubs({
      rows: [
        row({ name: "Loud unmatched", venueId: undefined, score: 9 }),
        row({ name: "Matched", venueId: "venue-a", score: 8 }),
        row({ name: "Not selectable", venueId: "venue-b", score: 7 }),
        row({ name: "Also matched", venueId: "venue-c", score: 6 }),
      ],
    }).rows;
    expect(hypedPubsMapFirst(rows, new Set(["venue-a", "venue-c"])).map((entry) => entry.name)).toEqual([
      "Matched",
      "Also matched",
      "Loud unmatched",
      "Not selectable",
    ]);
  });
});
