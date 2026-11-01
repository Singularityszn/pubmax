// F04: a picks section has FOUR states, and both surfaces read the same four.
//
// The audit found /today's tonight-recommendations section rendered empty with
// one map link under it. The vocabulary could not tell "the city is quiet" from
// "we could not look", and the honest half still handed a reader nothing to do.
//
// This file pins the decision (lib/picksState.ts), the words, the two fallback
// doors and the context they carry, then renders BOTH real surfaces at each of
// the four states and reads the copy a person actually sees. Fixtures only: no
// provider, live or bundled, is asked anything here.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/components/nav/NowSegment", () => ({ default: () => null }));
vi.mock("@/components/auth/useViewerHandle", () => ({
  useViewerHandle: () => null,
}));

import TodayClient from "@/app/today/TodayClient";
import TonightListingsNotice from "@/app/tonight/TonightListingsNotice";
import { TODAY_PINTS_DEFAULT_PATCH_ID } from "@/app/today/todayPints";
import { buildDayGreeting, PICKS_EMPTY_LINE } from "@/lib/dayGreeting";
import {
  PICKS_ALTERNATIVE_LABEL,
  PICKS_REFRESHING_LINE,
  PICKS_RETRY_LABEL,
  PICKS_UNAVAILABLE_LINE,
  picksAlternativeWays,
  picksCheckedLabel,
  picksState,
  picksStateOffersAlternative,
  picksStateOffersRetry,
  picksStateShowsRows,
  type PicksState,
  type PicksStateKind,
} from "@/lib/picksState";
import {
  TONIGHT_QUIET_NIGHT_SENTENCE,
  tonightPaintStatus,
} from "@/lib/tonightOutListings";
import { parsePlanOccasionIdFromSearch } from "@/lib/planOccasion";

const NOW = new Date("2026-09-05T21:00:00.000Z");
const OBSERVED = "2026-09-05T17:30:00.000Z";

// The apostrophes in the shipped copy are HTML-escaped by the renderer, so the
// markup is decoded before it is read as the sentence a person sees.
function decode(markup: string): string {
  return markup
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"');
}

// ── The decision ─────────────────────────────────────────────────────────

describe("picksState", () => {
  const cases: ReadonlyArray<[PicksStateKind, Parameters<typeof picksState>[0]]> = [
    ["ready", { visibleCount: 3, inFlight: false, unreadable: false }],
    ["refreshing", { visibleCount: 3, inFlight: true, unreadable: false }],
    ["genuinely_empty", { visibleCount: 0, inFlight: false, unreadable: false }],
    ["temporarily_unavailable", { visibleCount: 0, inFlight: false, unreadable: true }],
  ];

  for (const [kind, input] of cases) {
    it(`answers ${kind}`, () => {
      expect(picksState(input).kind).toBe(kind);
    });
  }

  it("is refreshing while a read is in flight, whatever else is true", () => {
    // A read about to replace the answer may not have that answer called ready
    // or empty: either would date the section to a read that has not landed.
    expect(
      picksState({ visibleCount: 0, inFlight: true, unreadable: true }).kind,
    ).toBe("refreshing");
  });

  it("never calls a read we could not run an empty night", () => {
    const state = picksState({
      visibleCount: 0,
      inFlight: false,
      unreadable: true,
      reason: "Couldn't reach tonight's listings just now.",
    });
    expect(state.kind).toBe("temporarily_unavailable");
    expect(state.kind).not.toBe("genuinely_empty");
  });

  it("carries the reason and the checked-at instant with the state", () => {
    const state = picksState({
      visibleCount: 0,
      inFlight: false,
      unreadable: true,
      reason: "Some listings could not be checked.",
      checkedAt: OBSERVED,
    });
    expect(state.reason).toBe("Some listings could not be checked.");
    expect(state.checkedAt).toBe(OBSERVED);
  });

  it("drops a reason from a genuinely empty night, which has none", () => {
    expect(
      picksState({
        visibleCount: 0,
        inFlight: false,
        unreadable: false,
        reason: "stale lane note",
      }).reason,
    ).toBeNull();
  });

  it("shows rows only where rows exist and the state may paint them", () => {
    const held: PicksState = { kind: "refreshing", reason: null, checkedAt: OBSERVED, retryable: true };
    expect(picksStateShowsRows(held, 3)).toBe(true);
    expect(picksStateShowsRows(held, 0)).toBe(false);
    expect(
      picksStateShowsRows({ kind: "genuinely_empty", reason: null, checkedAt: null, retryable: false }, 3),
    ).toBe(false);
  });

  it("offers the alternative on both honest absences and neither presence", () => {
    const kinds: PicksStateKind[] = [
      "ready",
      "refreshing",
      "genuinely_empty",
      "temporarily_unavailable",
    ];
    const offering = kinds.filter((kind) =>
      picksStateOffersAlternative({ kind, reason: null, checkedAt: null, retryable: true }),
    );
    expect(offering).toEqual(["genuinely_empty", "temporarily_unavailable"]);
  });

  it("offers a retry only for the lane we could not read", () => {
    expect(
      picksStateOffersRetry({
        kind: "temporarily_unavailable",
        reason: null,
        checkedAt: null,
        retryable: true,
      }),
    ).toBe(true);
    expect(
      picksStateOffersRetry({
        kind: "genuinely_empty",
        reason: null,
        checkedAt: null,
        retryable: false,
      }),
    ).toBe(false);
  });

  // Battle test M07: a preview with no listings keys answered `not-configured`
  // and /today printed "Nothing on tonight's list yet." A lane nobody ASKED is
  // an absence about us, exactly like a lane that FAILED.
  it("a lane nobody asked is unavailable, never an empty night", () => {
    const state = picksState({
      visibleCount: 0,
      inFlight: false,
      unreadable: true,
      reason: "We don\u2019t have listings to show yet.",
      retryable: false,
    });
    expect(state.kind).toBe("temporarily_unavailable");
    expect(state.kind).not.toBe("genuinely_empty");
  });

  it("tells a lane nobody switched on rather than offering to re-ask it", () => {
    const state = picksState({
      visibleCount: 0,
      inFlight: false,
      unreadable: true,
      reason: "We don\u2019t have listings to show yet.",
      retryable: false,
    });
    expect(picksStateOffersAlternative(state)).toBe(true);
    expect(picksStateOffersRetry(state)).toBe(false);
  });
});

