// @vitest-environment jsdom

// F-33: the Night Mode card kept showing a revoked member the route.
//
// Every plan surface upgrades itself through the capability-gated
// GET /api/plans/[id], and a read that comes back as the PREVIEW is an ANSWER
// (#1521): it takes the route back down. This card only ever tested for
// `stops`, which a preview body has none of, so the branch was skipped and the
// route and the get-in report it had already fetched stayed on screen after the
// capability was revoked. The server withheld the data; the client did not.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PLAN = "11111111-1111-4111-8111-111111111111";

const capability = vi.hoisted(() => ({ token: "member-token" }));

vi.mock("next/navigation", () => ({ usePathname: () => "/tonight" }));
vi.mock("@/components/night/useActivePlan", () => ({
  useActivePlan: () => ({ ref: { id: PLAN, stopIndex: 0 } }),
}));
vi.mock("@/lib/nightModeHandoff", () => ({
  useNightModeEndingOwner: () => ({ expanded: true, open: vi.fn(), collapse: vi.fn() }),
}));
vi.mock("@/lib/planSessionCapability", () => ({
  parsePlanCapabilitySnapshot: () => ({
    token: capability.token,
    collaborationAuthorized: true,
    role: "host",
  }),
  planCapabilityEvent: (id: string) => `pubmax:plan-capability:${id}`,
  readPlanCapabilitySnapshot: () => `${capability.token}|1|host`,
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

const memberBody = {
  plan: {
    id: PLAN,
    title: "Tonight",
    startTime: "2026-07-13T19:00:00.000Z",
    createdAt: "2026-07-13T12:00:00.000Z",
    routeRevision: 1,
    status: "active",
  },
  stops: [
    { venueId: "v-george", venueName: "The George", position: 1 },
    { venueId: "v-swan", venueName: "The Swan", position: 2 },
  ],
  crew: [],
};

const getInBody = {
  planId: PLAN,
  stops: [
    {
      venueId: "v-george",
      busyness: { level: "busy", label: "Busy right now", isOpen: true },
    },
  ],
};

// What the server answers a reader whose capability has gone.
const previewBody = {
  visibility: "preview",
  hostDisplayName: "Sam",
  areaName: "Soho",
  startLabel: "19:00",
  stopCount: 2,
  vibeLabel: null,
  accessibilitySummary: null,
  routeReady: true,
};

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
let planBody: unknown = memberBody;

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body, body: null } as unknown as Response;
}

function routeAnswer(input: RequestInfo | URL): Promise<Response> {
  const url = String(input);
  if (url.includes("/getin")) return Promise.resolve(jsonResponse(getInBody));
  if (url.includes(`/api/plans/${PLAN}`)) return Promise.resolve(jsonResponse(planBody));
  if (url.includes("/api/late-food")) return Promise.resolve(jsonResponse({ terminals: [] }));
  return Promise.resolve(jsonResponse({}));
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  capability.token = "member-token";
  planBody = memberBody;
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

describe("the Night Mode card and a revoked capability", () => {
  it("puts the route and the get-in report down when a read answers the preview", async () => {
    await act(async () => {
      root.render(createElement(NightModeCard));
    });
    await settle();

    expect(container.querySelector("[class*='nightCardNow']")?.textContent).toBe("The George");
    expect(container.querySelector("[class*='nightCardBusy']")?.textContent).toContain("Busy right now");
    expect(container.querySelector("[class*='nightCardLoading']")).toBeNull();

    // The capability is revoked, so the read that follows it answers preview.
    planBody = previewBody;
    capability.token = "";
    await act(async () => {
      window.dispatchEvent(new Event(`pubmax:plan-capability:${PLAN}`));
    });
    await settle();

    expect(container.querySelector("[class*='nightCardNow']")).toBeNull();
    expect(container.querySelector("[class*='nightCardBusy']")).toBeNull();
    expect(container.querySelector("[class*='nightCardLoading']")).not.toBeNull();
  });
});
