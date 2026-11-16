import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import evidence from "@/data/amenities/london_pub_website_evidence.json";
import { runAskTool } from "@/lib/ask/tools";
import { defined } from "@/__tests__/helpers/defined";

type Proof = { requirement: string; source: string; observedAt: string };
type SearchData = { found: number; coverageGaps: string[]; venues: { id: string; evidence?: Proof[] }[] };

const LATER = Date.parse("2026-11-14T20:00:00.000Z");
const EVAL_INSTANT = Date.parse("2026-07-21T18:00:00.000Z");

const dartsVenueIds = new Set(
  (evidence.rows as { venueId: string | null; amenities: { darts?: string } }[])
    .filter((row) => row.venueId && row.amenities.darts)
    .map((row) => row.venueId),
);

async function dartsSearch(now: number) {
  const query = "Six pubs with a darts board";
  const result = await runAskTool("search_venues", { query }, { cityId: "london", query, skipModel: true, now });
  return { result, data: result.data as SearchData };
}

describe("Pal darts asks against the committed pub website evidence", () => {
  it("confirms darts only at venues whose own website quote was read before now", async () => {
    const { result, data } = await dartsSearch(LATER);
    expect(data.coverageGaps).toEqual([]);
    expect(result.cards.length).toBeGreaterThan(0);
    for (const row of data.venues) {
      expect(dartsVenueIds.has(row.id)).toBe(true);
      const proof = row.evidence?.find((item) => item.requirement === "darts");
      expect(proof?.source).toBe("Pub website");
      expect(Date.parse(defined(proof).observedAt)).toBeLessThanOrEqual(LATER);
    }
  });

  it("confirms none at an instant before any of those websites was read", async () => {
    const { result, data } = await dartsSearch(EVAL_INSTANT);
    expect(result.cards).toEqual([]);
    expect(data).toMatchObject({ found: 0, coverageGaps: [] });
  });
});
