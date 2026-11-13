import { describe, expect, it } from "vitest";

import { londonDayKey, londonDayLabel } from "@/lib/londonHour";

const longDate = (timeZone: string, at: Date): string =>
  new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone,
  }).format(at);

describe("londonDayLabel", () => {
  it("uses the Europe/London day, including the minute after midnight", () => {
    // 23:30 UTC on 15 July 2026 is 00:30 the next morning in London (BST).
    const justAfterLondonMidnight = new Date("2026-07-15T23:30:00.000Z");
    expect(londonDayKey(justAfterLondonMidnight)).toBe("2026-07-16");
    expect(londonDayLabel(justAfterLondonMidnight)).toBe("Thursday 16 July");
    expect(longDate("UTC", justAfterLondonMidnight)).toBe("Wednesday 15 July");
    expect(longDate("America/New_York", justAfterLondonMidnight)).toBe("Wednesday 15 July");

    expect(londonDayLabel(new Date("2026-07-15T22:59:00.000Z"))).toBe("Wednesday 15 July");

    // The held homepage: 00:12 in London is Friday, and New York is still Thursday.
    const fridayMorning = new Date("2026-11-13T00:12:00.000Z");
    expect(londonDayLabel(fridayMorning)).toBe("Friday 13 November");
    expect(longDate("America/New_York", fridayMorning)).toBe("Thursday 12 November");
    expect(londonDayLabel(new Date("2026-11-12T23:59:00.000Z"))).toBe("Thursday 12 November");
  });
});
