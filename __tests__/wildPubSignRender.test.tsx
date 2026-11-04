// @vitest-environment jsdom

// Historic sign covers and the Last Orders Bell remain wild features.
// Normal photo fallbacks illustrate only an explicitly named pub.

import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const surface = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("@/lib/surfaceDataCache", () => ({
  loadSurfaceJson: async (_key: string, _options: unknown, apply: (value: unknown, source: "network") => void) => {
    await Promise.resolve();
    if (surface.value === null) return "failed";
    apply(surface.value, "network");
    return "network";
  },
}));

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: unknown; className?: string }) =>
    createElement("a", { href, className }, children as never),
}));

import LastOrdersBell, { LastOrdersBellCard } from "@/components/wild/LastOrdersBell";
import LastOrdersBellSlot from "@/components/wild/LastOrdersBellSlot";
import PubSign, { PubSignFallback } from "@/components/wild/PubSign";
import PubSignSlot, { PubSignFallbackSlot } from "@/components/wild/PubSignSlot";
import type { VenueListedPint } from "@/lib/venueListedPint";

const LISTED: VenueListedPint = {
  priceGbp: 6.13,
  pintName: "Stella Artois",
  publisher: { label: "Pint Prices", url: "https://example.com/pint-prices" },
  observedOn: "2026-10-02",
} as VenueListedPint;

const HOURS_PACK = {
  version: 1,
  readOn: "2026-10-05",
  rows: [
    ["venue-osm-n14178896030", "The Dog and Duck", 51.514, -0.13196, "Mo-We 12:00-23:00; Th 12:00-23:30; Fr 12:00-24:00; Sa 11:30-24:00; Su 12:00-22:30", ""],
    ["venue-osm-w244772119", "Black Horse", 51.51671, -0.133, "Mo-Th 12:00-23:30; Fr-Sa 12:00-24:00; Su 12:00-22:00", ""],
  ],
};

let container: HTMLDivElement;
let root: Root;

function reduceMotion(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({ matches: reduce && query.includes("reduce"), media: query })),
  );
}

