// A radiogroup keeps one option in the tab order, so the arrow keys are the
// only way to the others. Day | Tonight and the /out day chips both took the
// roving tabIndex without this half, which left Tonight, Tomorrow and Weekend
// unreachable by keyboard entirely.

import { describe, expect, it } from "vitest";

import { nextRovingIndex } from "@/lib/rovingRadioGroup";

describe("roving focus inside a radiogroup", () => {
  it("walks forward and wraps", () => {
    expect(nextRovingIndex("ArrowRight", 0, 3)).toBe(1);
    expect(nextRovingIndex("ArrowDown", 1, 3)).toBe(2);
    expect(nextRovingIndex("ArrowRight", 2, 3)).toBe(0);
  });

  it("walks back and wraps", () => {
    expect(nextRovingIndex("ArrowLeft", 2, 3)).toBe(1);
    expect(nextRovingIndex("ArrowUp", 1, 3)).toBe(0);
    expect(nextRovingIndex("ArrowLeft", 0, 3)).toBe(2);
  });

  it("jumps to the ends", () => {
    expect(nextRovingIndex("Home", 2, 3)).toBe(0);
    expect(nextRovingIndex("End", 0, 3)).toBe(2);
  });

  it("claims no other key, so Tab and Enter keep their meaning", () => {
    expect(nextRovingIndex("Tab", 0, 3)).toBeNull();
    expect(nextRovingIndex("Enter", 0, 3)).toBeNull();
    expect(nextRovingIndex(" ", 0, 3)).toBeNull();
  });

  it("answers nothing when the event did not come from an option", () => {
    expect(nextRovingIndex("ArrowRight", -1, 3)).toBeNull();
    expect(nextRovingIndex("ArrowRight", 3, 3)).toBeNull();
    expect(nextRovingIndex("ArrowRight", 0, 0)).toBeNull();
  });
});
