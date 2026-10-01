// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const capability = vi.hoisted(() => ({ token: "member-token", role: "host" as const }));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ user: null, session: null, identityResolved: true }),
}));
vi.mock("@/lib/activePlan", () => ({
  markActivePlan: vi.fn(),
  setActivePlanRole: vi.fn(),
}));
vi.mock("@/lib/planSessionCapability", () => ({
  parsePlanCapabilitySnapshot: () => ({
    token: capability.token,
    collaborationAuthorized: true,
    role: capability.role,
  }),
  planCapabilityEvent: (id: string) => `pubmax:plan-capability:${id}`,
  readPlanCapabilitySnapshot: () => `${capability.token}|1|${capability.role}`,
  restorePlanCapability: vi.fn().mockResolvedValue(null),
  writePlanCapability: vi.fn(),
}));
vi.mock("@/components/plan/PlanCollaborationPanel", () => ({ default: () => null }));
vi.mock("@/components/round/RoundStarter", () => ({ default: () => null }));

// Keep PlanRouteMiniMap and its public route link real. Replace only the
// WebGL canvas, which is unrelated to the link contract in this DOM test.
vi.mock("@/components/map/canvas/webgl", () => ({
  probeWebGl2: () => ({ hasContext: true }),
}));
vi.mock("@/components/map/canvas/PlanCrawlRouteMapCanvas", () => ({
  default: () => null,
}));

import PlanSummary from "@/components/plan/PlanSummary";
import type { PlanPrivacyPreviewDTO } from "@/lib/planPrivacy";

const PLAN = "6ab5ca40-836b-4970-9477-d1779fdd31ab";
const stops = [
  { venueId: "venue-zoqbw1", venueName: "The Swan", position: 1 },
  { venueId: "venue-1yd70c7", venueName: "The Lamb", position: 2 },
  { venueId: "venue-htm670", venueName: "The Crown", position: 3 },
] as const;

const preview: PlanPrivacyPreviewDTO = {
  hostDisplayName: "Sam",
  areaName: "Soho",
  startLabel: "18:30",
  stopCount: 3,
  vibeLabel: null,
  accessibilitySummary: null,
  routeReady: true,
  visibility: "preview",
};

function memberState(context: { drinkCategory?: string; zeroProof?: boolean }) {
  return {
    plan: {
      id: PLAN,
      title: "Thursday, sorted",
      startTime: "2026-07-16T17:30:00.000Z",
      createdAt: "2026-07-11T12:00:00.000Z",
      routeRevision: 1,
    },
    stops,
    crew: [],
    context: { nightArea: "soho", stopCount: 3, ...context },
  };
}

const coordinates: Record<string, { latitude: number; longitude: number; primaryBorough: string }> = {
  "venue-zoqbw1": { latitude: 51.5116, longitude: -0.176985, primaryBorough: "Westminster" },
  "venue-1yd70c7": { latitude: 51.5231, longitude: -0.119017, primaryBorough: "Camden" },
  "venue-htm670": { latitude: 51.537307, longitude: -0.109554, primaryBorough: "Islington" },
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    body: null,
  } as unknown as Response;
}

function responseFor(input: RequestInfo | URL, context: { drinkCategory?: string; zeroProof?: boolean }): Response {
  const url = String(input);
  if (url.includes(`/api/plans/${PLAN}/getin`)) {
    return jsonResponse({ groupSize: 0, generatedAt: "2026-07-16T17:00:00.000Z", stops: [] });
  }
  if (url.includes("/api/whats-on")) return jsonResponse({ rows: [] });
  if (url.startsWith("/api/venue/")) {
    const venueId = decodeURIComponent(url.slice("/api/venue/".length));
    const venue = coordinates[venueId];
    return venue ? jsonResponse({ venue }) : jsonResponse({}, 404);
  }
  if (url.startsWith("/api/walk-route")) return jsonResponse({}, 503);
  if (url.startsWith(`/api/plans/${PLAN}`)) return jsonResponse(memberState(context));
  return jsonResponse({}, 404);
}

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  capability.token = "member-token";
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("saved Plan drink intent in map links", () => {
  it.each([
    [{ drinkCategory: "wine" }, "routeDrink", "wine", "First stop"],
    [{ drinkCategory: "cocktail" }, "routeDrink", "cocktail", "First stop"],
    [{ drinkCategory: "cocktail", zeroProof: true }, "routeLow", "1", "First stop"],
    [{ drinkCategory: "beer" }, null, null, "First pint"],
    [{}, null, null, "First pint"],
  ])("carries %j as public intent on both route links", async (context, key, value, eyebrow) => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => Promise.resolve(responseFor(input, context))));

    await act(async () => {
      root.render(createElement(PlanSummary, { planId: PLAN, initialPreview: preview }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await vi.waitFor(() => expect(container.querySelector(".planRouteMiniMap__routeLink")).not.toBeNull());
    });

    const walkingLink = container.querySelector<HTMLAnchorElement>("a.planRoute__walk");
    const miniMapLink = container.querySelector<HTMLAnchorElement>("a.planRouteMiniMap__routeLink");
    expect(walkingLink).not.toBeNull();
    expect(miniMapLink).not.toBeNull();
    expect(container.textContent).toContain(eyebrow);
    expect(walkingLink!.getAttribute("href")).toBe(miniMapLink!.getAttribute("href"));

    const url = new URL(walkingLink!.href, "https://pubmaxx.example");
    expect(url.searchParams.get("mode")).toBe("build");
    expect(url.searchParams.get("pubs")?.split(",")).toEqual(stops.map((stop) => stop.venueId));
    if (key) expect(url.searchParams.get(key)).toBe(value);
    expect([...url.searchParams.keys()].sort()).toEqual(
      ["mode", "pubs", ...(key ? [key] : [])].sort(),
    );
    const perStopLinks = [...container.querySelectorAll<HTMLAnchorElement>(".planRoute__stopsTrack a")]
      .filter((link) => link.textContent?.trim() === "Open on the map");
    expect(perStopLinks).toHaveLength(stops.length);
    for (const [index, link] of perStopLinks.entries()) {
      const stopUrl = new URL(link.href, "https://pubmaxx.example");
      expect(stopUrl.pathname).toBe("/map");
      expect(stopUrl.searchParams.get("mode")).toBe("build");
      expect(stopUrl.searchParams.get("pubs")?.split(",")).toEqual(
        stops.map((stop) => stop.venueId),
      );
      expect(stopUrl.searchParams.get("sel")).toBe(stops[index]!.venueId);
      if (key) expect(stopUrl.searchParams.get(key)).toBe(value);
      expect([...stopUrl.searchParams.keys()].sort()).toEqual(
        ["mode", "pubs", "sel", ...(key ? [key] : [])].sort(),
      );
    }
  });
});
