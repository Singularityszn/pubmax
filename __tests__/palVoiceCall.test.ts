import { describe, expect, it } from "vitest";

import { palVoiceEndedHint, palVoiceMinutesLeft, palVoiceFaceState } from "@/lib/palVoiceCall";

describe("the prepaid balance required by the operator's conservative allowance decision", () => {
  it.each([
    ["a prepaid call after six minutes of earlier calls", 9, 21],
    ["the monthly allowance is fully prepaid", 30, 0],
    ["a grant admitted at 29 minutes", 32, 0],
  ])("%s", (_label, usedMinutes, left) => {
    expect(palVoiceMinutesLeft(usedMinutes)).toBe(left);
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