describe("picksCheckedLabel", () => {
  it("dates a held answer by the day its evidence was observed", () => {
    expect(picksCheckedLabel(OBSERVED)).toBe("Checked 5 Sept");
  });

  it("prints nothing rather than a date it cannot read", () => {
    expect(picksCheckedLabel(null)).toBeNull();
    expect(picksCheckedLabel("not a date")).toBeNull();
  });
});

// ── The two doors ────────────────────────────────────────────────────────

describe("picksAlternativeWays", () => {
  it("offers pubs near you and a plan door, in that order, and nothing else", () => {
    expect(picksAlternativeWays().map((way) => way.key)).toEqual([
      "pubs-near",
      "plan",
    ]);
  });

  // Astra F02: /near ranks the nearest pubs by listed price and holds no crowd
  // signal, so no door into it may promise a crowd state.
  it("promises only what /near answers, never a crowd state", () => {
    const near = picksAlternativeWays().find((way) => way.key === "pubs-near");
    expect(near?.label).toBe("Pubs near you");
    expect(near?.label).not.toMatch(/quiet|empty|busy|calm/i);
  });

  it("carries the selected area and occasion", () => {
    const ways = picksAlternativeWays({ patchId: "soho", occasion: "quiet" });
    expect(ways[0]?.href).toBe("/near?patch=soho");
    expect(ways[1]?.href).toBe("/plan?occasion=quiet");
  });

  it("leaves a parameter off rather than inventing one", () => {
    const ways = picksAlternativeWays({ patchId: null, occasion: "  " });
    expect(ways[0]?.href).toBe("/near");
    expect(ways[1]?.href).toBe("/plan");
  });

  it("names neither door as a listing", () => {
    for (const way of picksAlternativeWays()) {
      expect(way.label.toLowerCase()).not.toContain("listing");
      expect(way.label.toLowerCase()).not.toContain("event");
    }
    expect(PICKS_ALTERNATIVE_LABEL).toBe("No event needed");
  });
});

describe("parsePlanOccasionIdFromSearch", () => {
  it("answers a closed occasion id", () => {
    expect(parsePlanOccasionIdFromSearch("?occasion=quiet")).toBe("quiet");
    expect(parsePlanOccasionIdFromSearch("?occasion=gallery-pint")).toBe("gallery-pint");
  });

  it("refuses anything outside the closed sets", () => {
    expect(parsePlanOccasionIdFromSearch("?occasion=Quiet%20in%20Clapham")).toBeNull();
    expect(parsePlanOccasionIdFromSearch("?describe=anything")).toBeNull();
    expect(parsePlanOccasionIdFromSearch("")).toBeNull();
  });
});

// ── A retry keeps the rows it already holds ──────────────────────────────

describe("tonightPaintStatus", () => {
  it("lets a re-read paint the rows it is holding", () => {
    // useWhatsOnTonight.retry() drops to `idle` and keeps its rows; the merge
    // would otherwise empty a full list back to a skeleton on every press.
    expect(tonightPaintStatus("idle", 4)).toBe("ready");
  });

  it("leaves a first load alone, which holds nothing to paint", () => {
    expect(tonightPaintStatus("idle", 0)).toBe("idle");
  });

  it("changes nothing once a read has answered", () => {
    expect(tonightPaintStatus("ready", 4)).toBe("ready");
    expect(tonightPaintStatus("empty", 0)).toBe("empty");
    expect(tonightPaintStatus("error", 4)).toBe("error");
  });
});

// ── Tonight, rendered, at each of the four states ────────────────────────

function renderTonight(
  state: PicksState,
  overrides: Partial<Parameters<typeof TonightListingsNotice>[0]> = {},
): string {
  return decode(
    renderToStaticMarkup(
      createElement(TonightListingsNotice, {
        state,
        note: null,
        noteOffersRetry: false,
        emptyLead: TONIGHT_QUIET_NIGHT_SENTENCE,
        heldRowCount: 0,
        onRetry: () => undefined,
        ...overrides,
      }),
    ),
  );
}

