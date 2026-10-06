// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: null }) }));

import { MobilePlanActivation } from "@/components/plan/MobilePlanActivation";
import type { MapPlanDrinkSelection } from "@/lib/mapPlanDrinkPresentation";
import { inferNightContext } from "@/lib/nightPlanning";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const wine: MapPlanDrinkSelection = { drinkCategory: "wine", drinkBrand: "", drinkSubtype: "" };
let container: HTMLDivElement;
let root: Root;
let requests: Array<{ query?: string; context: Record<string, unknown> }>;

beforeEach(() => {
  requests = [];
  localStorage.clear();
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      requests.push(body);
      return new Response(JSON.stringify({
        stops: [{ venueId: "venue-a", venueName: "The Pub" }],
        inferredContext: { ...inferNightContext(body.query ?? "").context, ...body.context },
        planningConfidence: { level: "low", score: 0.2, routeReady: false, missingEvidence: [], warnings: [], provenance: [] },
        // A non-null amount must still never acquire a pint basis from the UI.
        budgetSummary: { basis: "selected-drink-price-unavailable", estimatedPerPersonPence: 615, totalForGroupPence: 2460, pricedStopCount: 0, unpricedStopCount: 1, budgetLimitPence: null, withinBudget: null },
        routeTotals: { stopCount: 1, straightLineWalkingKm: 0, estimatedWalkingMinutes: 0, distanceBasis: "straight-line" },
        endingRecommendations: [
          { kind: "stay", label: "Stay", reason: "One stop", preselected: true },
          { kind: "food", label: "Food", reason: "Check a menu", preselected: false },
          { kind: "home", label: "Home", reason: "Head home", preselected: false },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(null, { status: 404 });
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function render(selection = wine, query = "") {
  await act(async () => root.render(createElement(MobilePlanActivation, {
    cityId: "london", initialNightArea: "clapham", defaultDrinkSelection: selection, onGenerated: vi.fn(),
  })));
  if (query) {
    const input = container.querySelector<HTMLInputElement>("#mobile-plan-query")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, query);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
}

function button(text: string): HTMLButtonElement {
  const match = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.trim() === text);
  if (!match) throw new Error(`Missing ${text} button.`);
  return match;
}

async function generate() {
  await act(async () => button("Make a plan").click());
}

describe("map drink default in the phone planner", () => {
  it("sends the selected Wine category for a request without its own drink", async () => {
    await render(wine, "Quiet in Soho");
    await generate();
    expect(requests).toHaveLength(1);
    expect(requests[0]!.context.drinkCategory).toBe("wine");
    expect(container.querySelector(".mobilePlannerConfidence")?.textContent).toContain("Selected-drink servings are not recorded.");
    expect(container.querySelector(".mobilePlannerConfidence")?.textContent).not.toContain("one recorded pint");
  });

  it("lets an explicit Gin request override the Wine map default", async () => {
    await render(wine, "Gin in Soho");
    await generate();
    expect(requests[0]!.query).toBe("Gin in Soho");
    expect(requests[0]!.context).not.toHaveProperty("drinkCategory");
    expect(inferNightContext(requests[0]!.query).context.drinkCategory).toBe("gin");
  });

  it.each(["Soft drinks in Soho", "Coke in Soho", "Soda in Soho", "Root beer in Soho"])(
    "keeps the explicit %s category with the Alcohol-free chip",
    async (query) => {
      await render(wine, query);
      await act(async () => button("Alcohol-free").click());
      await generate();
      expect(requests).toHaveLength(1);
      expect(requests[0]!.context).toMatchObject({ drinkCategory: "soft-drink", zeroProof: true });
    },
  );

  it("does not turn a Wine request alcoholic when the Alcohol-free chip is selected", async () => {
    await render(wine, "Wine in Soho");
    await act(async () => button("Alcohol-free").click());
    await generate();
    expect(requests[0]!.context.zeroProof).toBe(true);
    expect(requests[0]!.context).not.toHaveProperty("drinkCategory");
  });

  it.each(["Sober in Soho", "No alcohol tonight"])("keeps %s ahead of the alcoholic map default", async (query) => {
    await render(wine, query);
    await generate();
    expect(requests[0]!.context).not.toHaveProperty("drinkCategory");
    expect(inferNightContext(requests[0]!.query).context.zeroProof).toBe(true);
  });

  it("lets the Alcohol-free chip override the map default", async () => {
    await render();
    await act(async () => button("Alcohol-free").click());
    await generate();
    expect(requests[0]!.context.zeroProof).toBe(true);
    expect(requests[0]!.context).not.toHaveProperty("drinkCategory");
  });

  it("refuses an unsupported brand default instead of widening it to generic Gin", async () => {
    await render({ drinkCategory: "gin", drinkBrand: "sipsmith", drinkSubtype: "" });
    await generate();
    expect(requests).toHaveLength(0);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("The planner cannot match Sipsmith yet.");
  });

  it("refuses a Top shelf Beer default instead of widening it to generic Beer", async () => {
    await render({ drinkCategory: "beer", drinkBrand: "", drinkSubtype: "", topShelfOnly: true }, "Soho");
    await generate();
    expect(requests).toHaveLength(0);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "The planner cannot match Top shelf beer yet. Turn off Top shelf on the map, or name a different drink.",
    );
  });

  it("names every selected refinement in a Top shelf brand refusal", async () => {
    await render({ drinkCategory: "beer", drinkBrand: "guinness", drinkSubtype: "", topShelfOnly: true });
    await generate();
    expect(requests).toHaveLength(0);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "The planner cannot match Top shelf Guinness yet. Turn off the brand and Top shelf on the map, or name a different drink.",
    );
  });

  it("allows an explicit Wine request to replace a Top shelf Beer default", async () => {
    await render({ drinkCategory: "beer", drinkBrand: "", drinkSubtype: "", topShelfOnly: true }, "Wine in Soho");
    await generate();
    expect(requests).toHaveLength(1);
    expect(requests[0]!.context).not.toHaveProperty("drinkCategory");
  });

  it("lets the Alcohol-free chip replace a Top shelf Beer default", async () => {
    await render({ drinkCategory: "beer", drinkBrand: "", drinkSubtype: "", topShelfOnly: true });
    await act(async () => button("Alcohol-free").click());
    await generate();
    expect(requests).toHaveLength(1);
    expect(requests[0]!.context.zeroProof).toBe(true);
  });

  it("allows an explicit Wine request to replace an unsupported Gin brand default", async () => {
    await render({ drinkCategory: "gin", drinkBrand: "sipsmith", drinkSubtype: "" }, "Wine in Soho");
    await generate();
    expect(requests).toHaveLength(1);
    expect(requests[0]!.context).not.toHaveProperty("drinkCategory");
  });

  it("keeps the Alcohol-free map default zero-proof on the next request", async () => {
    await render({ drinkCategory: "alcohol-free", drinkBrand: "", drinkSubtype: "" }, "Soho");
    await generate();
    expect(requests).toHaveLength(1);
    expect(requests[0]!.context.zeroProof).toBe(true);
    expect(requests[0]!.context).not.toHaveProperty("drinkCategory");
  });

  it("keeps an ordinary Beer map request on the original request path", async () => {
    await render({ drinkCategory: "", drinkBrand: "", drinkSubtype: "" });
    await generate();
    expect(requests[0]!.context).not.toHaveProperty("drinkCategory");
  });
});
