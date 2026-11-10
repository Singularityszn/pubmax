import { afterEach, describe, expect, it } from "vitest";

import {
  PAL_MAP_MAX_PICKS,
  applyPalMapCommand,
  groundPalMapResult,
  readPalMapState,
  resetPalMap,
  subscribePalMapState,
  type PalMapPick,
} from "@/lib/palMapCommands";

const pick = (venueId: string, number = 1): PalMapPick => ({ venueId, name: `Pub ${venueId}`, lat: 51.5, lng: -0.1, number });

afterEach(() => resetPalMap());

describe("Pal picks on the main map", () => {
  it("shows the grounded pubs as numbered picks, in answer order", () => {
    groundPalMapResult(["a", "b", "c"]);
    expect(applyPalMapCommand({ kind: "showPicks", picks: [pick("c", 9), pick("a", 9)] })).toBe(true);
    expect(readPalMapState().picks.map((item) => [item.number, item.venueId])).toEqual([[1, "c"], [2, "a"]]);
  });

  it("refuses a pub the grounded result never named, and keeps the picks it had", () => {
    groundPalMapResult(["a", "b"]);
    applyPalMapCommand({ kind: "showPicks", picks: [pick("a")] });
    const before = readPalMapState();
    expect(applyPalMapCommand({ kind: "showPicks", picks: [pick("a"), pick("invented")] })).toBe(false);
    expect(readPalMapState()).toBe(before);
  });

  it("refuses every pick before any result is grounded", () => {
    expect(applyPalMapCommand({ kind: "showPicks", picks: [pick("a")] })).toBe(false);
    expect(readPalMapState().picks).toEqual([]);
  });

  it("forgets the old grounded set when a new result lands", () => {
    groundPalMapResult(["a"]);
    groundPalMapResult(["b"]);
    expect(applyPalMapCommand({ kind: "showPicks", picks: [pick("a")] })).toBe(false);
    expect(applyPalMapCommand({ kind: "showPicks", picks: [pick("b")] })).toBe(true);
  });

  it("refuses a repeated pub", () => {
    groundPalMapResult(["a"]);
    expect(applyPalMapCommand({ kind: "showPicks", picks: [pick("a"), pick("a")] })).toBe(false);
  });

  it("clears picks when the latest result has no plottable venues", () => {
    groundPalMapResult(["a"]);
    applyPalMapCommand({ kind: "showPicks", picks: [pick("a")] });
    expect(applyPalMapCommand({ kind: "showPicks", picks: [] })).toBe(true);
    expect(readPalMapState().picks).toEqual([]);
  });

  it("removes retired grounding and renumbers surviving picks", () => {
    groundPalMapResult(["a", "b"]);
    applyPalMapCommand({ kind: "showPicks", picks: [pick("a"), pick("b")] });
    groundPalMapResult(["b"]);
    expect(readPalMapState().picks).toEqual([pick("b")]);
    groundPalMapResult([]);
    expect(readPalMapState().picks).toEqual([]);
  });

  it(`shows at most ${PAL_MAP_MAX_PICKS} picks`, () => {
    const ids = Array.from({ length: PAL_MAP_MAX_PICKS + 2 }, (_, index) => `v${index}`);
    groundPalMapResult(ids);
    expect(applyPalMapCommand({ kind: "showPicks", picks: ids.map((id) => pick(id)) })).toBe(true);
    expect(readPalMapState().picks).toHaveLength(PAL_MAP_MAX_PICKS);
  });

  it("focuses the pick being named without starting a new answer, and refuses a number not on the map", () => {
    groundPalMapResult(["a", "b"]);
    applyPalMapCommand({ kind: "showPicks", picks: [pick("a"), pick("b")] });
    const { sequence } = readPalMapState();
    expect(applyPalMapCommand({ kind: "focusPick", number: 2 })).toBe(true);
    expect(readPalMapState()).toMatchObject({ sequence, focused: 2 });
    expect(applyPalMapCommand({ kind: "focusPick", number: 3 })).toBe(false);
    expect(readPalMapState().focused).toBe(2);
    expect(applyPalMapCommand({ kind: "focusPick", number: null })).toBe(true);
    expect(readPalMapState().focused).toBeNull();
  });

  it("drops the focus when the picks change", () => {
    groundPalMapResult(["a", "b"]);
    applyPalMapCommand({ kind: "showPicks", picks: [pick("a"), pick("b")] });
    applyPalMapCommand({ kind: "focusPick", number: 2 });
    groundPalMapResult(["a"]);
    expect(readPalMapState().focused).toBeNull();
  });

  it("announces each repeated spoken cue without reframing the picks", () => {
    groundPalMapResult(["a"]);
    applyPalMapCommand({ kind: "showPicks", picks: [pick("a")] });
    const { sequence } = readPalMapState();
    const focused: (number | null)[] = [];
    const unsubscribe = subscribePalMapState(() => focused.push(readPalMapState().focused));
    applyPalMapCommand({ kind: "focusPick", number: 1 });
    applyPalMapCommand({ kind: "focusPick", number: 1 });
    unsubscribe();
    expect(focused).toEqual([1, 1]);
    expect(readPalMapState().sequence).toBe(sequence);
  });

  it("clears the picks and the grounded set when the call is over", () => {
    groundPalMapResult(["a"]);
    applyPalMapCommand({ kind: "showPicks", picks: [pick("a")] });
    let heard = 0;
    const unsubscribe = subscribePalMapState(() => { heard += 1; });
    resetPalMap();
    unsubscribe();
    expect(heard).toBe(1);
    expect(readPalMapState().picks).toEqual([]);
    expect(applyPalMapCommand({ kind: "showPicks", picks: [pick("a")] })).toBe(false);
  });
});
