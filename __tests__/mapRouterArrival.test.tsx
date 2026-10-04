// @vitest-environment jsdom

import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useMapPlanCoordinator } from "@/components/map/pubmap/useMapPlanCoordinator";
import { routeDrinkIntentFromSearch } from "@/lib/crawlUrl";
import { buildMapSeed } from "@/lib/pubMap";

const router = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(router.search),
}));
vi.mock("@/lib/mapWarmup", () => ({
  warmCityMapFirstPaint: vi.fn(),
  warmMapFirstPaint: vi.fn(),
}));

// The expensive dynamic map is the boundary double. Its arrival consumption
// uses the real decoder and coordinator; canvas/network are outside this test.
function MapBoundary({ incomingSearch }: { incomingSearch?: string }) {
  const [search] = useState(() => incomingSearch ?? window.location.search);
  const [seed] = useState(() => buildMapSeed(search, "london"));
  const plan = useMapPlanCoordinator({
    mode: seed.mode,
    builtIds: seed.builtIds,
    routeMapped: seed.routeMapped,
    routeDrinkIntent: routeDrinkIntentFromSearch(search),
    planningOpen: false,
    nightArea: null,
  });
  return createElement("section", null,
    createElement("output", { "data-testid": "route" }, JSON.stringify({
      mode: plan.mode,
      ids: plan.builtIds,
      context: plan.generatedPricing?.context ?? null,
      budget: plan.generatedPricing?.budget ?? null,
      quotes: plan.generatedPricing?.quotes.size ?? 0,
    })),
    createElement("button", { onClick: plan.reverseBuiltIds }, "Reverse"),
    createElement("button", { onClick: () => plan.replaceBuiltIds([]) }, "Clear"),
  );
}
vi.mock("next/dynamic", () => ({ default: () => MapBoundary }));

import PubMaxingShell from "@/components/PubMaxingShell";

let container: HTMLDivElement;
let root: Root;
const ids = ["venue-5fcgge", "venue-1etf22r", "venue-l5qye7"];
const publicRoute = `mode=build&pubs=${ids.join(",")}`;

function route() {
  const raw = container.querySelector('[data-testid="route"]')?.textContent;
  if (!raw) throw new Error("Map route boundary did not render");
  return JSON.parse(raw) as {
    mode: string; ids: string[];
    context: { drinkCategory?: string | null; zeroProof?: boolean } | null;
    budget: unknown; quotes: number;
  };
}
async function renderShell() {
  await act(async () => { root.render(createElement(PubMaxingShell)); });
}
async function click(name: string) {
  const button = [...container.querySelectorAll("button")].find((node) => node.textContent === name);
  if (!button) throw new Error(`Missing native boundary action: ${name}`);
  await act(async () => { button.click(); });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState(null, "", "/plan/saved-plan#share");
  window.localStorage.clear();
  window.sessionStorage.clear();
  router.search = "";
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.clearAllMocks();
});

describe("Map arrival belongs to canonical router search", () => {
  it.each([
    { intent: "routeDrink=wine", context: { drinkCategory: "wine", zeroProof: false } },
    { intent: "routeLow=1", context: { zeroProof: true } },
  ])("receives $intent while physical history still holds the departing Plan", async ({ intent, context }) => {
    router.search = `${publicRoute}&${intent}`;
    await renderShell();
    expect(window.location.pathname).toBe("/plan/saved-plan");
    expect(route()).toEqual({ mode: "build", ids, context, budget: null, quotes: 0 });
  });

  it("honors an empty router query while physical history still holds a public Wine route", async () => {
    const physicalSearch = `${publicRoute}&routeDrink=wine`;
    window.history.replaceState(null, "", `/map?${physicalSearch}`);
    router.search = "";
    await renderShell();
    expect(window.location.search).toBe(`?${physicalSearch}`);
    expect(route()).toEqual({ mode: "suggest", ids: [], context: null, budget: null, quotes: 0 });
  });

  it("keeps reverse and Clear local when router props subsequently reflect URL changes", async () => {
    router.search = `${publicRoute}&routeDrink=wine`;
    window.history.replaceState(null, "", `/map?${router.search}`);
    await renderShell();
    await click("Reverse");
    expect(route().ids).toEqual([...ids].reverse());
    expect(route().context).toEqual({ drinkCategory: "wine", zeroProof: false });
    await renderShell();
    expect(route().ids).toEqual([...ids].reverse());
    await click("Clear");
    router.search = "mode=build";
    await renderShell();
    expect(route()).toEqual({ mode: "build", ids: [], context: null, budget: null, quotes: 0 });
    // A parent rerender carrying the old query cannot revive cleared authority.
    router.search = `${publicRoute}&routeDrink=wine`;
    await renderShell();
    expect(route()).toEqual({ mode: "build", ids: [], context: null, budget: null, quotes: 0 });
  });

  it.each(["", publicRoute, `${publicRoute}&drink=wine`])(
    "preserves generic/Pint arrivals and independent map lenses: %s", async (search) => {
      router.search = search;
      window.history.replaceState(null, "", `/map${search ? `?${search}` : ""}`);
      await renderShell();
      expect(route()).toEqual({
        mode: search ? "build" : "suggest", ids: search ? ids : [],
        context: null, budget: null, quotes: 0,
      });
    },
  );
});
