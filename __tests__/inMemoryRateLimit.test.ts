import { beforeEach, describe, expect, it } from "vitest";

import { __resetPintDrops, isRateLimited } from "@/lib/pintDrops";

// LIB-S3: the in-memory fallback compares before it records, so a refused hit
// costs no stamp. A key flooded through one window gets its full budget back
// one window after its admitted hits, not one window after the flood stops.

beforeEach(() => {
  __resetPintDrops();
});

describe("in-memory rate limit", () => {
  it("refuses past the limit inside one window", () => {
    const verdicts = Array.from({ length: 5 }, (_, i) => isRateLimited("k", 1_000 + i, 3, 60_000));
    expect(verdicts).toEqual([false, false, false, true, true]);
  });

  it("does not charge refused hits, so a flood cannot extend its own lockout", () => {
    for (let t = 0; t < 3; t++) expect(isRateLimited("flood", t, 3, 60_000)).toBe(false);
    // Hammer for the rest of the window: every call is refused and uncharged.
    for (let t = 1_000; t < 59_000; t += 1_000) expect(isRateLimited("flood", t, 3, 60_000)).toBe(true);
    // The three admitted hits have left the window, so the budget is back.
    expect(isRateLimited("flood", 60_003, 3, 60_000)).toBe(false);
  });

  it("keys case-insensitively and keeps keys apart", () => {
    expect(isRateLimited("Ale", 0, 1, 60_000)).toBe(false);
    expect(isRateLimited("ale", 1, 1, 60_000)).toBe(true);
    expect(isRateLimited("stout", 2, 1, 60_000)).toBe(false);
  });
});
