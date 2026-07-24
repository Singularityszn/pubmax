import { describe, expect, it } from "vitest";
import {
  FIRST_RUN_COMPANIONS,
  TOUR_PROMPT_SURFACE,
  claimTourPromptBudget,
  isFirstRunCompanion,
  readFirstRunCompanion,
  releaseTourPromptBudget,
  resetFirstRunCompanion,
  tourHasPromptBudget,
  writeFirstRunCompanion,
} from "@/lib/firstRunTour";
import { claimPromptBudget, hasPromptBudgetFor, promptBudgetHolder } from "@/lib/promptBudget";

import {
  hasDedicatedOnboarding,
  isTourEligiblePathname,
  shouldShowFirstRunTour,
} from "@/lib/firstRunTour";

describe("isTourEligiblePathname", () => {
  it("is eligible on /map and any /map/[city] surface", () => {
    expect(isTourEligiblePathname("/map")).toBe(true);
    expect(isTourEligiblePathname("/map/london")).toBe(true);
    expect(isTourEligiblePathname("/map/new-york")).toBe(true);
  });

  it("is not eligible on landing, tonight, feed, pint-index, or other content pages", () => {
    expect(isTourEligiblePathname("/")).toBe(false);
    expect(isTourEligiblePathname("/tonight")).toBe(false);
    expect(isTourEligiblePathname("/feed")).toBe(false);
    expect(isTourEligiblePathname("/pint-index")).toBe(false);
    expect(isTourEligiblePathname("/discover")).toBe(false);
    expect(isTourEligiblePathname("/mapping")).toBe(false);
  });
});

describe("hasDedicatedOnboarding", () => {
  it("flags Pub Pal and profile surfaces", () => {
    expect(hasDedicatedOnboarding("/pal")).toBe(true);
    expect(hasDedicatedOnboarding("/u/somehandle")).toBe(true);
  });

  it("does not flag map or other surfaces", () => {
    expect(hasDedicatedOnboarding("/map")).toBe(false);
    expect(hasDedicatedOnboarding("/")).toBe(false);
  });
});

describe("shouldShowFirstRunTour", () => {
  const base = { mounted: true, seen: false, pathname: "/map" };

  it("shows once mounted, unseen, and on a map surface", () => {
    expect(shouldShowFirstRunTour(base)).toBe(true);
    expect(shouldShowFirstRunTour({ ...base, pathname: "/map/london" })).toBe(true);
  });

  it("never shows before mount (SSR-safe gate)", () => {
    expect(shouldShowFirstRunTour({ ...base, mounted: false })).toBe(false);
  });

  it("never shows once seen (at most once per device)", () => {
    expect(shouldShowFirstRunTour({ ...base, seen: true })).toBe(false);
  });

  it("never shows off the map surfaces — landing, tonight, feed, pint-index", () => {
    expect(shouldShowFirstRunTour({ ...base, pathname: "/" })).toBe(false);
    expect(shouldShowFirstRunTour({ ...base, pathname: "/tonight" })).toBe(false);
    expect(shouldShowFirstRunTour({ ...base, pathname: "/feed" })).toBe(false);
    expect(shouldShowFirstRunTour({ ...base, pathname: "/pint-index" })).toBe(false);
  });

  it("stands down for an explicit/restored Map arrival (§4.7) without marking seen", () => {
    // A deep-linked or restored Map arrival suppresses the tour for THIS arrival.
    expect(shouldShowFirstRunTour({ ...base, explicitIntent: true })).toBe(false);
    // Suppression is per-arrival: a later clean Map open (no intent) is eligible.
    expect(shouldShowFirstRunTour({ ...base, explicitIntent: false })).toBe(true);
    expect(shouldShowFirstRunTour(base)).toBe(true); // default is not intent
  });

  it("never shows over Pub Pal or You's dedicated onboarding, even on their own routes", () => {
    expect(shouldShowFirstRunTour({ ...base, pathname: "/pal" })).toBe(false);
    expect(shouldShowFirstRunTour({ ...base, pathname: "/u/somehandle" })).toBe(false);
  });
});

