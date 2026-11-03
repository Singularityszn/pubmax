// @vitest-environment jsdom

// Pal hops (wild idea 08) on a page: the gate, the button, and what the robin
// says once it lands. The map's two probes (painted pins and the camera) are
// stood in on `window` exactly as the canvas publishes them, the city's slim
// pack read and the pub's record are mocked, and reduced motion lands the
// robin straight away, so the answer itself is what is tested.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SlimVenue } from "@/lib/venuesSlim";
import { WILD_MODE_STORAGE_KEY } from "@/lib/wildMode";

const slim = vi.hoisted(() => ({ rows: [] as SlimVenue[], status: "ready" as "ready" | "unavailable" }));

vi.mock("@/lib/slimShards", () => ({
  createSlimShardLoader: () => ({
    initialResult: async () => ({ rows: slim.rows, status: slim.status }),
  }),
}));

vi.mock("@/lib/warmVenueDetail", () => ({
  warmVenueDetail: async (id: string) =>
    id === "venue-b"
      ? { status: "found", venue: { id, cheapestPrice: 4.2, cheapestPint: "Camden Hells" } }
      : { status: "missing" },
}));

import PalHop from "@/components/wild/PalHop";
import PalHopGate from "@/components/wild/PalHopGate";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type ProbeWindow = Window & {
  __pubmaxPaintedMapTapPoints?: () => unknown[];
  __pubmaxMapCamera?: unknown;
};

/** A flat camera: 20,000 px a degree, so the test can read where pubs are drawn. */
const toScreen = ([lng, lat]: [number, number]) => ({ x: (lng + 0.14) * 20_000, y: (51.52 - lat) * 20_000 });

function pub(id: string, price: number | null, lng: number, lat: number): SlimVenue {
  return {
    id,
    name: `The ${id.slice(6).toUpperCase()}`,
    lat,
    lng,
    cheapestPrice: price,
    borough: "Westminster",
    priceSource: "Pint Prices",
    priceObservedAt: "2026-10-02",
  };
}

const ROWS = [
  pub("venue-a", 5.2, -0.13, 51.512),
  pub("venue-b", 4.2, -0.125, 51.505),
  pub("venue-c", 6.1, -0.12, 51.51),
  pub("venue-d", null, -0.122, 51.507),
  // Drawn far off to the right of the screen, so never "in view".
  pub("venue-e", 2.5, -0.05, 51.51),
];

function stubProbes(): void {
  const probe = window as ProbeWindow;
  probe.__pubmaxMapCamera = {
    read: () => ({ center: [-0.1335, 51.5131], zoom: 15, pitch: 0, bearing: 0, moving: false, settling: false }),
    project: toScreen,
  };
  probe.__pubmaxPaintedMapTapPoints = () =>
    ROWS.slice(0, 3).map((row) => ({ kind: "pin", id: row.id, lng: row.lng, lat: row.lat, ...toScreen([row.lng, row.lat]) }));
}

