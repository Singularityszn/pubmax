import { describe, expect, it } from "vitest";

import { safeNext } from "@/app/auth/callback/route";

const ORIGIN = "https://pubmaxxing.com";

describe("safeNext (auth callback open-redirect guard)", () => {
  it("allows same-origin absolute paths", () => {
    expect(safeNext("/", ORIGIN)).toBe("/");
    expect(safeNext("/map", ORIGIN)).toBe("/map");
    expect(safeNext("/u/ken?tab=drops", ORIGIN)).toBe("/u/ken?tab=drops");
    expect(safeNext("/feed#top", ORIGIN)).toBe("/feed#top");
  });

  it("rejects protocol-relative URLs", () => {
    expect(safeNext("//evil.com", ORIGIN)).toBe("/");
    expect(safeNext("//evil.com/phish", ORIGIN)).toBe("/");
  });

  it("rejects backslash host overrides that WHATWG would resolve off-origin", () => {
    // Encoded `\`: URLSearchParams yields "/\\evil.com"; new URL would → https://evil.com/
    expect(safeNext("/\\evil.com", ORIGIN)).toBe("/");
    expect(safeNext("/\\\\evil.com", ORIGIN)).toBe("/");
    expect(safeNext("/\\evil.com/steal", ORIGIN)).toBe("/");
  });

  it("rejects absolute and non-path values", () => {
    expect(safeNext("https://evil.com", ORIGIN)).toBe("/");
    expect(safeNext("evil.com", ORIGIN)).toBe("/");
    expect(safeNext("", ORIGIN)).toBe("/");
    expect(safeNext(null, ORIGIN)).toBe("/");
  });
});
