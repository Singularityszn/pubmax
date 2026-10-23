// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const engine = vi.hoisted(() => ({
  fitBounds: vi.fn(),
  resize: vi.fn(),
  remove: vi.fn(),
  events: new Map<string, (event: { originalEvent?: Event }) => void>(),
}));

vi.mock("maplibre-gl/dist/maplibre-gl.css", () => ({}));
vi.mock("maplibre-gl", () => ({
  setWorkerUrl: () => {},
  Map: class {
    fitBounds = engine.fitBounds;
    resize = engine.resize;
    remove = engine.remove;
    on(name: string, handler: (event: { originalEvent?: Event }) => void) { engine.events.set(name, handler); }
    project() { return { x: 100, y: 100 }; }
  },
  LngLatBounds: class {
    extend() { return this; }
  },
  Marker: class {
    setLngLat() { return this; }
    addTo() { return this; }
    remove() {}
  },
}));

import PalRecommendationMapCanvas from "@/components/map/PalRecommendationMapCanvas";

const points = [
  { venueId: "a", name: "First", number: 1, lat: 51.513, lng: -0.134 },
  { venueId: "b", name: "Second", number: 2, lat: 51.514, lng: -0.135 },
  { venueId: "c", name: "Third", number: 3, lat: 51.512, lng: -0.133 },
  { venueId: "d", name: "Fourth", number: 4, lat: 51.511, lng: -0.132 },
];
let host: HTMLDivElement;
let root: Root;
let resize: () => void;
const disconnected = vi.fn();
const unavailable = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  engine.events.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect = disconnected;
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const render = (answerPoints = points) => act(async () => {
  root.render(<PalRecommendationMapCanvas points={answerPoints} onUnavailable={unavailable} />);
});

describe("recommendation camera ownership", () => {
  it("fits the answer again after each container resize without treating programmatic movement as user input", async () => {
    await render();
    const initialFit = engine.fitBounds.mock.calls[0];
    expect(initialFit).toEqual([expect.anything(), { padding: 90, maxZoom: 17, duration: 0 }]);
    engine.events.get("movestart")!({});
    resize();
    resize();
    expect(engine.resize).toHaveBeenCalledTimes(2);
    expect(engine.fitBounds.mock.calls).toEqual([initialFit, initialFit, initialFit]);
    expect(unavailable).not.toHaveBeenCalled();
  });

  it("preserves a user camera across resizes and restores answer framing for a new answer", async () => {
    await render();
    engine.events.get("movestart")!({ originalEvent: new MouseEvent("mousemove") });
    resize();
    resize();
    expect(engine.resize).toHaveBeenCalledTimes(2);
    expect(engine.fitBounds).toHaveBeenCalledTimes(1);
    await render([...points]);
    resize();
    expect(engine.fitBounds).toHaveBeenCalledTimes(3);
    expect(engine.remove).toHaveBeenCalledTimes(1);
    expect(disconnected).toHaveBeenCalledTimes(1);
  });
});
