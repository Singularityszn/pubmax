import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MAP_FIRST_VISIT_ARRIVAL_KEY,
  dismissMapFirstVisitArrival,
  hasDismissedMapFirstVisitArrival,
  mapFirstVisitArrivalBlocksConsent,
  searchHasPlanHandoffParams,
  searchSuppressesMapFirstVisitArrival,
  setMapFirstVisitArrivalCardVisible,
  shouldShowMapFirstVisitArrival,
} from "@/lib/mapFirstVisitArrival";
import {
  claimPromptBudget,
  hasPromptBudgetFor,
  locationAllowsInterruptivePrompt,
} from "@/lib/promptBudget";

function makeMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
  };
}

afterEach(() => {
  vi.useRealTimers();
  setMapFirstVisitArrivalCardVisible(false);
});

describe("mapFirstVisitArrival", () => {
  it("shows only after pins reveal and only once per device", () => {
    const storage = makeMemoryStorage();
    expect(
      shouldShowMapFirstVisitArrival({
        pinsRevealed: false,
        search: "",
        storage,
      }),
    ).toBe(false);
    expect(
      shouldShowMapFirstVisitArrival({
        pinsRevealed: true,
        search: "",
        storage,
      }),
    ).toBe(true);
    dismissMapFirstVisitArrival(storage);
    expect(hasDismissedMapFirstVisitArrival(storage)).toBe(true);
    expect(
      shouldShowMapFirstVisitArrival({
        pinsRevealed: true,
        search: "",
        storage,
      }),
    ).toBe(false);
    expect(storage.getItem(MAP_FIRST_VISIT_ARRIVAL_KEY)).toMatch(/^dismissed:\d+$/);
  });

  describe("the 30 day quiet window", () => {
    const DAY = 24 * 60 * 60 * 1000;
    const answeredAt = Date.UTC(2026, 9, 1, 12);

    it("holds for 30 days after any answer, then lets the ask be made once more", () => {
      vi.useFakeTimers();
      vi.setSystemTime(answeredAt + 29 * DAY);
      const storage = makeMemoryStorage();
      dismissMapFirstVisitArrival(storage, answeredAt);
      expect(storage.getItem(MAP_FIRST_VISIT_ARRIVAL_KEY)).toBe(`dismissed:${answeredAt}`);
      expect(hasDismissedMapFirstVisitArrival(storage, answeredAt + 29 * DAY)).toBe(true);
      expect(hasDismissedMapFirstVisitArrival(storage, answeredAt + 30 * DAY)).toBe(false);
      expect(
        shouldShowMapFirstVisitArrival({
          pinsRevealed: true,
          search: "",
          storage,
        }),
      ).toBe(false);
      vi.setSystemTime(answeredAt + 30 * DAY);
      expect(shouldShowMapFirstVisitArrival({ pinsRevealed: true, search: "", storage })).toBe(true);
    });

    it("never expires the bare value every earlier build wrote", () => {
      const storage = makeMemoryStorage();
      storage.setItem(MAP_FIRST_VISIT_ARRIVAL_KEY, "dismissed");
      expect(hasDismissedMapFirstVisitArrival(storage, answeredAt + 400 * DAY)).toBe(true);
    });

    it("reads an unreadable date as answered, never as a reason to ask again", () => {
      const storage = makeMemoryStorage();
      storage.setItem(MAP_FIRST_VISIT_ARRIVAL_KEY, "dismissed:soon");
      expect(hasDismissedMapFirstVisitArrival(storage, answeredAt)).toBe(true);
    });

    it("treats a date in the future as inside the window", () => {
      const storage = makeMemoryStorage();
      dismissMapFirstVisitArrival(storage, answeredAt + 5 * DAY);
      expect(hasDismissedMapFirstVisitArrival(storage, answeredAt)).toBe(true);
    });
  });

  it("stands down while a recovery toast owns the surface, and returns after", () => {
    const storage = makeMemoryStorage();
    // The map keeps search plus ONE toast. This card is 256px of opaque panel
    // over the toast's own band, so a failure the reader can act on wins.
    expect(
      shouldShowMapFirstVisitArrival({
        pinsRevealed: true,
        search: "",
        recoveryToastActive: true,
        storage,
      }),
    ).toBe(false);
    // Withheld, never dismissed: the visit is still a first one.
    expect(hasDismissedMapFirstVisitArrival(storage)).toBe(false);
    expect(
      shouldShowMapFirstVisitArrival({
        pinsRevealed: true,
        search: "",
        recoveryToastActive: false,
        storage,
      }),
    ).toBe(true);
  });

  it("suppresses for planner handoff and explicit map intent", () => {
    const storage = makeMemoryStorage();
    expect(searchHasPlanHandoffParams("?query=quiet+in+clapham")).toBe(true);
    expect(searchHasPlanHandoffParams("?occasion=date-night")).toBe(true);
    expect(searchHasPlanHandoffParams("?describe=riverside")).toBe(true);
    expect(searchSuppressesMapFirstVisitArrival("?sel=venue-1")).toBe(true);
    expect(
      shouldShowMapFirstVisitArrival({
        pinsRevealed: true,
        search: "?query=quiet+in+clapham",
        storage,
      }),
    ).toBe(false);
  });

  it("blocks analytics consent while the card is visible", () => {
    const session = makeMemoryStorage();
    const consent = makeMemoryStorage();
    expect(locationAllowsInterruptivePrompt()).toBe(true);
    expect(hasPromptBudgetFor("analytics-consent", session, consent)).toBe(true);
    setMapFirstVisitArrivalCardVisible(true);
    expect(mapFirstVisitArrivalBlocksConsent()).toBe(true);
    expect(locationAllowsInterruptivePrompt()).toBe(false);
    expect(hasPromptBudgetFor("analytics-consent", session, consent)).toBe(
      false,
    );
    expect(claimPromptBudget("analytics-consent", session, consent)).toBe(false);
    setMapFirstVisitArrivalCardVisible(false);
    expect(locationAllowsInterruptivePrompt()).toBe(true);
    expect(claimPromptBudget("analytics-consent", session, consent)).toBe(true);
  });
});
