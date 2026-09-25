import { describe, expect, it } from "vitest";

import { todayAnswer, tonightAnswer } from "@/lib/landingAnswers";

// The two cards under the picture answer the captain's own two questions:
// "What is happening today? What is happening tonight?" Each is one sentence
// with the London day stamped on it, and a lane nobody could read says so
// rather than printing a number.

const STAMP = "Sunday 7 September";

describe("the front door's two answers", () => {
  it("says what today is, from the weather read", () => {
    expect(
      todayAnswer(
        {
          tempLabel: "19C",
          conditionLabel: "cloudy",
          verdictLine: "Beer garden weather. Lager or cider.",
          stale: false,
        },
        STAMP,
      ),
    ).toEqual({
      line: "19C and cloudy in London. Beer garden weather. Lager or cider.",
      stamp: STAMP,
      measured: true,
    });
  });

  it("refuses a stale sky and a missing one alike", () => {
    for (const weather of [
      null,
      { tempLabel: "19C", conditionLabel: "cloudy", verdictLine: "x", stale: true },
    ]) {
      const answer = todayAnswer(weather, STAMP);
      expect(answer.measured).toBe(false);
      expect(answer.line).toBe("We could not read today's London weather just now.");
      expect(answer.stamp).toBe(STAMP);
    }
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
      line: "We could not reach tonight's listings just now.",
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
