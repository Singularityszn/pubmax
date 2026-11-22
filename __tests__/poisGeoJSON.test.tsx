// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { usePoisGeoJSON } from "@/components/map/canvas/usePoisGeoJSON";
import type { Landmark } from "@/lib/landmarks";
import type { Poi } from "@/lib/pois";

const eyePoi: Poi = { id: "poi-eye", name: "London Eye", category: "sight", coordinates: [-0.1196, 51.5033], rank: 1 };
const station: Poi = { id: "poi-waterloo", name: "Waterloo", category: "tube", coordinates: [-0.1132, 51.5031], rank: 1 };
const eyeLandmark = {
  id: "london-eye",
  name: "London Eye",
  coordinates: [-0.11959, 51.50329],
  history: "",
  source: { label: "", url: "" },
} as unknown as Landmark;

let container: HTMLDivElement;
let root: Root;
let latest: GeoJSON.FeatureCollection | null = null;

function Probe({ path, landmarks, held = false }: { path: string; landmarks: readonly Landmark[]; held?: boolean }) {
  latest = usePoisGeoJSON(path, landmarks, held);
  return null;
}

const ids = () => latest?.features.map((feature) => feature.properties?.id);

beforeEach(() => {
  latest = null;
  container = document.createElement("div");
  root = createRoot(container);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it("drops a POI's landmark twin when the landmarks arrive after the POIs", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([eyePoi, station]))));
  await act(async () => root.render(createElement(Probe, { path: "/data/pois-late-landmarks.json", landmarks: [] })));
  expect(ids()).toEqual(["poi-eye", "poi-waterloo"]);

  await act(async () => root.render(createElement(Probe, { path: "/data/pois-late-landmarks.json", landmarks: [eyeLandmark] })));
  expect(ids()).toEqual(["poi-waterloo"]);
});

it("keeps one answer while an empty landmark list is rebuilt on each render", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([eyePoi, station]))));
  await act(async () => root.render(createElement(Probe, { path: "/data/pois-stable.json", landmarks: [] })));
  const first = latest;
  await act(async () => root.render(createElement(Probe, { path: "/data/pois-stable.json", landmarks: [] })));
  expect(latest).toBe(first);
});

it("reads nothing while the pins hold the secondary streams", async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify([station])));
  vi.stubGlobal("fetch", fetch);
  await act(async () => root.render(createElement(Probe, { path: "/data/pois-held.json", landmarks: [], held: true })));
  expect(fetch).not.toHaveBeenCalled();
  expect(latest).toBeNull();

  await act(async () => root.render(createElement(Probe, { path: "/data/pois-held.json", landmarks: [] })));
  expect(ids()).toEqual(["poi-waterloo"]);
});
