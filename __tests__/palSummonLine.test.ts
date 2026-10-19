import { describe, expect, it } from "vitest";

import { palSummonLine } from "@/lib/palSummonLine";

const base = { muted: false, nightOnStop: null, nightKept: false };

describe("the summon chip's line", () => {
  it("follows the hour, and says get home safe after midnight", () => {
    expect(palSummonLine({ ...base, hour: 2 })).toBe("Late one. Get home safe");
    expect(palSummonLine({ ...base, hour: 9 })).toBe("Morning. Tap to plan tonight");
    expect(palSummonLine({ ...base, hour: 14 })).toBe("Tap to talk or plan");
    expect(palSummonLine({ ...base, hour: 20 })).toBe("Where to tonight?");
  });

  it("names the stop the person reached on a night that is on", () => {
    expect(palSummonLine({ ...base, hour: 22, nightOnStop: 1 })).toBe("Night's on. Stop 2");
    expect(palSummonLine({ ...base, hour: 1, nightOnStop: 0 })).toBe("Night's on. Stop 1");
  });

  it("greets a kept night in the morning only", () => {
    expect(palSummonLine({ ...base, hour: 9, nightKept: true })).toBe("Morning. Last night's kept");
    expect(palSummonLine({ ...base, hour: 15, nightKept: true })).toBe("Tap to talk or plan");
  });

  it("stays quiet for a muted Pal", () => {
    expect(palSummonLine({ ...base, hour: 20, muted: true, nightOnStop: 2 })).toBe("Muted");
  });

  it("follows the house voice: no exclamation marks, no em dashes, no drink pressure", () => {
    for (let hour = 0; hour < 24; hour += 1) {
      for (const state of [base, { ...base, nightKept: true }, { ...base, nightOnStop: 3 }]) {
        const line = palSummonLine({ ...state, hour });
        expect(line).not.toMatch(/[!—]/);
        expect(line).not.toMatch(/\b(another|one more|drink up|round)\b/i);
      }
    }
  });
});
