// @vitest-environment jsdom

// The browser half of the per-night metric: PlanCrew sends `crew_committed`
// only for the join the server marked as the night's first commitment. It used
// to send one on every join, so a plan that reached four people reported three
// crew nights (issue #1253).
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { trackEvent, authedActionFetch } = vi.hoisted(() => ({
  trackEvent: vi.fn(),
  authedActionFetch: vi.fn(),
}));

vi.mock("@/lib/analytics", () => ({ trackEvent }));
vi.mock("@/lib/authedFetch", () => ({ authedActionFetch }));
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ identityResolved: true }),
}));
vi.mock("@/lib/crewRealtime", () => ({ subscribeToPlanCrew: () => () => {} }));
vi.mock("@/lib/authRedirect", () => ({ subscribeToAuthFragmentRestored: () => () => {} }));
vi.mock("@/lib/identityNudge", () => ({
  isIdentityNudgePending: () => false,
  recordPlanNudgeTrigger: () => {},
}));
vi.mock("@/lib/lastCrew", () => ({ rememberLastCrew: () => {} }));
vi.mock("@/lib/nativePushPrompt", () => ({ recordPlanHighIntentAction: () => {} }));
vi.mock("@/lib/planMutationKey", () => ({
  persistentPlanMutationKey: async () => "join-key",
  clearPersistentPlanMutationKey: () => {},
}));
vi.mock("@/lib/planSessionCapability", () => ({
  parsePlanCapabilitySnapshot: () => ({ token: "", collaborationAuthorized: false, role: null }),
  planCapabilityEvent: (planId: string) => `pubmax:plan-capability:${planId}`,
  readPlanCapabilitySnapshot: () => "|0|",
  restorePlanCapability: async () => {},
  writePlanCapability: () => {},
}));

import PlanCrew from "@/components/plan/PlanCrew";

function crewCommittedCalls(): unknown[][] {
  return trackEvent.mock.calls.filter(([name]) => name === "crew_committed");
}

const PLAN_ID = "11111111-1111-4111-8111-111111111111";
const INVITE = "0123456789abcdef0123456789abcdef";

let root: Root;
let container: HTMLDivElement;

function crewOf(size: number) {
  return Array.from({ length: size }, (_unused, index) => ({
    id: `member-${index}`,
    name: `Member ${index}`,
    status: "in",
    joinedAt: "2026-08-21T18:00:00.000Z",
    updatedAt: "2026-08-21T18:00:00.000Z",
  }));
}

function joinAnswer(crewSize: number, crewCommitted?: string) {
  return {
    ok: true,
    json: async () => ({
      memberToken: "member-token",
      collaborationAuthorized: false,
      ...(crewCommitted ? { crewCommitted } : {}),
      plan: {
        plan: { id: PLAN_ID, title: "Friday", startTime: "2026-08-21T19:00:00.000Z", createdAt: "2026-08-20T10:00:00.000Z" },
        stops: [],
        crew: crewOf(crewSize),
      },
    }),
  } as unknown as Response;
}

async function submitJoin() {
  const form = container.querySelector("form.planCrew__join");
  const input = container.querySelector<HTMLInputElement>("#join-name");
  if (!form || !input) throw new Error("join form did not render");
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, "Guest");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  window.location.hash = `#invite=${INVITE}`;
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(PlanCrew, { planId: PLAN_ID, hostName: "Host" }));
    await Promise.resolve();
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  window.location.hash = "";
  vi.unstubAllGlobals();
});

describe("PlanCrew crew night beacon", () => {
  it("sends crew_committed for the join the server marked as the night", async () => {
    authedActionFetch.mockResolvedValue(joinAnswer(2, "night-token"));

    await submitJoin();

    expect(crewCommittedCalls()).toEqual([[
      "crew_committed",
      { source: "shared-plan", participants: 2, routeReady: false },
      { deliveryToken: "night-token" },
    ]]);
  });

  it("sends nothing for a join on a night already counted", async () => {
    authedActionFetch.mockResolvedValue(joinAnswer(3));

    await submitJoin();

    expect(crewCommittedCalls()).toEqual([]);
  });
});
