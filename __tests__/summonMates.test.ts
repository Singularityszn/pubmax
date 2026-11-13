import { describe, expect, it } from "vitest";

import {
  defaultSummonTime,
  formatSummonTime,
  parseSummonTime,
  summonSentLine,
  summonTimeFromSearch,
  venueSummonUrl,
} from "@/lib/summonMates";

describe("summon time", () => {
  it("accepts a 24-hour HH:MM and nothing else", () => {
    expect(parseSummonTime("20:30")).toBe("20:30");
    expect(parseSummonTime(" 07:05 ")).toBe("07:05");
    for (const bad of ["24:00", "8pm", "8:30", "20:60", "", null, 2030]) {
      expect(parseSummonTime(bad)).toBeNull();
    }
  });

  it("says the time the way a mate would", () => {
    expect(formatSummonTime("20:00")).toBe("8pm");
    expect(formatSummonTime("20:30")).toBe("8:30pm");
    expect(formatSummonTime("12:00")).toBe("12pm");
    expect(formatSummonTime("00:15")).toBe("12:15am");
  });

  it("suggests the next quarter hour at least 30 minutes away, on London's clock", () => {
    // 18:50 BST is 17:50 UTC: 19:20 rounds up to 19:30.
    expect(defaultSummonTime(new Date("2026-07-01T17:50:00Z"))).toBe("19:30");
    // 23:40 GMT wraps past midnight.
    expect(defaultSummonTime(new Date("2026-11-12T23:40:00Z"))).toBe("00:15");
  });
});

describe("summon link", () => {
  it("puts the time beside the city-aware pub link", () => {
    expect(venueSummonUrl("pub with spaces&x", "20:00")).toBe("/map?sel=pub%20with%20spaces%26x&meet=20%3A00");
    expect(venueSummonUrl("venue-mcr-1lwo5lo", "19:30")).toBe("/map/manchester?sel=venue-mcr-1lwo5lo&meet=19%3A30");
  });

  it("names a time only for the pub it was made for", () => {
    const search = new URL(venueSummonUrl("pub-a", "20:00"), "https://pubmaxxing.com").search;
    expect(summonTimeFromSearch(search, "pub-a")).toBe("20:00");
    expect(summonTimeFromSearch(search, "pub-b")).toBeNull();
    expect(summonTimeFromSearch("?sel=pub-a&meet=late", "pub-a")).toBeNull();
  });
});

describe("summon receipt", () => {
  it("names exactly the mates it reached", () => {
    expect(summonSentLine(["ann"])).toBe("Sent to @ann. They'll find it in Messages.");
    expect(summonSentLine(["ann", "bo", "cy"])).toBe("Sent to @ann, @bo and @cy. They'll find it in Messages.");
  });
});
