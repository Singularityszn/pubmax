import { describe, expect, it } from "vitest";

import { palVoiceMinutesLeft } from "@/lib/palVoiceCall";

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
