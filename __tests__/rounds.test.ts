import { describe, expect, it } from "vitest";

import {
  ROUND_CODE_ALPHABET,
  ROUND_CODE_LENGTH,
  cleanNewRound,
  cleanNewStop,
  generateRoundCode,
  isValidRoundCode,
  normalizeRoundCode,
} from "@/lib/rounds";

describe("generateRoundCode — shape + alphabet", () => {
  const CHARSET = new Set(ROUND_CODE_ALPHABET.split(""));

  it("produces a code of the canonical length from the allowed alphabet", () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generateRoundCode();
      expect(code).toHaveLength(ROUND_CODE_LENGTH);
      for (const ch of code) expect(CHARSET.has(ch)).toBe(true);
    }
  });

  it("uses an unambiguous alphabet — no vowels, no O/0/I/1/L", () => {
    for (const banned of ["A", "E", "I", "O", "U", "0", "1", "L"]) {
      expect(ROUND_CODE_ALPHABET).not.toContain(banned);
    }
  });

  it("does not always return the same code (is actually random)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i += 1) seen.add(generateRoundCode());
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("normalizeRoundCode / isValidRoundCode — trust boundary", () => {
  it("uppercases + strips non-alphabet characters", () => {
    expect(normalizeRoundCode(" jxkq7m ")).toBe("JXKQ7M");
    expect(normalizeRoundCode("jxkq-7m")).toBe("JXKQ7M");
  });

  it("caps to the canonical length", () => {
    expect(normalizeRoundCode("JXKQ7MEXTRA")).toHaveLength(ROUND_CODE_LENGTH);
  });

  it("rejects non-strings and short codes", () => {
    expect(isValidRoundCode(null)).toBe(false);
    expect(isValidRoundCode(undefined)).toBe(false);
    expect(isValidRoundCode("")).toBe(false);
    expect(isValidRoundCode("ABC")).toBe(false);
  });

  it("a generated code is always valid", () => {
    for (let i = 0; i < 50; i += 1) expect(isValidRoundCode(generateRoundCode())).toBe(true);
  });
});

describe("cleanNewRound — validation", () => {
  it("requires a creator handle", () => {
    expect(cleanNewRound({ title: "Big night", createdByHandle: "" })).toBeNull();
    expect(cleanNewRound({ title: "Big night" })).toBeNull();
  });

  it("normalises the handle and defaults a blank title", () => {
    const round = cleanNewRound({ title: "   ", createdByHandle: " @Ken " });
    expect(round).not.toBeNull();
    expect(round!.createdByHandle).toBe("ken");
    expect(round!.title).toBe("Tonight's Round");
  });

  it("cleans a title (strips angle brackets)", () => {
    const round = cleanNewRound({ title: "Ken's <b>crawl</b>", createdByHandle: "ken" });
    expect(round!.title).toBe("Ken's bcrawl/b");
  });
});

describe("cleanNewStop — validation", () => {
  it("requires venue id, venue name, and adder handle", () => {
    expect(cleanNewStop({ venueName: "The Ship", addedByHandle: "ken" })).toBeNull();
    expect(cleanNewStop({ venueId: "venue-1", addedByHandle: "ken" })).toBeNull();
    expect(cleanNewStop({ venueId: "venue-1", venueName: "The Ship" })).toBeNull();
  });

  it("accepts a valid stop and normalises the handle", () => {
    const stop = cleanNewStop({ venueId: "venue-1", venueName: "The Ship", addedByHandle: "@Ken" });
    expect(stop).toEqual({ venueId: "venue-1", venueName: "The Ship", addedByHandle: "ken" });
  });

  it("carries an optional drop_ref (the builds-itself seam)", () => {
    const stop = cleanNewStop({
      venueId: "venue-1",
      venueName: "The Ship",
      addedByHandle: "ken",
      dropRef: "drop-42",
    });
    expect(stop!.dropRef).toBe("drop-42");
  });
});
