// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authedActionFetch: vi.fn(),
  trackEvent: vi.fn(),
}));

vi.mock("@/lib/analytics", () => ({ trackEvent: mocks.trackEvent }));
vi.mock("@/lib/authedFetch", () => ({ authedActionFetch: mocks.authedActionFetch }));
vi.mock("@/lib/crewRealtime", () => ({ subscribeToPlanCrew: () => () => {} }));
vi.mock("@/lib/identityNudge", () => ({
  isIdentityNudgePending: () => true,
  recordPlanNudgeTrigger: vi.fn(),
}));
vi.mock("@/lib/lastCrew", () => ({ rememberLastCrew: vi.fn() }));
vi.mock("@/lib/nativePushPrompt", () => ({ recordPlanHighIntentAction: vi.fn() }));
vi.mock("@/lib/authRedirect", () => ({ subscribeToAuthFragmentRestored: () => () => {} }));
vi.mock("@/lib/planMutationKey", () => ({
  clearPersistentPlanMutationKey: vi.fn(),
  persistentPlanMutationKey: async () => "join-operation-key",
}));
vi.mock("@/lib/planPrivacy", () => ({ planRouteReady: () => true }));
vi.mock("@/lib/planSessionCapability", () => ({
  parsePlanCapabilitySnapshot: () => ({
    token: "",
    collaborationAuthorized: false,
    role: null,
  }),
  planCapabilityEvent: (planId: string) => `plan-capability:${planId}`,
  readPlanCapabilitySnapshot: () => "|0|",
  restorePlanCapability: async () => {},
  writePlanCapability: vi.fn(),
}));

import PlanCrew from "@/components/plan/PlanCrew";

const PLAN_ID = "11111111-1111-4111-8111-111111111111";
const INVITE_TOKEN = "0123456789abcdef0123456789abcdef";
const crew = ["Host", "Guest", "Sam", "Alex"].map((name, index) => ({
  id: `member-${index}`,
  name,
  status: "in",
  joinedAt: `2026-07-24T12:0${index}:00.000Z`,
  updatedAt: `2026-07-24T12:0${index}:00.000Z`,
}));

let container: HTMLDivElement;
let root: Root;

async function join(responseBody: Record<string, unknown>): Promise<void> {
  mocks.authedActionFetch.mockResolvedValue(new Response(JSON.stringify(responseBody), {
    status: 200,
    headers: { "content-type": "application/json" },
  }));
  await act(async () => {
    root.render(createElement(PlanCrew, { planId: PLAN_ID, hostName: "Host" }));
    await Promise.resolve();
  });
  const input = container.querySelector<HTMLInputElement>("#join-name");
  const form = container.querySelector<HTMLFormElement>("form");
  if (!input || !form) throw new Error("join form did not render");
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(input, "Guest");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState(null, "", `/plan/${PLAN_ID}#invite=${INVITE_TOKEN}`);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({}), {
    status: 200,
    headers: { "content-type": "application/json" },
  })));
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

describe("Plan crew threshold analytics", () => {
  it("does not track crew_committed without a verified threshold token", async () => {
    await join({
      memberToken: "member-token",
      collaborationAuthorized: false,
      friendEdgesFormed: 0,
      plan: { plan: { id: PLAN_ID }, crew },
    });

    expect(
      mocks.trackEvent.mock.calls.some(([name]) => name === "crew_committed"),
    ).toBe(false);
  });

  it("tracks the fixed threshold count when the server returns a token", async () => {
    await join({
      memberToken: "member-token",
      collaborationAuthorized: false,
      crewCommitted: "verified-threshold-token",
      friendEdgesFormed: 0,
      plan: { plan: { id: PLAN_ID }, crew },
    });

    expect(mocks.trackEvent).toHaveBeenCalledWith(
      "crew_committed",
      { source: "shared-plan", participants: 2, routeReady: true },
      { deliveryToken: "verified-threshold-token" },
    );
  });

  it("tracks Route readiness frozen by the threshold transaction", async () => {
    await join({
      memberToken: "member-token",
      collaborationAuthorized: false,
      crewCommitted: "verified-threshold-token",
      crewCommittedRouteReady: false,
      friendEdgesFormed: 0,
      plan: { plan: { id: PLAN_ID }, crew },
    });

    expect(mocks.trackEvent).toHaveBeenCalledWith(
      "crew_committed",
      { source: "shared-plan", participants: 2, routeReady: false },
      { deliveryToken: "verified-threshold-token" },
    );
  });
});
