// The geometry of dragging one Stop card to a new place in the route. Pure and
// measured: it works from the cards' own rectangles, so a card that grew a
// second line (a drink price) moves exactly as far as it is tall.

export type StopSlot = { top: number; height: number };

/** The gap between cards, read from the layout rather than typed. */
function gapBetween(slots: readonly StopSlot[]): number {
  if (slots.length < 2) return 0;
  const first = slots[0]!;
  const last = slots[slots.length - 1]!;
  const heights = slots.reduce((total, slot) => total + slot.height, 0);
  return Math.max(0, (last.top + last.height - first.top - heights) / (slots.length - 1));
}

/** The slot a card dragged `dy` pixels would settle in. Its middle decides. */
export function dropIndex(slots: readonly StopSlot[], from: number, dy: number): number {
  const dragged = slots[from];
  if (!dragged) return from;
  const middle = dragged.top + dragged.height / 2 + dy;
  // The card's place is how many of the OTHER cards its middle has passed.
  let passed = 0;
  for (let index = 0; index < slots.length; index += 1) {
    if (index === from) continue;
    const slot = slots[index]!;
    if (middle > slot.top + slot.height / 2) passed += 1;
  }
  return Math.min(slots.length - 1, Math.max(0, passed));
}

/** Where every card sits once `from` has moved to `to`: pixels from its own place. */
export function reorderShifts(slots: readonly StopSlot[], from: number, to: number): number[] {
  const gap = gapBetween(slots);
  const order = slots.map((_, index) => index);
  order.splice(from, 1);
  order.splice(to, 0, from);
  const origin = slots[0]?.top ?? 0;
  const shifts = new Array<number>(slots.length).fill(0);
  let cursor = origin;
  for (const index of order) {
    const slot = slots[index]!;
    shifts[index] = cursor - slot.top;
    cursor += slot.height + gap;
  }
  return shifts;
}

/** The same list with one item moved. Never mutates its input. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) {
    return [...items];
  }
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as T);
  return next;
}
