import { describe, expect, it } from "vitest";

import { palVoiceEndedHint, palVoiceEndedWithUsage, palVoiceMinutesLeft, palVoiceFaceState, palVoiceSecondsLeft, palVoiceWrapUpUpdate } from "@/lib/palVoiceCall";

describe("the prepaid balance required by the operator's conservative allowance decision", () => {
  it.each([
    ["a prepaid call after six minutes of earlier calls", 9, 21],
    ["the monthly allowance is fully prepaid", 30, 0],
    ["a grant admitted at 29 minutes", 32, 0],
  ])("%s", (_label, usedMinutes, left) => {
    expect(palVoiceMinutesLeft(usedMinutes)).toBe(left);
  });
});

describe("the kept allowance follows the latest prepaid grant", () => {
  it.each(["cap", "away", "pal"] as const)("refreshes usage without replacing the %s end reason", (why) => {
    const ended = { why, minutesLeft: 21 };
    expect(palVoiceEndedWithUsage(ended, 12)).toEqual({ why, minutesLeft: 18 });
    expect(palVoiceEndedWithUsage(ended, null)).toEqual({ why, minutesLeft: null });
    expect(ended).toEqual({ why, minutesLeft: 21 });
  });

  it("does not create an ended call when a fresh start receives a grant", () => {
    expect(palVoiceEndedWithUsage(null, 12)).toBeNull();
  });
});

describe("the warning and countdown use the connected call's cap deadline", () => {
  it.each([
    [150_000, 30],
    [160_000, 20],
    [179_001, 1],
    [180_000, 0],
    [185_000, 0],
  ])("reports %s elapsed milliseconds as %s seconds left in a three-minute call", (now, seconds) => {
    expect(palVoiceSecondsLeft(180_000, now)).toBe(seconds);
    expect(palVoiceWrapUpUpdate(180_000, now)).toBe(
      `About ${seconds} seconds are left in this call. Finish the answer in one short sentence.`,
    );
  });
});

describe("the moment between an ended call and the next tap", () => {
  it("shows the minutes left only once the call has ended and nothing is starting", () => {
    const ended = { why: "cap" as const, minutesLeft: 21 };
    expect(palVoiceEndedHint(ended, true)).toBe("At least 21 minutes of voice left this month");
    expect(palVoiceEndedHint({ why: "pal", minutesLeft: 0 }, true)).toBe("At least 0 minutes of voice left this month");
    expect(palVoiceEndedHint({ why: "away", minutesLeft: 1 }, true)).toBe("At least 1 minute of voice left this month");
    expect(palVoiceEndedHint(ended, false)).toBeNull();
    expect(palVoiceEndedHint({ why: "pal", minutesLeft: null }, true)).toBeNull();
    expect(palVoiceEndedHint(null, true)).toBeNull();
  });
});

describe("the voice portrait follows the call's visible activity", () => {
  it.each([
    [true, false, false, false, "noticing"],
    [false, false, true, true, "idle"],
    [false, true, true, true, "speaking"],
    [false, true, false, true, "thinking"],
    [false, true, false, false, "listening"],
  ] as const)("maps activity %s/%s/%s/%s to %s", (starting, live, speaking, awaitingPal, expected) => {
    expect(palVoiceFaceState(starting, live, speaking, awaitingPal)).toBe(expected);
  });
});
