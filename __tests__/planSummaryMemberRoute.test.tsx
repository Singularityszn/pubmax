// @vitest-environment jsdom

// F-32 THE PREVIEW ASK IS LATCHED. `loadingPreview` is rendered state, so it
// lags the click that set it, and two taps in one task both POSTed
// /api/plans/generate; on an anchored plan both then reached
// `writePendingRoute`. This is the shape M03 already fixed on the save path.
//
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const capability = vi.hoisted(() => ({ token: "member-token", role: "host" as "host" | "guest" }));

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
// The children are not what these two rules are about; the route list is.
vi.mock("@/components/plan/PlanRoute", () => ({
  default: ({ stops }: { stops: ReadonlyArray<{ venueId: string; venueName: string }> }) =>
    createElement(
      "ol",
      { "data-testid": "plan-route" },
      stops.map((stop) => createElement("li", { key: stop.venueId }, stop.venueName)),
    ),
}));
vi.mock("@/components/plan/PlanCollaborationPanel", () => ({ default: () => null }));
vi.mock("@/components/round/RoundStarter", () => ({ default: () => null }));

import PlanSummary from "@/components/plan/PlanSummary";
import { PLAN_PENDING_ROUTE_PREFIX } from "@/components/plan/PlanSummary";
import type { PlanPrivacyPreviewDTO } from "@/lib/planPrivacy";

const PLAN = "6ab5ca40-836b-4970-9477-d1779fdd31ab";

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

function memberState(stopNames: readonly string[], routeRevision: number) {
  return {
    plan: {
      id: PLAN,
      title: "Thursday, sorted",
      startTime: "2026-07-16T17:30:00.000Z",
      createdAt: "2026-07-11T12:00:00.000Z",
      routeRevision,
    },
    stops: stopNames.map((venueName, index) => ({
      venueId: `v-${venueName.toLowerCase().replace(/\W+/g, "-")}`,
      venueName,
      position: index + 1,
    })),
    crew: [],
    context: { nightArea: "soho", stopCount: 3 },
  };
}

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    body: null,
  } as unknown as Response;
}

function renderedStops(): string[] {
  return Array.from(container.querySelectorAll('[data-testid="plan-route"] li'))
    .map((row) => row.textContent ?? "");
}

function editControl(): HTMLButtonElement {
  const control = container.querySelector<HTMLButtonElement>("button.planSummary__edit");
  if (!control) throw new Error("the route edit control did not render");
  return control;
}

beforeEach(() => {
  capability.token = "member-token";
  capability.role = "host";
  window.localStorage.removeItem(`${PLAN_PENDING_ROUTE_PREFIX}${PLAN}`);
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

async function mountWithMemberRead(state: unknown): Promise<void> {
  await act(async () => {
    root.render(createElement(PlanSummary, { planId: PLAN, initialPreview: preview }));
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(renderedStops().length).toBeGreaterThan(0);
  void state;
}

describe("the route preview ask", () => {
  it("spends one generate request when the control is tapped twice in one task", async () => {
    const generate = vi.fn().mockResolvedValue(jsonResponse({ stops: [], alternatives: [] }));
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/plans/generate")) return generate(url);
      return Promise.resolve(jsonResponse(memberState(["The George", "The Swan", "The Crown"], 1)));
    });
    vi.stubGlobal("fetch", fetchMock);

    await mountWithMemberRead(null);

    const control = editControl();
    await act(async () => {
      control.click();
      control.click();
      await Promise.resolve();
    });

    expect(generate).toHaveBeenCalledTimes(1);
  });
});