describe("Tonight listings notice, one render per state", () => {
  it("ready says nothing about its own read", () => {
    const markup = renderTonight(
      { kind: "ready", reason: null, checkedAt: OBSERVED, retryable: true },
      { heldRowCount: 3 },
    );
    expect(markup).not.toContain(PICKS_ALTERNATIVE_LABEL);
    expect(markup).not.toContain(PICKS_REFRESHING_LINE);
    expect(markup).not.toContain("quiet one tonight");
  });

  it("refreshing over held rows keeps them and dates them", () => {
    const markup = renderTonight(
      { kind: "refreshing", reason: null, checkedAt: OBSERVED, retryable: true },
      { heldRowCount: 3 },
    );
    expect(markup).toContain(PICKS_REFRESHING_LINE);
    expect(markup).toContain("Checked 5 Sept");
    // The rows are still the answer, so the section owes no way out of itself.
    expect(markup).not.toContain(PICKS_ALTERNATIVE_LABEL);
    expect(markup).not.toContain("listingsSkeleton");
  });

  it("a first load is a skeleton and says nothing about the city", () => {
    const markup = renderTonight(
      { kind: "refreshing", reason: null, checkedAt: null, retryable: true },
      { heldRowCount: 0 },
    );
    expect(markup).toContain("listingsSkeleton");
    // One quiet row, never a stack of grey cards.
    expect(markup.match(/class="listingsSkeletonCard"/g)).toHaveLength(1);
    expect(markup).not.toContain(PICKS_REFRESHING_LINE);
    expect(markup).not.toContain("quiet one tonight");
  });

  it("genuinely empty keeps its map exit and adds the two non-event doors", () => {
    const markup = renderTonight({
      kind: "genuinely_empty",
      reason: null,
      checkedAt: OBSERVED,
      retryable: false,
    });
    expect(markup).toContain("quiet one tonight");
    expect(markup).toContain("The map still knows where the cheap pints are");
    expect(markup).toContain(PICKS_ALTERNATIVE_LABEL);
    expect(markup).toContain("Pubs near you");
    expect(markup).toContain("Plan the night instead");
  });

  it("temporarily unavailable never words the city as quiet", () => {
    const markup = renderTonight({
      kind: "temporarily_unavailable",
      reason: null,
      checkedAt: null,
      retryable: true,
    });
    expect(markup).toContain(PICKS_UNAVAILABLE_LINE);
    expect(markup).toContain(PICKS_RETRY_LABEL);
    expect(markup).toContain(PICKS_ALTERNATIVE_LABEL);
    expect(markup).not.toContain("quiet one tonight");
    expect(markup).not.toContain(TONIGHT_QUIET_NIGHT_SENTENCE);
  });

  it("an unreadable lane speaks in its own words when it has some", () => {
    const markup = renderTonight({
      kind: "temporarily_unavailable",
      reason: "Some listings could not be checked.",
      checkedAt: null,
      retryable: true,
    });
    expect(markup).toContain("Some listings could not be checked.");
  });

  it("carries the selected area and occasion into both doors", () => {
    const markup = renderTonight(
      { kind: "genuinely_empty", reason: null, checkedAt: null, retryable: false },
      { context: { patchId: "soho", occasion: "coffee" } },
    );
    expect(markup).toContain('href="/near?patch=soho"');
    expect(markup).toContain('href="/plan?occasion=coffee"');
  });
});

// ── Today no longer carries tonight's picks ─────────────────────────────
//
// Launch review, 30 Oct 2026 (design V1): /today repeated Tonight's picks and
// pub of the day. Tonight's picks now live on /tonight alone, so Today renders
// no picks section in any state, and the four states are Tonight's to word.

function renderToday(): string {
  return decode(
    renderToStaticMarkup(
      createElement(TodayClient, {
        dateLabel: "Saturday 5 September",
        nowIso: NOW.toISOString(),
        greeting: buildDayGreeting({
          now: NOW,
          weather: null,
          dateLabel: "Saturday 5 September",
          name: null,
        }),
        weather: null,
        weatherByArea: {},
        fact: null,
        pintsIndex: {
          [TODAY_PINTS_DEFAULT_PATCH_ID]: {
            patchId: TODAY_PINTS_DEFAULT_PATCH_ID,
            areaName: "Central London",
            rows: [],
          },
        },
        quietPint: null,
      }),
    ),
  );
}

describe("Today carries no picks section", () => {
  it("renders no picks state, no picks copy and no picks doors", () => {
    const markup = renderToday();
    expect(markup).not.toContain('data-testid="today-picks"');
    expect(markup).not.toContain("data-picks-state");
    expect(markup).not.toContain("Top picks for tonight");
    expect(markup).not.toContain(PICKS_EMPTY_LINE.night);
    expect(markup).not.toContain(PICKS_ALTERNATIVE_LABEL);
    // The way to tonight's listings is one link to the page that owns them.
    expect(markup).toContain('href="/tonight"');
  });
});
