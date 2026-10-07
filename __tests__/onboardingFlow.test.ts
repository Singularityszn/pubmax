import { describe, expect, it } from "vitest";

import { webOnboardingStartRequested } from "@/lib/firstRunRoute";
import { pricedWithinWalk, type NearMeCard, type PricedPoint } from "@/lib/nearMeAnswer";
import {
  BUDGET_CHOICES,
  ONBOARDING_STEPS,
  budgetCeiling,
  isBudgetChoiceId,
  nextOnboardingStep,
  onboardingResult,
  onboardingStepNumber,
  previousOnboardingStep,
  clearPlannerHandoff,
  desktopHandoffMoves,
  readBudgetChoice,
  readPlannerHandoff,
  writeBudgetChoice,
  writePlannerHandoff,
} from "@/lib/onboardingFlow";

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, value),
  };
}

const card = (id: string, price: number): NearMeCard => ({
  id,
  name: `Pub ${id}`,
  borough: "Westminster",
  cheapestPrice: price,
  distanceKm: 0.3,
  walkMinutes: 4,
});

describe("the journey's steps", () => {
  it("runs london, budget, location, result, companion, in that order", () => {
    expect([...ONBOARDING_STEPS]).toEqual(["london", "budget", "location", "result", "companion"]);
  });

  it("walks forward and back and stops at both ends", () => {
    expect(nextOnboardingStep("london")).toBe("budget");
    expect(nextOnboardingStep("companion")).toBeNull();
    expect(previousOnboardingStep("budget")).toBe("london");
    expect(previousOnboardingStep("london")).toBeNull();
  });

  it("numbers a step from one", () => {
    expect(onboardingStepNumber("london")).toBe(1);
    expect(onboardingStepNumber("companion")).toBe(ONBOARDING_STEPS.length);
  });
});

describe("the budget answer", () => {
  it("names a ceiling for every choice and none for no limit", () => {
    expect(BUDGET_CHOICES.map((choice) => budgetCeiling(choice.id))).toEqual([5, 6, 7, null]);
  });

  it("round-trips through storage and refuses a value nobody offered", () => {
    const storage = memoryStorage();
    expect(readBudgetChoice(storage)).toBeNull();
    writeBudgetChoice("seven", storage);
    expect(readBudgetChoice(storage)).toBe("seven");
    expect(readBudgetChoice(memoryStorage({ "pubmax:onboarding:budget:v1": "ten-quid" }))).toBeNull();
    expect(isBudgetChoiceId("ten-quid")).toBe(false);
  });

  it("degrades to unanswered when storage throws", () => {
    const blocked = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    expect(readBudgetChoice(blocked)).toBeNull();
    expect(() => writeBudgetChoice("five", blocked)).not.toThrow();
  });
});

describe("the result", () => {
  const cards = [card("a", 4.9), card("b", 5.5), card("c", 5.9), card("d", 6.4)];

  it("leads with the cheapest and keeps two more", () => {
    const result = onboardingResult(cards, "six", false, [4.9, 5.5, 5.9, 6.4, 8]);
    expect(result.best?.id).toBe("a");
    expect(result.others.map((other) => other.id)).toEqual(["b", "c"]);
  });

  it("counts the whole walk against the budget, not just the cards on screen", () => {
    const prices = [4.9, 5.5, 5.9, 6.4, 5.1, 5.2, 5.3, 7.9];
    expect(onboardingResult(cards, "six", false, prices).withinBudget).toBe(6);
    expect(onboardingResult(cards, "five", false, prices).withinBudget).toBe(1);
  });

  it("counts a price exactly at the ceiling as inside it", () => {
    expect(onboardingResult(cards, "six", false, [6, 6.01]).withinBudget).toBe(1);
  });

  it("makes no count when there is no limit or nothing answered", () => {
    expect(onboardingResult(cards, "any", false, [4.9]).withinBudget).toBeNull();
    expect(onboardingResult(cards, null, false, [4.9]).withinBudget).toBeNull();
    const empty = onboardingResult([], "six", false, []);
    expect(empty.best).toBeNull();
    expect(empty.others).toEqual([]);
  });

  it("keeps the widened flag the ranker set", () => {
    expect(onboardingResult(cards, "six", true, []).widened).toBe(true);
  });
});

describe("pricedWithinWalk", () => {
  const at = (lat: number, lng: number, price: number | null, extra: Partial<PricedPoint> = {}): PricedPoint => ({
    id: `${lat}-${lng}`,
    name: "Pub",
    lat,
    lng,
    cheapestPrice: price,
    borough: "Westminster",
    ...extra,
  });

  it("keeps priced pubs inside the ring and drops the far and the unpriced", () => {
    const here = { lat: 51.5136, lng: -0.1365 };
    const prices = pricedWithinWalk(here.lat, here.lng, [
      at(51.514, -0.137, 5),
      at(51.5136, -0.1365, 6.2),
      at(51.55, -0.1365, 4), // about 4 km away
      at(51.5137, -0.1366, null),
    ]);
    expect(prices.sort()).toEqual([5, 6.2]);
  });
});

describe("the web start mark", () => {
  it("is read from the query and nothing else", () => {
    expect(webOnboardingStartRequested("?start=web")).toBe(true);
    expect(webOnboardingStartRequested("")).toBe(false);
    expect(webOnboardingStartRequested("?start=1")).toBe(false);
    expect(webOnboardingStartRequested("?utm_source=poster")).toBe(false);
  });
});

describe("the planner handoff", () => {
  it("round-trips a patch and a budget", () => {
    const storage = memoryStorage();
    writePlannerHandoff({ patch: { lat: 51.5136, lng: -0.1365 }, budget: "five" }, storage, 1000);
    expect(readPlannerHandoff(storage, 2000)).toEqual({
      patch: { lat: 51.5136, lng: -0.1365 },
      budget: "five",
    });
  });

  it("drops a handoff the planner never opened for", () => {
    const storage = memoryStorage();
    writePlannerHandoff({ patch: null, budget: "six" }, storage, 0);
    expect(readPlannerHandoff(storage, 11 * 60_000)).toBeNull();
  });

  it("reads garbage, a bad budget and a bad patch as nothing", () => {
    expect(readPlannerHandoff(memoryStorage({ "pubmax:onboarding:planner-handoff:v1": "{" }))).toBeNull();
    const storage = memoryStorage({
      "pubmax:onboarding:planner-handoff:v1": JSON.stringify({ patch: { lat: "x", lng: 1 }, budget: "ten", at: 5 }),
    });
    expect(readPlannerHandoff(storage, 6)).toEqual({ patch: null, budget: null });
  });

  it("clears once read", () => {
    const storage = memoryStorage();
    writePlannerHandoff({ patch: null, budget: "any" }, storage, 1);
    clearPlannerHandoff(storage);
    expect(readPlannerHandoff(storage, 2)).toBeNull();
  });
});

describe("the desktop handoff", () => {
  it("turns the budget into the pint cap and the patch into the camera", () => {
    expect(desktopHandoffMoves({ patch: { lat: 51.5136, lng: -0.1365 }, budget: "five" })).toEqual({
      maxPrice: 5,
      center: [-0.1365, 51.5136],
    });
  });

  it("moves nothing the journey did not give", () => {
    expect(desktopHandoffMoves({ patch: null, budget: "any" })).toEqual({ maxPrice: null, center: null });
    expect(desktopHandoffMoves({ patch: null, budget: null })).toEqual({ maxPrice: null, center: null });
  });
});
