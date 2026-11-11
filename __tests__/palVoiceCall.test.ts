import { describe, expect, it } from "vitest";

import { palVoiceEndedHint, palVoiceMinutesLeft, palVoiceStartDisabled } from "@/lib/palVoiceCall";

// The oracle is settle_pub_pal_voice_conversation (migration 0176): a grant
// prepays 3 minutes, and settling moves the month's charge to
// used - 3 + ceil(seconds / 60), with a zero-second call free. A grant is
// admitted while the month's charge is under 30 minutes.
describe("minutes left once an ended call settles", () => {
  it.each([
    ["a 61-second call after six minutes of earlier calls", 9, 61, 22],
    ["a full three-minute call", 9, 180, 21],
    ["a call the browser clock ran a little past the cap", 9, 181.4, 21],
    ["a call that never got a word in", 9, 0, 24],
    ["a grant admitted at 29 minutes that spent 30 seconds", 32, 30, 0],
  ])("%s", (_label, usedMinutes, callSeconds, left) => {
    expect(palVoiceMinutesLeft(usedMinutes, callSeconds)).toBe(left);
  });
});

describe("the moment between an ended call and the next tap", () => {
  it("shows the minutes left only once the call has ended and nothing is starting", () => {
    const ended = { why: "cap" as const, minutesLeft: 21 };
    expect(palVoiceEndedHint(ended, true)).toContain("21");
    expect(palVoiceEndedHint(ended, false)).toBeNull();
    expect(palVoiceEndedHint({ why: "pal", minutesLeft: null }, true)).toBeNull();
    expect(palVoiceEndedHint(null, true)).toBeNull();
  });

  it("keeps Carry on off while starting and once no minutes are left", () => {
    expect(palVoiceStartDisabled(false, { why: "cap", minutesLeft: 0 })).toBe(true);
    expect(palVoiceStartDisabled(true, null)).toBe(true);
    expect(palVoiceStartDisabled(false, { why: "away", minutesLeft: 1 })).toBe(false);
    expect(palVoiceStartDisabled(false, { why: "pal", minutesLeft: null })).toBe(false);
  });
});
