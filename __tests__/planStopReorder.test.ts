import { describe, expect, it } from "vitest";

import { dropIndex, moveItem, reorderShifts, type StopSlot } from "@/lib/planStopReorder";

// Three cards, 100px tall with a 12px gap: tops 0, 112, 224.
const SLOTS: StopSlot[] = [
  { top: 0, height: 100 },
  { top: 112, height: 100 },
  { top: 224, height: 100 },
];

describe("dragging a stop card", () => {
  it("settles in the slot its middle is over", () => {
    expect(dropIndex(SLOTS, 2, 0)).toBe(2);
    expect(dropIndex(SLOTS, 2, -130)).toBe(1);
    expect(dropIndex(SLOTS, 2, -230)).toBe(0);
    expect(dropIndex(SLOTS, 0, 500)).toBe(2);
    expect(dropIndex(SLOTS, 0, -500)).toBe(0);
  });

  it("moves every card exactly as far as the dragged one is tall", () => {
    // Card 2 goes to the top: cards 0 and 1 each move down one card and a gap.
    expect(reorderShifts(SLOTS, 2, 0)).toEqual([112, 112, -224]);
    expect(reorderShifts(SLOTS, 0, 2)).toEqual([224, -112, -112]);
    expect(reorderShifts(SLOTS, 1, 1)).toEqual([0, 0, 0]);
  });

  it("measures cards of different heights instead of assuming one", () => {
    const tall: StopSlot[] = [
      { top: 0, height: 100 },
      { top: 112, height: 140 },
      { top: 264, height: 100 },
    ];
    // Moving the 100px card past the 140px card moves the tall one up by 112
    // and the small one down by 152.
    expect(reorderShifts(tall, 0, 1)).toEqual([152, -112, 0]);
  });

  it("moves an item without touching the input", () => {
    const input = ["a", "b", "c"];
    expect(moveItem(input, 2, 0)).toEqual(["c", "a", "b"]);
    expect(input).toEqual(["a", "b", "c"]);
    expect(moveItem(input, 1, 1)).toEqual(["a", "b", "c"]);
    expect(moveItem(input, 0, 9)).toEqual(["a", "b", "c"]);
  });
});
