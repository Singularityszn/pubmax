import { describe, expect, it } from "vitest";
import {
  countTonightKinds,
  GLANCE_QUIET_EXIT,
  GLANCE_QUIET_LINE,
  tonightGlanceLine,
} from "@/lib/palGlance";
import type { WhatsOnRow } from "@/lib/whatsOn";

function makeRow(overrides: Partial<WhatsOnRow> = {}): WhatsOnRow {
  return {
    id: "quiz-1",
    placeName: "The Test Arms",
    kind: "quiz",
    startsAt: "2026-07-11T19:30:00+01:00",
    title: "Pub quiz",
    source: { label: "Question One", url: "https://questionone.com/venues/test-arms/" },
    observedAt: "2026-07-11T18:00:00.000Z",
    confidence: "listed",
    ...overrides,
  };
}

describe("countTonightKinds", () => {
  it("tallies each kind and leaves absent kinds at zero", () => {
    const rows = [
      makeRow({ id: "q1" }),
      makeRow({ id: "q2" }),
      makeRow({ id: "s1", kind: "sport" }),
      makeRow({ id: "d1", kind: "deal" }),
      makeRow({ id: "d2", kind: "deal" }),
      makeRow({ id: "d3", kind: "deal" }),
    ];
    expect(countTonightKinds(rows)).toEqual({ quiz: 2, music: 0, sport: 1, deal: 3 });
  });

  it("returns all zeros for no rows", () => {
    expect(countTonightKinds([])).toEqual({ quiz: 0, music: 0, sport: 0, deal: 0 });
  });
});

describe("tonightGlanceLine", () => {
  it("names only non-zero kinds in evening order (quiz, match, gig, deal)", () => {
    expect(tonightGlanceLine({ quiz: 12, music: 5, sport: 3, deal: 31 })).toBe(
      "On across London tonight: 12 pub quizzes, 3 matches on, 5 gigs, 31 deals running.",
    );
  });

  it("uses singular forms at exactly one", () => {
    expect(tonightGlanceLine({ quiz: 1, music: 1, sport: 1, deal: 1 })).toBe(
      "On across London tonight: 1 pub quiz, 1 match on, 1 gig, 1 deal running.",
    );
  });

  it("skips zero kinds entirely", () => {
    expect(tonightGlanceLine({ quiz: 0, music: 0, sport: 2, deal: 0 })).toBe(
      "On across London tonight: 2 matches on.",
    );
  });

  it("returns null when nothing is on (the quiet-night panel takes over)", () => {
    expect(tonightGlanceLine({ quiz: 0, music: 0, sport: 0, deal: 0 })).toBeNull();
  });
});

describe("glance voice", () => {
  it("keeps every glance string em-dash free and exclamation free", () => {
    const strings = [
      GLANCE_QUIET_LINE,
      GLANCE_QUIET_EXIT,
      tonightGlanceLine({ quiz: 2, music: 1, sport: 1, deal: 4 }) ?? "",
    ];
    for (const line of strings) {
      expect(line.includes("—"), `em dash in "${line}"`).toBe(false);
      expect(line.includes("!"), `exclamation in "${line}"`).toBe(false);
    }
  });

  it("quiet night hands the user a real exit", () => {
    expect(GLANCE_QUIET_LINE).toContain("quiet one");
    expect(GLANCE_QUIET_EXIT).toContain("map");
  });
});
