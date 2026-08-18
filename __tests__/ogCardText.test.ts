import { describe, it, expect } from "vitest";

import { clampOgText, clampOgInt } from "@/lib/ogCardText";

describe("clampOgText", () => {
  it("returns the fallback for null/undefined/empty input", () => {
    expect(clampOgText(null, 10, "fallback")).toBe("fallback");
    expect(clampOgText(undefined, 10, "fallback")).toBe("fallback");
    expect(clampOgText("", 10, "fallback")).toBe("fallback");
    expect(clampOgText(null, 10)).toBe("");
  });

  it("strips control chars and DEL without touching printable text", () => {
    expect(clampOgText("a\x01b\x7fc", 10)).toBe("abc");
  });

  it("caps length with a trailing ellipsis", () => {
    expect(clampOgText("abcdefghij", 5)).toBe("abcd…");
    expect(clampOgText("abc", 5)).toBe("abc");
  });

  it("falls back when the cleaned text is empty (all control chars)", () => {
    expect(clampOgText("\x01\x02", 10, "fallback")).toBe("fallback");
  });

  it("does not collapse whitespace by default (query-param variant)", () => {
    // A single-line param never carries embedded newlines/tabs in practice,
    // but the un-collapsed default must still trim only the outer edges.
    expect(clampOgText("  a  b  ", 20)).toBe("a  b");
  });

  it("collapses whitespace after stripping control chars when collapseWhitespace is on", () => {
    // \n is a control char (<32), so it is stripped before the collapse pass
    // ever sees it — the two words end up jammed together with no space.
    // This mirrors city-map-card / plan-card / the Pint Drop card's original
    // (pre-dedup) behaviour exactly.
    expect(clampOgText("Line1\nLine2", 20, "", { collapseWhitespace: true })).toBe("Line1Line2");
    expect(clampOgText("a   b", 20, "", { collapseWhitespace: true })).toBe("a b");
  });

  it("collapses whitespace before stripping control chars when collapseBeforeFilter is on", () => {
    // The newline is replaced with a literal space BEFORE the control-char
    // filter runs, so the space survives. Mirrors the Historic Pubs card's
    // original (pre-dedup) behaviour exactly.
    expect(
      clampOgText("Line1\nLine2", 20, "", { collapseWhitespace: true, collapseBeforeFilter: true }),
    ).toBe("Line1 Line2");
  });
});

describe("clampOgInt", () => {
  it("clamps into [min, max] and rounds", () => {
    expect(clampOgInt("5.6", 0, 10, 0)).toBe(6);
    expect(clampOgInt("99", 0, 10, 0)).toBe(10);
    expect(clampOgInt("-5", 0, 10, 0)).toBe(0);
  });

  it("falls back on non-numeric input (Number(null) is 0, not non-finite)", () => {
    expect(clampOgInt("not-a-number", 0, 10, 3)).toBe(3);
    // Matches Number(null) === 0: clamps to 0, not the fallback.
    expect(clampOgInt(null, 0, 10, 3)).toBe(0);
  });
});
