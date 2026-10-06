// @vitest-environment jsdom

// F04: a locked plan's "Open on the map" and Night Mode's stop and ending links
// named the pub in `?venue=`, which the Map never reads, so the Map opened on
// whatever it held last. Each link must name the pub in `sel`.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PLAN = "11111111-1111-4111-8111-111111111111";

vi.mock("next/navigation", () => ({ usePathname: () => "/tonight" }));
vi.mock("@/components/plan/PlanRouteMiniMap", () => ({ default: () => null }));
vi.mock("@/components/night/useActivePlan", () => ({
  useActivePlan: () => ({ ref: { id: PLAN, stopIndex: 0 } }),
}));
vi.mock("@/lib/nightModeHandoff", () => ({
  useNightModeEndingOwner: () => ({ expanded: true, open: vi.fn(), collapse: vi.fn() }),
}));
vi.mock("@/lib/planSessionCapability", () => ({
  parsePlanCapabilitySnapshot: () => ({
    token: "member-token",
    collaborationAuthorized: true,
    role: "host",
  }),
  planCapabilityEvent: (id: string) => `pubmax:plan-capability:${id}`,
  readPlanCapabilitySnapshot: () => "member-token|1|host",
  restorePlanCapability: vi.fn().mockResolvedValue(null),
  writePlanCapability: vi.fn(),
}));
vi.mock("@/lib/venuesSlim", () => ({ loadSlimVenues: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/analytics", () => ({
  trackEvent: vi.fn(),
  trackMeaningfulCoreAction: vi.fn(),
}));
vi.mock("@/components/loop/useLoopMoment", () => ({ useLoopMoment: vi.fn() }));
vi.mock("@/lib/planRecapSync.client", () => ({
  PENDING_PLAN_RECAP_SYNC_DEBOUNCE_MS: 1_000,
  preferFresherPendingPlanRecap: (value: unknown) => value,
  syncPendingPlanRecapToAccount: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/authedFetch", () => ({ authedActionFetch: vi.fn() }));

import NightModeCard from "@/components/night/NightModeCard";
import PlanRoute from "@/components/plan/PlanRoute";

const lastStopKeptGoing = {
  plan: {
    id: PLAN,
    title: "Tonight",
    startTime: "2026-07-13T19:00:00.000Z",
    createdAt: "2026-07-13T12:00:00.000Z",
    routeRevision: 1,
    status: "active",
  },
  stops: [{ venueId: "v-george", venueName: "The George", position: 1 }],
  crew: [],
  ending: "keep_going",
};

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body, body: null } as unknown as Response;
}

function routeAnswer(input: RequestInfo | URL): Promise<Response> {
  const url = String(input);
  if (url.includes("/getin")) return Promise.resolve(jsonResponse({ planId: PLAN, stops: [] }));
  if (url.includes(`/api/plans/${PLAN}`)) return Promise.resolve(jsonResponse(lastStopKeptGoing));
  if (url.includes("/api/late-food")) return Promise.resolve(jsonResponse({ terminals: [] }));
  return Promise.resolve(jsonResponse({}));
}

function hrefOf(host: ParentNode, selector: string, text: string): string | null {
  const link = Array.from(host.querySelectorAll<HTMLAnchorElement>(selector)).find((anchor) =>
    anchor.textContent?.includes(text),
  );
  return link?.getAttribute("href") ?? null;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(routeAnswer));
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

describe("Map links from a plan stop", () => {
  it("opens each locked-plan stop on the Map through sel", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(createElement(PlanRoute, {
      planId: PLAN,
      startTime: "2026-09-30T18:00:00.000Z",
      stops: [
        { venueId: "v-george", venueName: "The George", position: 0 },
        { venueId: "v-swan", venueName: "The Swan", position: 1 },
      ],
    }));

    const hrefs = Array.from(host.querySelectorAll<HTMLAnchorElement>("a"))
      .filter((anchor) => anchor.textContent === "Open on the map")
      .map((anchor) => anchor.getAttribute("href"));
    expect(hrefs).toEqual(["/map?sel=v-george", "/map?sel=v-swan"]);
  });

  it("opens Night Mode's stop and its keep-going ending on the Map through sel", async () => {
    await act(async () => {
      root.render(createElement(NightModeCard));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector(".nightCard__now")?.textContent).toBe("The George");
    expect(hrefOf(container, ".nightCard__logBtn", "Log this pint")).toBe("/map?sel=v-george");
    expect(hrefOf(container, ".nightCard__endingLink", "Find nearby pubs")).toBe(
      "/map?sel=v-george",
    );
  });
});
