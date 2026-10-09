// @vitest-environment jsdom

import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
    "aria-labelledby"?: string;
  }) => createElement("a", { href, "data-next-link": "true", ...rest }, children),
}));

vi.mock("@/components/map/canvas/PlanCrawlRouteMapCanvas", async () => {
  const React = await import("react");
  return {
    default: () => React.createElement("div", { "data-testid": "plan-crawl-route-map" }),
  };
});

import PlanRouteMiniMap from "@/components/plan/PlanRouteMiniMap";

type Stop = { venueId: string; venueName: string; position: number };

type PendingResponse = {
  url: string;
  resolve: (response: Response) => void;
};

const PLAN_A: Stop[] = [
  { venueId: "venue-a", venueName: "First pub", position: 0 },
  { venueId: "venue-b", venueName: "Second pub", position: 1 },
];
const PLAN_B: Stop[] = [
  { venueId: "venue-c", venueName: "Third pub", position: 0 },
  { venueId: "venue-d", venueName: "Fourth pub", position: 1 },
];
const PLAN_A_RENAMED: Stop[] = [
  { venueId: "venue-a", venueName: "Renamed first pub", position: 0 },
  { venueId: "venue-b", venueName: "Renamed second pub", position: 1 },
];

let host: HTMLDivElement;
let root: Root;
let pending: PendingResponse[];

function venueResponse(latitude: number, longitude: number): Response {
  return Response.json({
    venue: { latitude, longitude, primaryBorough: "Westminster" },
  });
}

function routeResponse(
  coordinates: number[][] = [
    [-0.14, 51.51],
    [-0.135, 51.515],
    [-0.13, 51.52],
  ],
): Response {
  return Response.json({
    source: "ors",
    line: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates,
          },
        },
      ],
    },
  });
}

function findPending(urlPart: string): PendingResponse {
  const request = pending.find((entry) => entry.url.includes(urlPart));
  if (!request) throw new Error(`No pending request contains ${urlPart}`);
  return request;
}

function resolvePending(urlPart: string, response: Response): void {
  const index = pending.findIndex((entry) => entry.url.includes(urlPart));
  if (index < 0) throw new Error(`No pending request contains ${urlPart}`);
  const [request] = pending.splice(index, 1);
  request!.resolve(response);
}

async function settleVenueLookups(
  rows: ReadonlyArray<{ id: string; latitude: number; longitude: number }>,
): Promise<void> {
  await act(async () => {
    for (const row of rows) {
      resolvePending(`/api/venue/${row.id}`, venueResponse(row.latitude, row.longitude));
    }
    await Promise.resolve();
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  pending = [];
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    getExtension: () => null,
  } as unknown as WebGL2RenderingContext);
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) =>
      new Promise<Response>((resolve) => {
        pending.push({ url: String(input), resolve });
      }),
    ),
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
});

