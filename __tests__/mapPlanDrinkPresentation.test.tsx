// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    createElement("a", { ...props, href }, children),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ user: null, session: null, loading: false, identityResolved: true, getCurrentUserId: () => null }),
}));

import RoutePanel from "@/components/map/RoutePanel";
import type { MapPlanDrinkSelection } from "@/lib/mapPlanDrinkPresentation";
import type { MapLensPrice } from "@/lib/mapExperienceLens";
import type { Venue } from "@/lib/venues";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const duke = {
  id: "venue-149rmv7", name: "Duke of York", address: "London", latitude: 51.5, longitude: -0.12,
  cheapestPrice: 6.15, cheapestPint: "AMSTEL", primaryBorough: "Westminster", visibleBoroughs: ["Westminster"],
  curation: { nearWater: false, writerPick: false }, hasStory: false,
} as Venue;
const dove = { ...duke, id: "venue-dove", name: "The Dove", latitude: 51.51 };
const unpricedDuke = { ...duke, cheapestPrice: null, cheapestPint: "" } as Venue;
const unpricedDove = { ...dove, cheapestPrice: null, cheapestPint: "" } as Venue;
const wine: MapPlanDrinkSelection = { drinkCategory: "wine", drinkSubtype: "", drinkBrand: "" };
const wineQuote: MapLensPrice = {
  venueId: duke.id, category: "wine", categoryLabel: "Wine", priceGbp: 5.5,
  submittedAt: Date.parse("2026-09-25T18:00:00.000Z"), source: "community",
};

let container: HTMLDivElement;
let root: Root;
const props = {
  mode: "build" as const, crawlStyle: "balanced" as const, altStyle: "pint" as const,
  onAltStyleChange: vi.fn(), route: [duke], filteredVenues: [duke, dove], builtIds: [duke.id],
  activeVenueId: duke.id, venueSignals: new Map(), routeMapped: false, poisPath: null,
  onMapRoute: vi.fn(), onHideRoute: vi.fn(), onSelectVenue: vi.fn(), onToggleStop: vi.fn(),
};

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render(overrides: Partial<React.ComponentProps<typeof RoutePanel>> = {}) {
  await act(async () => root.render(createElement(RoutePanel, { ...props, ...overrides })));
}

function button(text: string): HTMLButtonElement {
  const match = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.trim() === text);
  if (!match) throw new Error(`Missing ${text} button.`);
  return match;
}

describe("Beer round total price coverage", () => {
  it("labels a partial amount as a known subtotal and names its coverage", async () => {
    await render({ route: [duke, unpricedDove] });
    const total = container.querySelector(".routeMetrics > div");
    expect(total?.querySelector("span")?.textContent).toBe("£6.15");
    expect(total?.querySelector("small")?.textContent).toBe(
      "known subtotal · 1 of 2 stops priced",
    );
  });

  it("shows no round total when no stop has a recorded price", async () => {
    await render({ route: [unpricedDuke, unpricedDove] });
    const total = container.querySelector(".routeMetrics > div");
    expect(total?.querySelector("span")?.textContent).toBe("Not recorded");
    expect(total?.querySelector("small")?.textContent).toBe("round total");
  });

  it("keeps the estimated round label when every stop has a price", async () => {
    await render({ route: [duke, dove] });
    const total = container.querySelector(".routeMetrics > div");
    expect(total?.querySelector("span")?.textContent).toBe("£12.30");
    expect(total?.querySelector("small")?.textContent).toBe("estimated round");
  });
});

