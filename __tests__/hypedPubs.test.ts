import { describe, expect, it } from "vitest";

import {
  hypedPubCredit,
  hypedPubMapHref,
  orderHypedPubs,
  parseHypedPubs,
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
});
