import { describe, expect, it } from "vitest";

import { cleanText, isHttpUrl, readString } from "@/lib/textClean";

describe("readString", () => {
  it("returns non-empty strings unchanged (no trim on return value)", () => {
    expect(readString("  hello  ")).toBe("  hello  ");
  });

  it("returns undefined for blank or non-string values", () => {
    expect(readString("")).toBeUndefined();
    expect(readString("   ")).toBeUndefined();
    expect(readString(null)).toBeUndefined();
    expect(readString(42)).toBeUndefined();
  });
});

describe("cleanText", () => {
  it("strips angle brackets used for inline HTML", () => {
    expect(cleanText("<script>alert(1)</script>", 200)).toBe("scriptalert(1)/script");
  });

  it("replaces ASCII control characters with spaces", () => {
    expect(cleanText("hello\u0000world\u0007", 200)).toBe("hello world");
    expect(cleanText("tab\there", 200)).toBe("tab here");
    expect(cleanText("del\u007fend", 200)).toBe("del end");
  });

  it("collapses whitespace and caps length", () => {
    expect(cleanText("  too   many   spaces  ", 200)).toBe("too many spaces");
    expect(cleanText("abcdefghij", 5)).toBe("abcde");
  });

  it("returns empty string for non-string input", () => {
    expect(cleanText(undefined, 100)).toBe("");
    expect(cleanText(123, 100)).toBe("");
  });
});

// Battle-test defect D03. The cap used to be `.slice(0, cap)`, which counts
// UTF-16 code units, so any astral character straddling the boundary was cut in
// half and left a lone surrogate. That is not valid UTF-8, so Postgres refused
// the write and `POST /api/plans` answered 503 for a legitimate 40-character
// name. Every case below is a name a person can actually type.
describe("cleanText \u2014 cap boundary", () => {
  const A39 = "a".repeat(39);
  const BEER = "\u{1F37A}";
  const UK_FLAG = "\u{1F1EC}\u{1F1E7}";
  const ZWJ = "\u200D";
  const FAMILY = `\u{1F468}${ZWJ}\u{1F469}${ZWJ}\u{1F467}`;
  const COMBINING_ACUTE = "\u0301";

  /** What Postgres counts for `char_length(...)`, and what a lone surrogate breaks. */
  function codePoints(value: string): number {
    return [...value].length;
  }

  function hasLoneSurrogate(value: string): boolean {
    // TextEncoder replaces an unpaired surrogate with U+FFFD, so a value that
    // does not survive the round trip is one a UTF-8 column will refuse.
    return new TextDecoder().decode(new TextEncoder().encode(value)) !== value;
  }

  it("keeps an emoji whole when it lands exactly on the cap", () => {
    const out = cleanText(`${A39}${BEER}`, 40);
    expect(out).toBe(`${A39}${BEER}`);
    expect(codePoints(out)).toBe(40);
    expect(hasLoneSurrogate(out)).toBe(false);
  });

  it("drops an emoji whole rather than splitting its surrogate pair", () => {
    const out = cleanText(`${A39}${BEER}`, 39);
    expect(out).toBe(A39);
    expect(hasLoneSurrogate(out)).toBe(false);
  });

  it("never splits a regional-indicator flag", () => {
    // Two code points, so 39 letters plus a flag is 41 and cannot fit in 40.
    const out = cleanText(`${A39}${UK_FLAG}`, 40);
    expect(out).toBe(A39);
    expect(hasLoneSurrogate(out)).toBe(false);
  });

  it("never splits a ZWJ sequence", () => {
    const out = cleanText(`${A39}${FAMILY}`, 40);
    expect(out).toBe(A39);
    expect(out).not.toContain(ZWJ);
    expect(hasLoneSurrogate(out)).toBe(false);
  });

  it("keeps a combining mark with the letter it belongs to", () => {
    const out = cleanText(`${"a".repeat(38)}e${COMBINING_ACUTE}`, 39);
    expect(out).toBe("a".repeat(38));
    expect(out).not.toContain(COMBINING_ACUTE);
  });

  it("caps by code point, the unit the database counts", () => {
    // 40 flags are 40 graphemes but 80 code points. A grapheme cap would send
    // all 80 to a `char_length(name) between 1 and 40` column and 500 again.
    const out = cleanText(UK_FLAG.repeat(40), 40);
    expect(codePoints(out)).toBe(40);
    expect(out).toBe(UK_FLAG.repeat(20));
  });

  it("emits no lone surrogate at any cap across an all-emoji name", () => {
    const name = BEER.repeat(30);
    for (let cap = 1; cap <= 60; cap += 1) {
      const out = cleanText(name, cap);
      expect(hasLoneSurrogate(out)).toBe(false);
      expect(codePoints(out)).toBeLessThanOrEqual(cap);
    }
  });

  it("leaves plain text and the under-cap fast path exactly as before", () => {
    expect(cleanText("abcdefghij", 5)).toBe("abcde");
    expect(cleanText("short", 40)).toBe("short");
    expect(cleanText(`${A39}${BEER}`, 0)).toBe("");
  });
});

describe("isHttpUrl", () => {
  it("accepts well-formed http(s) URLs within the cap", () => {
    expect(isHttpUrl("https://example.com/avatar.png", 200)).toBe(
      "https://example.com/avatar.png",
    );
    expect(isHttpUrl(" http://localhost:3000/x ", 200)).toBe("http://localhost:3000/x");
  });

  it("rejects javascript: and data: schemes", () => {
    expect(isHttpUrl("javascript:alert(1)", 200)).toBeUndefined();
    expect(isHttpUrl("data:text/html,hello", 200)).toBeUndefined();
  });

  it("rejects malformed, empty, or over-long values", () => {
    expect(isHttpUrl("", 200)).toBeUndefined();
    expect(isHttpUrl("not-a-url", 200)).toBeUndefined();
    expect(isHttpUrl("https://example.com", 10)).toBeUndefined();
    expect(isHttpUrl(null, 200)).toBeUndefined();
  });
});