describe("selected-drink hand-built Plan", () => {
  it("shows Wine with unknown total instead of the Duke's AMSTEL pint", async () => {
    await render({ drinkSelection: wine, drinkPriceStatus: "ready" });
    expect(container.querySelector("h2")?.textContent).toBe("Wine plan");
    expect(container.querySelector('[data-testid="alt-style-picker"]')).toBeNull();
    expect(container.querySelector(".routeMetrics")?.textContent).toContain("Not recordedround total");
    expect(container.querySelector(".routeMetrics")?.textContent).toContain("1wine stop");
    expect(container.querySelector(".routeList")?.textContent).toContain("no wine price logged");
    expect(container.querySelector(".routeList")?.textContent).not.toMatch(/AMSTEL|£6\.15/);
    expect(container.querySelector(".venuePickerList")?.textContent).not.toContain("£6.15");
  });

  it("keeps a matching report's source, day and unknown serving without summing it", async () => {
    await render({ drinkSelection: wine, drinkPrices: new Map([[duke.id, wineQuote]]), drinkPriceStatus: "ready" });
    expect(container.querySelector(".routeList")?.textContent).toContain("Wine £5.50, community report 25 Sept 2026. Serving size not recorded.");
    expect(container.querySelector(".routeMetrics")?.textContent).toContain("Not recorded");
    expect(container.querySelector(".venuePickerList")?.textContent).toContain("Serving size not recorded.");
  });

  it.each([
    { ...wine, drinkBrand: "rioja" },
    { ...wine, drinkSubtype: "wine-red" },
    { drinkCategory: "beer", drinkSubtype: "beer-cider", drinkBrand: "" },
    { drinkCategory: "beer", drinkSubtype: "", drinkBrand: "", topShelfOnly: true },
  ])("does not borrow category or pint money for a refined choice %j", async (selection) => {
    await render({ drinkSelection: selection, drinkPrices: new Map([[duke.id, wineQuote]]), drinkPriceStatus: "ready" });
    expect(container.querySelector(".routeMetrics")?.textContent).toContain("Not recorded");
    expect(container.querySelector(".routeList")?.textContent).not.toMatch(/£5\.50|£6\.15|AMSTEL/);
    expect(container.querySelector(".venuePickerList")?.textContent).not.toMatch(/£5\.50|£6\.15/);
  });

  it("names a Top shelf Beer plan without its pint money, totals or story entry", async () => {
    await render({
      drinkSelection: { drinkCategory: "beer", drinkSubtype: "", drinkBrand: "", topShelfOnly: true },
      route: [duke, dove], drinkPriceStatus: "ready",
    });
    expect(container.querySelector("h2")?.textContent).toBe("Top shelf beer plan");
    expect(container.querySelector(".routeMetrics")?.textContent).toContain("Not recordedround total");
    expect(container.querySelector(".routeMetrics")?.textContent).toContain("2top shelf beer stops");
    expect(container.querySelector(".routeList")?.textContent).toContain("Top shelf beer price unknown here. Ask at the bar.");
    expect(container.textContent).not.toMatch(/AMSTEL|£6\.15|£12\.30/);
    expect(Array.from(container.querySelectorAll("button")).some((item) => item.textContent?.includes("Save as story"))).toBe(false);
  });

  it.each([
    [{ drinkCategory: "beer", drinkSubtype: "beer-stout", drinkBrand: "", topShelfOnly: true }, "Top shelf stout plan", "top shelf stout stops"],
    [{ drinkCategory: "beer", drinkSubtype: "beer-ipa", drinkBrand: "", topShelfOnly: true }, "Top shelf IPA plan", "top shelf IPA stops"],
    [{ drinkCategory: "beer", drinkSubtype: "", drinkBrand: "guinness", topShelfOnly: true }, "Top shelf Guinness plan", "top shelf Guinness stops"],
    [{ drinkCategory: "beer", drinkSubtype: "", drinkBrand: "guinness" }, "Guinness plan", "Guinness stops"],
    [{ drinkCategory: "wine", drinkSubtype: "wine-red", drinkBrand: "" }, "Red wine plan", "red wine stops"],
    [{ drinkCategory: "gin", drinkSubtype: "gin-london-dry", drinkBrand: "" }, "London dry gin plan", "London dry gin stops"],
    [{ drinkCategory: "gin", drinkSubtype: "gin-old-tom", drinkBrand: "", topShelfOnly: true }, "Top shelf Old Tom gin plan", "top shelf Old Tom gin stops"],
    [{ drinkCategory: "whisky", drinkSubtype: "whisky-irish", drinkBrand: "" }, "Irish whiskey plan", "Irish whiskey stops"],
    [{ drinkCategory: "whisky", drinkSubtype: "whisky-japanese", drinkBrand: "", topShelfOnly: true }, "Top shelf Japanese whisky plan", "top shelf Japanese whisky stops"],
    [{ drinkCategory: "whisky", drinkSubtype: "whisky-scotch", drinkBrand: "" }, "Scotch whisky plan", "Scotch whisky stops"],
    [{ drinkCategory: "whisky", drinkSubtype: "whisky-rye", drinkBrand: "" }, "Rye whiskey plan", "rye whiskey stops"],
    [{ drinkCategory: "soft-drink", drinkSubtype: "soft-drink-diet-coke", drinkBrand: "" }, "Diet Coke plan", "Diet Coke stops"],
    [{ drinkCategory: "soft-drink", drinkSubtype: "soft-drink-pepsi-max", drinkBrand: "", topShelfOnly: true }, "Top shelf Pepsi Max plan", "top shelf Pepsi Max stops"],
  ] as const)("keeps sentence case and brand names in %j", async (selection, title, stops) => {
    await render({ drinkSelection: selection, route: [duke, dove] });
    expect(container.querySelector("h2")?.textContent).toBe(title);
    expect(container.querySelector(".routeMetrics")?.textContent).toContain(`2${stops}`);
  });

  it.each(["ready", "partial", "degraded", "idle"] as const)(
    "does not claim a refined Guinness price is absent when the %s category index was never its evidence",
    async (status) => {
      await render({ drinkSelection: { drinkCategory: "beer", drinkSubtype: "", drinkBrand: "guinness" }, drinkPriceStatus: status });
      expect(container.querySelector(".routeList")?.textContent).toContain("Guinness price unknown here. Ask at the bar.");
      expect(container.querySelector(".venuePickerList")?.textContent).toContain("Guinness price unknown here. Ask at the bar.");
      expect(container.textContent).not.toMatch(/no Guinness price|Guinness price could not be read|Guinness price not read yet|Guinness prices/);
    },
  );

  it.each([
    { ...wineQuote, category: "gin" as const },
    { ...wineQuote, venueId: dove.id },
    { ...wineQuote, source: "sourced-anchor" as const },
    { ...wineQuote, submittedAt: undefined },
  ])("rejects a report without matching category, venue, source and day", async (quote) => {
    await render({ drinkSelection: wine, drinkPrices: new Map([[duke.id, quote]]), drinkPriceStatus: "ready" });
    expect(container.querySelector(".routeList")?.textContent).not.toContain("£5.50");
  });

  it("distinguishes a failed read from absent prices", async () => {
    await render({ drinkSelection: wine, drinkPriceStatus: "degraded" });
    expect(container.querySelector(".routeList")?.textContent).toContain("wine price could not be read");
    expect(container.textContent).not.toContain("no wine price logged");
  });

  it("still names the selected drink when a curated route has its own title", async () => {
    await render({ drinkSelection: wine, crawlName: "The riverside route" });
    expect(container.querySelector(".routeHeader")?.textContent).toContain("Wine stops");
  });

  it("keeps the stops while changing lanes and restores the original Beer presentation", async () => {
    await render({ drinkSelection: wine, route: [duke, dove] });
    await render({ drinkSelection: { drinkCategory: "gin", drinkSubtype: "", drinkBrand: "" }, route: [duke, dove] });
    expect(container.querySelector("h2")?.textContent).toBe("Gin plan");
    expect(container.querySelectorAll(".routeList li")).toHaveLength(2);
    await render({ drinkSelection: { drinkCategory: "", drinkSubtype: "", drinkBrand: "" }, route: [duke, dove] });
    expect(container.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toBe("Pint");
    expect(container.querySelector(".routeList")?.textContent).toContain("£6.15 · AMSTEL");
    expect(container.querySelector(".routeMetrics")?.textContent).toContain("£12.30");
  });

  it("keeps Add, Remove and Reverse controls connected", async () => {
    const reverse = vi.fn();
    await render({ drinkSelection: wine, route: [duke, dove], onReverseRoute: reverse });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.venuePickerList button[aria-pressed="true"]')!.click();
      container.querySelector<HTMLButtonElement>('.venuePickerList button[aria-pressed="false"]')!.click();
      button("Reverse route").click();
    });
    expect(props.onToggleStop.mock.calls.map(([id]) => id)).toEqual([duke.id, dove.id]);
    expect(reverse).toHaveBeenCalledOnce();
  });

  it("keeps Beer stories but withholds story entry when the reader would lose drink context and unknown totals", async () => {
    await render({ route: [duke, dove] });
    expect(button("Save as story")).toBeTruthy();
    await render({ drinkSelection: wine, route: [duke, dove] });
    expect(Array.from(container.querySelectorAll("button")).some((item) => item.textContent?.includes("Save as story"))).toBe(false);
    await render({ drinkSelection: { drinkCategory: "beer", drinkBrand: "guinness", drinkSubtype: "" }, route: [duke, dove] });
    expect(Array.from(container.querySelectorAll("button")).some((item) => item.textContent?.includes("Save as story"))).toBe(false);
  });
});
