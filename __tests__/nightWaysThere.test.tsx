// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ push: vi.fn(), pathname: "/plan/x" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, prefetch: vi.fn() }),
  usePathname: () => nav.pathname,
}));

import { legPartColour, legRouteToLines } from "@/components/map/canvas/legRouteScene";
import NightWaysThere from "@/components/night/NightWaysThere";
import type { LegOption, LegOptionsResponse } from "@/lib/legOptions";
import { legKeyFor, readLegRouteOnMap, showLegRouteOnMap } from "@/lib/legRouteOnMap";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const from = { lat: 51.5145, lng: -0.1318 };
const to = { lat: 51.5235, lng: -0.158 };
const walkPath: [number, number][] = [[-0.1318, 51.5145], [-0.158, 51.5235]];

const walk: LegOption = {
  id: "walk", kind: "walk", minutes: 26, farePence: 0, estimate: true, fastest: false, cheapest: true,
  parts: [{ mode: "walking", line: null, minutes: 26, path: walkPath }],
};
const tube: LegOption = {
  id: "transit-0", kind: "transit", minutes: 24, farePence: 300, estimate: false, fastest: true, cheapest: false,
  parts: [
    { mode: "walking", line: null, minutes: 6, path: [[-0.1318, 51.5145], [-0.1304, 51.5163]] },
    { mode: "tube", line: "Central", minutes: 2, path: [[-0.1304, 51.5163], [-0.1415, 51.515]] },
    { mode: "tube", line: "Hammersmith & City", minutes: 9, path: [[-0.1415, 51.515], [-0.158, 51.5235]] },
  ],
};
const bus: LegOption = {
  id: "transit-1", kind: "transit", minutes: 28, farePence: null, estimate: false, fastest: false, cheapest: false,
  parts: [{ mode: "bus", line: "98", minutes: 28, path: walkPath }],
};

describe("the chosen way on the map", () => {
  it("colours a ride by its TfL line, a bus in bus red, and leaves a walk to the route colour", () => {
    expect(legPartColour(tube.parts[1]!)).toBe("#DC241F");
    expect(legPartColour(tube.parts[2]!)).toBe("#F589A6");
    expect(legPartColour({ mode: "elizabeth-line", line: "Elizabeth line", minutes: 3, path: [] })).toBe("#60399E");
    expect(legPartColour(bus.parts[0]!)).toBe("#DC241F");
    expect(legPartColour(tube.parts[0]!)).toBeNull();
  });

  it("draws one line per part, walks dotted and an estimate as an estimate, and nothing when none is chosen", () => {
    const lines = legRouteToLines(tube);
    expect(lines.features.map((feature) => feature.properties)).toEqual([
      { walk: true, estimate: false, colour: "" },
      { walk: false, estimate: false, colour: "#DC241F" },
      { walk: false, estimate: false, colour: "#F589A6" },
    ]);
    expect(legRouteToLines(walk).features[0]!.properties).toEqual({ walk: true, estimate: true, colour: "" });
    expect(legRouteToLines(null).features).toEqual([]);
  });
});

describe("Ways to get there", () => {
  let root: Root | null = null;
  let host: HTMLElement;
  let answer: { status: number; body: LegOptionsResponse | null };
  const asked: string[] = [];

  async function render(legKey = legKeyFor("venue-a", "venue-b")) {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(createElement(NightWaysThere, { legKey, from, to })));
  }
  const toggle = () => host.querySelector<HTMLButtonElement>(".nightWays__toggle")!;
  const rows = () => [...host.querySelectorAll<HTMLButtonElement>(".nightWays__option")];
  async function settle() {
    for (let turn = 0; turn < 5; turn += 1) await act(async () => { await Promise.resolve(); });
  }

  beforeEach(() => {
    nav.push.mockReset();
    nav.pathname = "/plan/x";
    asked.length = 0;
    answer = { status: 200, body: { status: "ok", options: [tube, walk, bus] } };
    showLegRouteOnMap(null);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      asked.push(String(input));
      return answer.body ? Response.json(answer.body, { status: answer.status }) : new Response("down", { status: answer.status });
    }));
  });
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    host?.remove();
    vi.unstubAllGlobals();
    showLegRouteOnMap(null);
  });

  it("asks TfL only when opened, for the two stops, and lists each way with its time, fare and marks", async () => {
    await render();
    expect(asked).toEqual([]);
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    await act(async () => toggle().click());
    await settle();
    expect(asked).toEqual(["/api/leg-options?from=51.51450,-0.13180&to=51.52350,-0.15800"]);
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(rows().map((row) => row.textContent)).toEqual([
      "Tube · Central then Tube · Hammersmith & City24 min£3.00Fastest",
      "WalkStraight-line estimate~26 minFreeCheapest",
      "Bus 9828 minFare not listed",
    ]);
    expect(rows()[0]!.getAttribute("aria-label")).toBe("Tube · Central then Tube · Hammersmith & City, 24 min, £3.00, fastest, show on the map");
    expect(rows()[1]!.getAttribute("aria-label")).toBe("Walk, about 26 min, Free, cheapest, show on the map");
    expect(host.textContent).toContain("Times and fares from TfL, if you leave now.");
  });

  it("draws the chosen way on the map, takes the reader there, and clears it on a second tap", async () => {
    await render();
    await act(async () => toggle().click());
    await settle();
    await act(async () => rows()[0]!.click());
    expect(readLegRouteOnMap()).toEqual({ legKey: "venue-a>venue-b", option: tube });
    expect(nav.push).toHaveBeenCalledWith("/map");
    expect(rows()[0]!.getAttribute("aria-pressed")).toBe("true");
    expect(rows()[0]!.getAttribute("aria-label")).toMatch(/, on the map$/);

    await act(async () => rows()[0]!.click());
    expect(readLegRouteOnMap()).toBeNull();
    expect(rows()[0]!.getAttribute("aria-pressed")).toBe("false");
  });

  it("stays on the map when the reader is already there", async () => {
    nav.pathname = "/map";
    await render();
    await act(async () => toggle().click());
    await settle();
    await act(async () => rows()[2]!.click());
    expect(readLegRouteOnMap()?.option.id).toBe("transit-1");
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("says so when TfL has no way, and offers to ask again when it does not answer", async () => {
    answer = { status: 200, body: { status: "unavailable", options: [] } };
    await render();
    await act(async () => toggle().click());
    await settle();
    expect(host.textContent).toContain("TfL has no way to show for this leg right now.");
    expect(rows()).toHaveLength(0);

    await act(async () => toggle().click());
    answer = { status: 503, body: null };
    await act(async () => toggle().click());
    await settle();
    expect(host.textContent).toContain("TfL didn't answer.");
    answer = { status: 200, body: { status: "ok", options: [walk] } };
    await act(async () => host.querySelector<HTMLButtonElement>(".nightWays__retry")!.click());
    await settle();
    expect(rows()).toHaveLength(1);
    expect(asked).toHaveLength(3);
  });

  it("takes the old leg's way off the map when the night moves on", async () => {
    showLegRouteOnMap({ legKey: legKeyFor("venue-a", "venue-b"), option: tube });
    await render(legKeyFor("venue-b", "venue-c"));
    await settle();
    expect(readLegRouteOnMap()).toBeNull();
  });
});
