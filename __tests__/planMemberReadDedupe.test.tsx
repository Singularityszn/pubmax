// @vitest-environment jsdom

// F-34: one plan page issued the same capability-gated GET two or three times.
//
// Three surfaces ask `/api/plans/[id]` about one Plan - the route, the crew and
// the Night Mode card - and each held its own request, once at mount and again
// each time the capability landed. The sibling change in the same commit gave
// the invite token a shared per-plan `inFlight` map for exactly this reason
// (`lib/planInviteTokenClient.ts`), and the member read is the heavier call.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PLAN = "6ab5ca40-836b-4970-9477-d1779fdd31ab";

const capability = vi.hoisted(() => ({ token: "member-token" }));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ user: null, session: null, identityResolved: true }),
}));
vi.mock("@/lib/activePlan", () => ({
  markActivePlan: vi.fn(),
  setActivePlanRole: vi.fn(),
}));
vi.mock("@/lib/analytics", () => ({
  trackEvent: vi.fn(),
  trackMeaningfulCoreAction: vi.fn(),
}));
vi.mock("@/lib/authRedirect", () => ({
  subscribeToAuthFragmentRestored: vi.fn(() => () => {}),
}));
vi.mock("@/lib/crewRealtime", () => ({ subscribeToPlanCrew: vi.fn(() => () => {}) }));
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
vi.mock("@/components/plan/PlanRoute", () => ({ default: () => null }));
vi.mock("@/components/plan/PlanCollaborationPanel", () => ({ default: () => null }));
vi.mock("@/components/round/RoundStarter", () => ({ default: () => null }));

import PlanCrew from "@/components/plan/PlanCrew";
import PlanSummary from "@/components/plan/PlanSummary";
import { clearPlanMemberProjectionRead } from "@/components/plan/usePlanMemberRead";
import type { PlanPrivacyPreviewDTO } from "@/lib/planPrivacy";

const preview: PlanPrivacyPreviewDTO = {
  visibility: "preview",
  hostDisplayName: "Sam",
  areaName: "Soho",
  startLabel: "18:30",
  stopCount: 3,
  vibeLabel: null,
  accessibilitySummary: null,
  routeReady: true,
};

const memberBody = {
  plan: {
    id: PLAN,
    title: "Thursday, sorted",
    startTime: "2026-07-16T17:30:00.000Z",
    createdAt: "2026-07-11T12:00:00.000Z",
    routeRevision: 1,
  },
  stops: [
    { venueId: "v-george", venueName: "The George", position: 1 },
    { venueId: "v-swan", venueName: "The Swan", position: 2 },
    { venueId: "v-crown", venueName: "The Crown", position: 3 },
  ],
  crew: [{ id: "c-1", name: "Sam", status: "in" }],
};

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
let planReads = 0;

function planFetch(input: RequestInfo | URL): Promise<Response> {
  const url = String(input);
  if (url === `/api/plans/${PLAN}`) planReads += 1;
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => memberBody,
    body: null,
  } as unknown as Response);
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  planReads = 0;
  capability.token = "member-token";
  clearPlanMemberProjectionRead(PLAN);
  vi.stubGlobal("fetch", vi.fn(planFetch));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  clearPlanMemberProjectionRead(PLAN);
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("the member read on one plan page", () => {
  it("costs one request across the route and the crew, and one more per capability change", async () => {
    await act(async () => {
      root.render(createElement(
        "div",
        null,
        createElement(PlanSummary, { planId: PLAN, initialPreview: preview }),
        createElement(PlanCrew, { planId: PLAN, hostName: "Sam" }),
      ));
    });
    await settle();

    expect(planReads).toBe(1);

    capability.token = "member-token-rotated";
    await act(async () => {
      window.dispatchEvent(new Event(`pubmax:plan-capability:${PLAN}`));
    });
    await settle();

    expect(planReads).toBe(2);
  });
});
