import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import ContributorRecord from "@/components/contributors/ContributorRecord";
import type { ContributorLeaderboard } from "@/lib/contributorLeaderboard";

function render(board: ContributorLeaderboard): string {
  return renderToStaticMarkup(createElement(ContributorRecord, { board }));
}

describe("ContributorRecord", () => {
  it("labels the all-time window and presents equal totals as joint ranks", () => {
    const html = render({
      status: "ready",
      window: {
        kind: "all-time",
        label: "All visible identity-backed contributions, all time",
      },
      entries: [
        {
          rank: 1,
          handle: "alex",
          total: 2,
          prices: 0,
          reviews: 1,
          recommendations: 1,
        },
        {
          rank: 1,
          handle: "sam",
          total: 2,
          prices: 1,
          reviews: 1,
          recommendations: 0,
        },
      ],
    });

    expect(html).toContain("Contributor record");
    // The window rides in the lede in plain words. The pill that printed it
    // looked like a control and was not (taste pass, 18 Oct 2026).
    expect(html).toContain("counted over all time");
    expect(html).not.toContain("contributorWindow");
    expect(html.match(/class="contributorRank"[^>]*>1</g)).toHaveLength(2);
    expect(html).toContain('href="/u/alex"');
    // A lane with nothing in it is left out of the row's line.
    expect(html).toContain("1 Visit Report · 1 Recommendation");
    expect(html).toContain("1 price · 1 Visit Report");
    expect(html).toContain("Equal totals share a place");
    // The record is rows on hairlines, not a stack of cards.
    expect(html).toContain('class="rowList contributorList"');
    expect(html).not.toMatch(/winner|points|score/i);
    // Plumbing words stay off the screen (docs/VOICE.md).
    expect(html).not.toMatch(/identity-backed/i);
  });

  it("states a failed read without turning it into contributor absence", () => {
    const html = render({
      status: "degraded",
      window: {
        kind: "unavailable",
        label: "All-time record unavailable",
      },
      entries: [],
    });

    expect(html).toContain("Record unavailable");
    expect(html).toContain("We could not load the record just now");
    expect(html).toContain("no partial totals are shown");
    expect(html).not.toMatch(/no contributors|nobody has contributed/i);
  });

  it("frames an answered early empty record without calling the product dead", () => {
    const html = render({
      status: "ready",
      window: {
        kind: "all-time",
        label: "All visible identity-backed contributions, all time",
      },
      entries: [],
    });

    expect(html).toContain('class="emptyStateTitle">The record starts with the first pint');
    expect(html).toContain("Log a price with a public profile and it counts here.");
    expect(html).not.toContain("First public names land here");
    expect(html).not.toMatch(/no contributors|nobody has contributed/i);
  });

  it("marks a thin record plainly while preserving its real rows", () => {
    const html = render({
      status: "ready",
      window: {
        kind: "all-time",
        label: "All visible identity-backed contributions, all time",
      },
      entries: [
        {
          rank: 1,
          handle: "sam",
          total: 1,
          prices: 1,
          reviews: 0,
          recommendations: 0,
        },
      ],
    });

    expect(html).toContain("Early record");
    expect(html).not.toContain("Every visible contribution counts");
    expect(html).toContain("@sam");
    expect(html).toContain("<strong>1</strong>");
    expect(html).toContain("<span>contribution</span>");
  });
});