async function render(element: ReactElement) {
  await act(async () => {
    root.render(element);
  });
  // Let lazy chunks and the pack's microtask land.
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  reduceMotion(true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  surface.value = null;
  window.localStorage.clear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("with the wild switch off", () => {
  it("renders nothing for the sign and the bell, and the plain photo fallback unchanged", () => {
    const plain = createElement("div", { className: "venueImage venueImage--empty", role: "img", "aria-label": "x" }, "No photo yet");
    expect(renderToStaticMarkup(createElement(PubSignSlot, { name: "The Dog and Duck" }))).toBe("");
    expect(renderToStaticMarkup(createElement(LastOrdersBellSlot, { venueId: "venue-x", venueName: "X" }))).toBe("");
    expect(
      renderToStaticMarkup(
        <PubSignFallbackSlot>{plain}</PubSignFallbackSlot>,
      ),
    ).toBe(renderToStaticMarkup(plain));
  });

  it("stays off in the browser until the switch is turned on", async () => {
    await render(createElement(PubSignSlot, { name: "The Dog and Duck" }));
    expect(container.innerHTML).toBe("");
  });
});

describe("the sign", () => {
  it("letters the name, hangs the listed pint through its band and says who listed it", async () => {
    await render(createElement(PubSign, { name: "The Montagu Pyke", venueId: "venue-1lqxwbp", listedPint: LISTED, photoDoor: true }));
    const art = container.querySelector("svg.pubSign__art");
    expect(art?.getAttribute("role")).toBe("img");
    expect(art?.getAttribute("aria-label")).toBe("The Montagu Pyke: a sign drawn from its name. No photo yet.");
    expect([...container.querySelectorAll("text.pubSign__name")].map((node) => node.textContent).join(" ")).toMatch(/montagu pyke/i);
    const plaques = container.querySelectorAll(".pubSign__plaque .price-plaque");
    expect(plaques).toHaveLength(1);
    expect(plaques[0]?.textContent).toBe("£6.13");
    expect([...plaques[0]!.classList].some((name) => name.startsWith("priceBand-"))).toBe(true);
    expect(container.textContent).toContain("Listed by Pint Prices");
    expect(container.textContent).toContain("No photo of this pub yet.");
    expect(container.querySelector("button.pubSign__door")?.textContent).toBe("Add a photo");
    expect(container.textContent).not.toMatch(/since/i);
  });

  it("letters Since only for a founding year, and hangs no plaque without a listed pint", async () => {
    await render(createElement(PubSign, { name: "Prospect of Whitby", foundingYear: "1520" }));
    expect(container.querySelector("text.pubSign__since")?.textContent).toBe("SINCE 1520");
    expect(container.querySelector(".pubSign__plaque")).toBeNull();
  });

  it("hangs still for a reader who asked for less motion, even when tapped", async () => {
    const frames = vi.fn();
    vi.stubGlobal("requestAnimationFrame", frames);
    await render(createElement(PubSign, { name: "The Grapes" }));
    const stage = container.querySelector<HTMLElement>(".pubSign__stage")!;
    await act(async () => {
      stage.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(frames).not.toHaveBeenCalled();
    expect(container.querySelector<SVGGElement>("g.pubSign__swing")?.style.transform ?? "").toBe("");
  });

  it("swings when tapped otherwise", async () => {
    reduceMotion(false);
    const queue: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      queue.push(callback);
      return queue.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    await render(createElement(PubSign, { name: "The Grapes" }));
    const stage = container.querySelector<HTMLElement>(".pubSign__stage")!;
    await act(async () => {
      stage.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    for (let t = 16; t < 200 && queue.length; t += 16) queue.shift()!(t);
    expect(container.querySelector<SVGGElement>("g.pubSign__swing")?.style.transform).toMatch(/^rotate\(-?\d/);
  });

  it("stands in for VenueImage's fallback only with an explicit pub name", async () => {
    const plain = createElement("p", { className: "plain" }, "No photo yet");
    await render(<PubSignFallback name="The Lamb" area="Camden">{plain}</PubSignFallback>);
    expect(container.querySelector(".venueImage--sign svg.pubSign__art")).not.toBeNull();
    expect(container.querySelector(".plain")).toBeNull();
    await render(<PubSignFallback>{plain}</PubSignFallback>);
    expect(container.querySelector(".plain")).not.toBeNull();
    expect(container.querySelector(".pubSign")).toBeNull();
  });
});

describe("the bell", () => {
  it("rings at 22:40 on a Monday with the close, the source and a pub open later", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-02T12:00:00Z"));
    window.history.replaceState(null, "", "/pubs/x?wild=1&wildclock=22:40");
    surface.value = HOURS_PACK;
    await render(
      createElement(LastOrdersBell, { venueId: "venue-osm-n14178896030", venueName: "The Dog and Duck", variant: "page" }),
    );
    const text = container.textContent ?? "";
    expect(text).toContain("Last orders soon at The Dog and Duck.");
    expect(text).toContain("It closes at 23:00 tonight, 20 minutes from now.");
    expect(text).toContain("Open later nearby: Black Horse, until 23:30.");
    expect(text).toContain("Hours from OpenStreetMap, read 5 October 2026.");
    expect(container.querySelector("button[aria-label='Ring the bell again']")).not.toBeNull();
  });

  it("stays silent with an hour left, and for a pub the hours pack does not hold", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-02T12:00:00Z"));
    surface.value = HOURS_PACK;
    window.history.replaceState(null, "", "/pubs/x?wildclock=22:00");
    await render(createElement(LastOrdersBell, { venueId: "venue-osm-n14178896030", venueName: "The Dog and Duck" }));
    expect(container.innerHTML).toBe("");
    act(() => root.unmount());
    root = createRoot(container);
    window.history.replaceState(null, "", "/pubs/x?wildclock=22:40");
    await render(createElement(LastOrdersBell, { venueId: "venue-nowhere", venueName: "Nowhere" }));
    expect(container.innerHTML).toBe("");
  });

  it("says less in the venue sheet's row, and still names where the hours came from", async () => {
    await render(
      <LastOrdersBellCard
        answer={{
          venueId: "venue-1lqxwbp",
          name: "Montagu Pyke",
          minutesLeft: 25,
          closesAt: "23:00",
          when: "tonight",
          nearby: { venueId: "venue-osm-x", name: "Brewdog", walkMinutes: 2, closesAt: "23:30" },
        }}
        venueName="The Montagu Pyke"
        readOn="2026-10-05"
        variant="sheet"
      />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("Last orders soon at The Montagu Pyke.");
    expect(text).toContain("It closes at 23:00 tonight.");
    expect(text).not.toContain("minutes from now");
    expect(text).toContain("Open later nearby: Brewdog, until 23:30.");
    expect(text).toContain("Hours from OpenStreetMap, read 5 October 2026.");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/map?sel=venue-osm-x");
  });
});