function stubMatchMedia(): void {
  window.matchMedia = ((query: string) => ({
    matches: query.includes("prefers-reduced-motion"),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

describe("Pal hops on the map", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    stubMatchMedia();
    stubProbes();
    slim.rows = ROWS;
    slim.status = "ready";
    localStorage.clear();
    window.history.replaceState(null, "", "/map");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete (window as ProbeWindow).__pubmaxMapCamera;
    delete (window as ProbeWindow).__pubmaxPaintedMapTapPoints;
  });

  async function render(element: React.ReactElement): Promise<void> {
    await act(async () => {
      root.render(element);
    });
  }

  async function tapLauncher(): Promise<void> {
    const launcher = document.querySelector<HTMLButtonElement>('[data-testid="wild-pal-hop"]');
    expect(launcher).not.toBeNull();
    await act(async () => {
      launcher!.click();
    });
    // The slim read, the pub's record (or the area list) and the landing settle.
    for (let i = 0; i < 400 && !document.querySelector(".palHopBubble"); i += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
  }

  const bubble = () => document.querySelector(".palHopBubble");

  it("renders nothing while the wild switch is off", async () => {
    localStorage.removeItem(WILD_MODE_STORAGE_KEY);
    await render(createElement(PalHopGate, { cityId: "london", placement: "edge" }));
    expect(container.innerHTML).toBe("");
  });

  it("is a round button named Find the cheapest on the phone map edge", async () => {
    await render(createElement(PalHop, { cityId: "london", placement: "edge" }));
    const launcher = container.querySelector("button");
    expect(launcher?.getAttribute("aria-label")).toBe("Find the cheapest");
    expect(launcher?.className).toContain("palHopLauncher--edge");
  });

  it("lands on the cheapest priced pub on screen and says the price, the beer, the pub and who listed it when", async () => {
    const shown: string[] = [];
    await render(createElement(PalHop, { cityId: "london", placement: "edge", onShowVenue: (id: string) => shown.push(id) }));
    await tapLauncher();
    const text = bubble()?.textContent ?? "";
    expect(text).toContain("Cheapest pint on screen");
    expect(bubble()!.querySelector(".price-plaque")?.textContent).toBe("£4.20");
    expect(text).toContain("A pint of Camden Hells");
    expect(text).toContain("at The B");
    expect(text).toContain("On record · Pint Prices · read 2 Oct");
    // The pub drawn off screen at £2.50 is not "on screen".
    expect(text).not.toContain("£2.50");
    // The bubble keeps to the robin, which keeps to the pub's pin.
    expect((document.querySelector(".palHopBubbleAnchor") as HTMLElement).style.transform).toMatch(/^translate3d\(/);
    expect((document.querySelector(".palHopRobin") as HTMLElement).style.transform).toMatch(/^translate3d\(/);

    const show = [...bubble()!.querySelectorAll("button")].find((button) => button.textContent?.includes("Show me"));
    await act(async () => {
      show!.click();
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    expect(shown).toEqual(["venue-b"]);
  });

  it("agrees with the map's own bottom card, and calls a figure people logged since people-logged", async () => {
    const peek = {
      status: "answer" as const,
      answer: {
        venueId: "venue-a", name: "The A", priceGbp: 3.9, priceLabel: "£3.90", anchor: null,
        lineLabel: null, figureLabel: "£3.90", isPub: true, walkMinutes: null,
      },
    };
    await render(createElement(PalHop, { cityId: "london", placement: "edge", peek }));
    await tapLauncher();
    const text = bubble()?.textContent ?? "";
    expect(text).toContain("at The A");
    expect(bubble()!.querySelector(".price-plaque")?.textContent).toBe("£3.90");
    expect(text).toContain("People-logged price · Date not known");
    expect(text).not.toContain("Pint Prices");
    // The record's beer is at another price, so no beer is named.
    expect(text).toContain("A pint");
    expect(text).not.toContain("Camden Hells");
  });

  it("says when no priced pub is on screen without offering an area with unknown price coverage", async () => {
    slim.rows = [pub("venue-d", null, -0.122, 51.507)];
    const href = window.location.href;
    await render(createElement(PalHop, { cityId: "london", placement: "edge" }));
    await tapLauncher();
    const text = bubble()?.textContent ?? "";
    expect(text).toContain("No listed pint price on screen here.");
    const offer = [...bubble()!.querySelectorAll("button")].find((button) => button.textContent?.startsWith("Show me "));
    // R6 leaves every catalogue area's price-coverage check unpassed.
    expect(offer).toBeUndefined();
    expect(bubble()!.querySelector(".price-plaque")).toBeNull();
    expect(bubble()!.querySelector('[aria-label="Send the Pal home"]')).not.toBeNull();
    expect(window.location.href).toBe(href);
  });

  it("hunts pints only, and says so while the map shows another drink", async () => {
    await render(createElement(PalHop, { cityId: "london", placement: "edge", drinkLaneSelected: true }));
    await tapLauncher();
    expect(bubble()?.textContent).toContain("I only hunt pints.");
    expect(bubble()?.querySelector(".price-plaque")).toBeNull();
  });

  it("says it could not read the prices rather than guessing", async () => {
    slim.rows = [];
    slim.status = "unavailable";
    await render(createElement(PalHop, { cityId: "london", placement: "edge" }));
    await tapLauncher();
    expect(bubble()?.textContent).toContain("I could not read the prices on screen just now.");
  });
});
