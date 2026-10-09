import { describe, expect, it } from "vitest";

import { todayAnswer, tonightAnswer } from "@/lib/landingAnswers";
import { observationFacts } from "@/lib/weatherObservationCopy";

// The two cards under the picture answer the captain's own two questions:
// "What is happening today? What is happening tonight?" Each is one sentence
// with the London day stamped on it, and a lane nobody could read says so
// rather than printing a number.

const STAMP = "Sunday 7 September";

describe("the front door's two answers", () => {
  const observation = {
    feelsLikeC: 19.2,
    condition: "Cloudy",
    precipitationProbabilityPct: 0,
    windKph: 11,
    observedAt: "2026-09-07T17:00:00.000Z",
  };

  it("says what today is from the weather read, with nothing that turns false inside the hour", () => {
    const facts = observationFacts({
      observation,
      nightArea: null,
      now: new Date("2026-09-07T17:30:00.000Z"),
      stale: false,
    });
    expect(todayAnswer(facts, STAMP)).toEqual({
      line: "19°C feels like, cloudy, 0% chance of rain, 11 km/h wind.",
      stamp: STAMP,
      measured: true,
    });
  });

  it("says plainly when there is no reading at all", () => {
    expect(todayAnswer(null, STAMP)).toEqual({
      line: "We couldn't read today's London weather just now.",
      stamp: STAMP,
      measured: false,
    });
  });

  it("prints a stale sky as its last read, with no age to go stale while the copy is held", () => {
    const facts = observationFacts({
      observation,
      nightArea: null,
      now: new Date("2026-09-09T17:00:00.000Z"),
      stale: true,
    });
    expect(todayAnswer(facts, STAMP)).toEqual({
      line: "Last read of the sky: 19°C feels like, cloudy, 0% chance of rain, 11 km/h wind.",
      stamp: STAMP,
      measured: false,
    });
  });

  it("counts tonight's listings, and says one thing as one thing", () => {
    expect(tonightAnswer({ unread: false, count: 23 }, STAMP).line).toBe(
      "23 things on across London tonight.",
    );
    expect(tonightAnswer({ unread: false, count: 1 }, STAMP).line).toBe(
      "1 thing on across London tonight.",
    );
  });

  it("tells a quiet city apart from a lane it could not read", () => {
    const quiet = tonightAnswer({ unread: false, count: 0 }, STAMP);
    expect(quiet).toEqual({
      line: "The city’s having a quiet one tonight. We only list what’s really on, and nothing’s confirmed yet.",
      stamp: STAMP,
      measured: true,
    });
    const unread = tonightAnswer({ unread: true, count: 0 }, STAMP);
    expect(unread).toEqual({
      line: "We couldn't reach tonight's listings just now.",
      stamp: STAMP,
      measured: false,
    });
  });

  it("counts hyped pubs the /tonight route will show when listings are empty", () => {
    expect(tonightAnswer({ unread: false, count: 0, hypedCount: 4 }, STAMP).line).toBe(
      "4 pubs people are talking about tonight.",
    );
    expect(tonightAnswer({ unread: false, count: 0, hypedCount: 1 }, STAMP).line).toBe(
      "1 pub people are talking about tonight.",
    );
    // Listings still win when both lanes have rows.
    expect(tonightAnswer({ unread: false, count: 3, hypedCount: 4 }, STAMP).line).toBe(
      "3 things on across London tonight.",
    );
  });
});
