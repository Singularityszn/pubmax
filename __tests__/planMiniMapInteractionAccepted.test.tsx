// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
// MapLibre owns this nested control; test the actual parent event boundary.
vi.mock("next/dynamic", () => ({ default: () => function CanvasBoundary() {
  return <button type="button" className="maplibregl-ctrl-attrib-button">Map attribution</button>;
} }));

import PlanRouteMiniMap from "@/components/plan/PlanRouteMiniMap";

let root: Root;
let host: HTMLDivElement;
const href = "/map?mode=build&pubs=venue-a,venue-b";
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
let previousActEnvironment: boolean | undefined;

beforeEach(async () => {
  previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  router.push.mockReset();
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    getExtension: () => null,
  } as unknown as WebGL2RenderingContext);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url.startsWith("/api/venue/")
    ? Response.json({ venue: { latitude: 51.5, longitude: url.endsWith("a") ? -0.1 : -0.11, primaryBorough: "Camden" } })
    : new Response(null, { status: 503 })));
  await act(async () => root.render(<PlanRouteMiniMap mapHref={href} stops={[
    { venueId: "venue-a", venueName: "First pub", position: 0 },
    { venueId: "venue-b", venueName: "Second pub", position: 1 },
  ]} />));
  expect(host.querySelector(".planRouteMiniMap")).not.toBeNull();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});

it("keeps a nested attribution click on Plan", () => {
  act(() => host.querySelector<HTMLButtonElement>(".maplibregl-ctrl-attrib-button")!.click());
  expect(router.push).not.toHaveBeenCalled();
});

it("lets attribution own Enter and keeps the Map route as a native link", () => {
  const attribution = host.querySelector<HTMLButtonElement>(".maplibregl-ctrl-attrib-button")!;
  act(() => attribution.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
  expect(router.push).not.toHaveBeenCalled();
  expect(host.querySelector<HTMLAnchorElement>(".planRouteMiniMap__routeLink")?.getAttribute("href")).toBe(href);
});