// ── Ported from the orchestration PR (#323): budget adoption coverage ──
// In-memory Storage for the ported budget-adoption suite (same idiom as
// promptBudget.test.ts — the budget participation is pure and injectable).
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

describe("first-run tour — prompt budget adoption", () => {
  it("uses the canonical 'first-run-tour' surface id", () => {
    expect(TOUR_PROMPT_SURFACE).toBe("first-run-tour");
  });

  it("may show when the session budget is free", () => {
    const s = makeMemoryStorage();
    expect(tourHasPromptBudget(s)).toBe(true);
  });

  it("claims the budget at the moment it shows", () => {
    const s = makeMemoryStorage();
    expect(claimTourPromptBudget(s)).toBe(true);
    expect(promptBudgetHolder(s)).toBe("first-run-tour");
    // Idempotent for the tour's own re-render.
    expect(claimTourPromptBudget(s)).toBe(true);
    expect(tourHasPromptBudget(s)).toBe(true);
  });

  it("defers to a sibling surface that already claimed the session", () => {
    const s = makeMemoryStorage();
    // A2HS (or identity/push) got there first this session.
    expect(claimPromptBudget("a2hs", s)).toBe(true);
    // The tour must not interrupt.
    expect(tourHasPromptBudget(s)).toBe(false);
    expect(claimTourPromptBudget(s)).toBe(false);
    // The sibling keeps the budget.
    expect(promptBudgetHolder(s)).toBe("a2hs");
  });

  it("blocks siblings once the tour has claimed the session", () => {
    const s = makeMemoryStorage();
    expect(claimTourPromptBudget(s)).toBe(true);
    // No other surface may show this session.
    expect(hasPromptBudgetFor("a2hs", s)).toBe(false);
    expect(hasPromptBudgetFor("identity-nudge", s)).toBe(false);
    expect(claimPromptBudget("native-push", s)).toBe(false);
  });

  it("degrades open when storage is unavailable (best-effort, never blocks)", () => {
    // No injected storage and no window → resolveStorage returns null.
    expect(tourHasPromptBudget()).toBe(true);
    expect(claimTourPromptBudget()).toBe(true);
  });

  it("releases only its own hold for the explicit Plan handoff", () => {
    const s = makeMemoryStorage();
    expect(claimTourPromptBudget(s)).toBe(true);
    releaseTourPromptBudget(s);
    expect(promptBudgetHolder(s)).toBeNull();
    expect(claimPromptBudget("native-push", s)).toBe(true);

    const sibling = makeMemoryStorage();
    expect(claimPromptBudget("identity-nudge", sibling)).toBe(true);
    releaseTourPromptBudget(sibling);
    expect(promptBudgetHolder(sibling)).toBe("identity-nudge");
  });
});

describe("first-run companion preference", () => {
  it("offers the six launch companions with stable ids", () => {
    expect(FIRST_RUN_COMPANIONS.map((choice) => choice.id)).toEqual([
      "greyhound",
      "cat",
      "fox",
      "pigeon",
      "badger",
      "corgi",
    ]);
  });

  it("persists one valid choice and rejects unknown stored values", () => {
    const s = makeMemoryStorage();
    expect(readFirstRunCompanion(s)).toBeNull();
    writeFirstRunCompanion("pigeon", s);
    expect(readFirstRunCompanion(s)).toBe("pigeon");
    expect(isFirstRunCompanion("pigeon")).toBe(true);
    expect(isFirstRunCompanion("robot")).toBe(false);

    s.setItem("pubmax:first-run-companion:v1", "robot");
    expect(readFirstRunCompanion(s)).toBeNull();
    resetFirstRunCompanion(s);
    expect(s.length).toBe(0);
  });
});