describe("PlanRouteMiniMap request identity", () => {
  it("mounts the MapLibre route preview once stops resolve", async () => {
    await act(async () => {
      root.render(createElement(PlanRouteMiniMap, { stops: PLAN_A }));
    });
    await settleVenueLookups([
      { id: "venue-a", latitude: 51.51, longitude: -0.14 },
      { id: "venue-b", latitude: 51.52, longitude: -0.13 },
    ]);

    expect(host.querySelector('[data-testid="plan-crawl-route-map"]')).not.toBeNull();
    expect(host.querySelector(".planRouteMiniMap__title")?.textContent).toContain("Route map:");
  });

  it("opens the route from a link, not a button wrapped around the map", async () => {
    await act(async () => {
      root.render(
        createElement(PlanRouteMiniMap, {
          stops: PLAN_A,
          mapHref: "/map?mode=build&pubs=venue-a",
        }),
      );
    });
    await settleVenueLookups([
      { id: "venue-a", latitude: 51.51, longitude: -0.14 },
      { id: "venue-b", latitude: 51.52, longitude: -0.13 },
    ]);

    const link = host.querySelector(".planRouteMiniMap--clickable");
    expect(link?.tagName).toBe("A");
    expect(link?.getAttribute("href")).toBe("/map?mode=build&pubs=venue-a");
    expect(host.querySelector("[role='button']")).toBeNull();
  });

  it("renders no card and fetches nothing when the browser has no WebGL2", async () => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
    await act(async () => {
      root.render(createElement(PlanRouteMiniMap, { stops: PLAN_A, mapHref: "/map" }));
    });

    expect(pending).toHaveLength(0);
    expect(host.querySelector(".planRouteMiniMap")).toBeNull();
  });

  it("does not let a late previous route paint while a new plan resolves", async () => {
    await act(async () => {
      root.render(createElement(PlanRouteMiniMap, { stops: PLAN_A }));
    });
    await settleVenueLookups([
      { id: "venue-a", latitude: 51.51, longitude: -0.14 },
      { id: "venue-b", latitude: 51.52, longitude: -0.13 },
    ]);

    expect(host.querySelector(".planRouteMiniMap")).not.toBeNull();
    const previousRoute = findPending("/api/walk-route?");

    await act(async () => {
      root.render(createElement(PlanRouteMiniMap, { stops: PLAN_B }));
    });

    // The new plan has not resolved yet. The old SVG must not remain as the
    // visible answer while its replacement is in flight.
    expect(host.querySelector(".planRouteMiniMap")).toBeNull();

    // The route request ignores abort in this harness. This models a response
    // that was already buffered when the old effect was cleaned up.
    await act(async () => {
      previousRoute.resolve(routeResponse());
      await Promise.resolve();
    });
    expect(host.querySelector(".planRouteMiniMap")).toBeNull();

    await settleVenueLookups([
      { id: "venue-c", latitude: 51.53, longitude: -0.12 },
      { id: "venue-d", latitude: 51.54, longitude: -0.11 },
    ]);

    expect(host.querySelector(".planRouteMiniMap")).not.toBeNull();
    expect(host.querySelector(".planRouteMiniMap__srOnly")?.textContent).toContain(
      "Third pub, Fourth pub",
    );
    expect(host.querySelector(".planRouteMiniMap__srOnly")?.textContent).not.toContain(
      "First pub",
    );
  });

  it("keeps the map up through a reorder and locates nothing again", async () => {
    await act(async () => {
      root.render(createElement(PlanRouteMiniMap, { stops: PLAN_A }));
    });
    await settleVenueLookups([
      { id: "venue-a", latitude: 51.51, longitude: -0.14 },
      { id: "venue-b", latitude: 51.52, longitude: -0.13 },
    ]);
    const map = host.querySelector('[data-testid="plan-crawl-route-map"]');
    expect(map).not.toBeNull();

    const swapped = [
      { ...PLAN_A[1]!, position: 0 },
      { ...PLAN_A[0]!, position: 1 },
    ];
    await act(async () => {
      root.render(createElement(PlanRouteMiniMap, { stops: swapped }));
    });
    expect(host.querySelector('[data-testid="plan-crawl-route-map"]')).toBe(map);
    expect(host.querySelector(".planRouteMiniMap__srOnly")?.textContent).toContain("Second pub, First pub");
    await act(async () => { await Promise.resolve(); });
    expect(host.querySelector('[data-testid="plan-crawl-route-map"]')).toBe(map);
    expect(pending.filter((entry) => entry.url.includes("/api/venue/"))).toHaveLength(0);
    expect(pending.filter((entry) => entry.url.includes("/api/walk-route?"))).toHaveLength(2);
  });

  it("re-resolves when venue names change but ids and positions stay the same", async () => {
    await act(async () => {
      root.render(createElement(PlanRouteMiniMap, { stops: PLAN_A }));
    });
    await settleVenueLookups([
      { id: "venue-a", latitude: 51.51, longitude: -0.14 },
      { id: "venue-b", latitude: 51.52, longitude: -0.13 },
    ]);

    expect(host.querySelector(".planRouteMiniMap__srOnly")?.textContent).toContain(
      "First pub, Second pub",
    );

    await act(async () => {
      root.render(createElement(PlanRouteMiniMap, { stops: PLAN_A_RENAMED }));
    });

    // A venue rename changes the accessible route description. Do not retain
    // the old labels while the renamed stops are being resolved.
    expect(host.querySelector(".planRouteMiniMap")).toBeNull();

    await settleVenueLookups([
      { id: "venue-a", latitude: 51.51, longitude: -0.14 },
      { id: "venue-b", latitude: 51.52, longitude: -0.13 },
    ]);

    expect(host.querySelector(".planRouteMiniMap__srOnly")?.textContent).toContain(
      "Renamed first pub, Renamed second pub",
    );
    expect(host.querySelector(".planRouteMiniMap__srOnly")?.textContent).not.toContain(
      "First pub",
    );
  });
});
