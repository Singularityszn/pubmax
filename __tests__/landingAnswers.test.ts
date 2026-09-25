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
          factsLine: "19°C feels like, cloudy, 0% chance of rain, daylight.",
          verdictLine: "Beer garden weather. Lager or cider.",
          stale: false,
          checkedLabel: "Checked 1 hour ago",
        },
        STAMP,
      ),
    ).toEqual({
      line: "19°C feels like, cloudy, 0% chance of rain, daylight. Beer garden weather. Lager or cider.",
      stamp: STAMP,
      measured: true,
    });
  });

  it("says plainly when there is no reading at all", () => {
    expect(todayAnswer(null, STAMP)).toEqual({
      line: "We could not read today's London weather just now.",
      stamp: STAMP,
      measured: false,
    });
  });

  it("prints a stale sky as its facts and its age, with no verdict", () => {
    const answer = todayAnswer(
      {
        factsLine: "Last read of the sky: 19°C feels like, cloudy, 0% chance of rain, night.",
        verdictLine: "",
        stale: true,
        checkedLabel: "Last checked 2 days ago",
      },
      STAMP,
    );
    expect(answer).toEqual({
      line: "Last read of the sky: 19°C feels like, cloudy, 0% chance of rain, night. Last checked 2 days ago.",
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
