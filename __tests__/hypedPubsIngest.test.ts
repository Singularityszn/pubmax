import { describe, expect, it } from "vitest";

import { buildHypedPubsFile, normaliseVenueName } from "../scripts/hyped-pubs-ingest.mjs";
import { defined } from "@/__tests__/helpers/defined";

/**
 * The fence between a research file and the app.
 *
 * The research is written by hand, so the ingest is where a typo, an undated
 * link or an invented venue id is caught. Every refusal is counted rather than
 * repaired: a run report that says "3 dropped, 2 with no dated source" is how
 * tomorrow's research gets better.
 */

const NOW = Date.parse("2026-09-07T18:00:00.000Z");
const OBSERVED = "2026-09-06T09:00:00.000Z";

const VENUES = [
  { id: "venue-dover", name: "The Dover Castle", borough: "Westminster" },
  { id: "venue-crown-camden", name: "The Crown", borough: "Camden" },
  { id: "venue-crown-hackney", name: "The Crown", borough: "Hackney" },
];

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "The Dover Castle",
    area: "Westminster",
    whyLine: "Two threads this week called it the best snug in town.",
    sources: [{ label: "r/london", url: "https://example.com/thread", observedAt: OBSERVED }],
    score: 7,
    mentions: 3,
    ...overrides,
  };
}

describe("hyped pubs ingest", () => {
  it("matches a pub by name to exactly one curated venue", () => {
    const { file, report } = buildHypedPubsFile({ rows: [row()] }, VENUES, NOW);
    expect(file.rows).toHaveLength(1);
    expect(defined(file.rows[0]).venueId).toBe("venue-dover");
    expect(report.matched).toBe(1);
  });

  it("uses the area to tell two pubs of one name apart", () => {
    const { file } = buildHypedPubsFile(
      { rows: [row({ name: "The Crown", area: "Hackney" })] },
      VENUES,
      NOW,
    );
    expect(defined(file.rows[0]).venueId).toBe("venue-crown-hackney");
  });

  it("leaves an ambiguous name unmatched rather than guessing", () => {
    const { file, report } = buildHypedPubsFile(
      { rows: [row({ name: "The Crown", area: "Somewhere else" })] },
      VENUES,
      NOW,
    );
    expect(defined(file.rows[0]).venueId).toBeNull();
    expect(report.matched).toBe(0);
    expect(report.published).toBe(1);
  });

  it("keeps a pub whose stated venue id no curated venue answers to, unmatched", () => {
    // The scout's 7 September file stated twelve `venue-uk-*` ids, which name
    // rows in the UK BASE layer rather than the curated index the map opens by
    // `?sel=`. The pub is real and the talk about it is real; only our own
    // pin is missing, so the row shows and says so.
    const { file, report } = buildHypedPubsFile(
      { rows: [row({ name: "Ye Olde Mitre", venueId: "venue-uk-w420644092" })] },
      VENUES,
      NOW,
    );
    expect(file.rows).toHaveLength(1);
    expect(defined(file.rows[0]).venueId).toBeNull();
    expect(report.unmatchedIds).toBe(1);
    expect(report.matched).toBe(0);
  });

  it("keeps a long single sentence and refuses a second one", () => {
    const long = `Named again and again as the Soho pub people queue for, with one review calling it ${"the best in London ".repeat(4)}and a video of its roast passing 482k views.`;
    expect(long.length).toBeGreaterThan(200);
    const { file, report } = buildHypedPubsFile({ rows: [row({ whyLine: long })] }, VENUES, NOW);
    expect(file.rows).toHaveLength(1);
    expect(report.drops["why-line-too-long"]).toBe(0);
  });

  it("refuses a row with no dated source, and counts it", () => {
    const { file, report } = buildHypedPubsFile(
      {
        rows: [
          row({ sources: [] }),
          row({ sources: [{ label: "r/london", url: "nope", observedAt: OBSERVED }] }),
        ],
      },
      VENUES,
      NOW,
    );
    expect(file.rows).toEqual([]);
    expect(report.drops["no-dated-source"]).toBe(2);
  });

  it("refuses a reading dated in the future", () => {
    const { report } = buildHypedPubsFile(
      {
        rows: [
          row({
            sources: [
              {
                label: "r/london",
                url: "https://example.com/t",
                observedAt: "2026-09-09T00:00:00.000Z",
              },
            ],
          }),
        ],
      },
      VENUES,
      NOW,
    );
    expect(report.drops["future-observation"]).toBe(1);
  });

  it("refuses a paragraph where one sentence was asked for", () => {
    const { report } = buildHypedPubsFile(
      {
        rows: [
          row({ whyLine: "It is busy. It is loud. Everybody says so." }),
          row({ whyLine: `A${"very long ".repeat(30)}line.` }),
        ],
      },
      VENUES,
      NOW,
    );
    expect(report.drops["why-line-too-long"]).toBe(2);
  });

  it("refuses a row with no name, no area or no reason", () => {
    const { report } = buildHypedPubsFile(
      { rows: [row({ name: "" }), row({ area: "  " }), row({ whyLine: undefined })] },
      VENUES,
      NOW,
    );
    expect(report.drops["missing-name"]).toBe(1);
    expect(report.drops["missing-area"]).toBe(1);
    expect(report.drops["missing-why-line"]).toBe(1);
  });

  it("publishes loudest first and stamps the day it ran", () => {
    const { file } = buildHypedPubsFile(
      {
        rows: [
          row({ name: "The Quiet One", score: 2 }),
          row({ name: "The Loud One", score: 9 }),
        ],
      },
      VENUES,
      NOW,
    );
    expect(file.rows.map((entry: { name: string }) => entry.name)).toEqual([
      "The Loud One",
      "The Quiet One",
    ]);
    expect(file.generatedAt).toBe(new Date(NOW).toISOString());
    expect(file.city).toBe("london");
    expect(file.version).toBe(1);
  });

  it("reads a name the way a person writes one", () => {
    expect(normaliseVenueName("The Dover Castle")).toBe("dover castle");
    expect(normaliseVenueName("J.J. Moon’s")).toBe("j j moons");
  });
});
