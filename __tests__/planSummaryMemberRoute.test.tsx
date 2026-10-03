// @vitest-environment jsdom

// Two rules about the route a member is looking at.
//
// F-32 THE PREVIEW ASK IS LATCHED. `loadingPreview` is rendered state, so it
// lags the click that set it, and two taps in one task both POSTed
// /api/plans/generate; on an anchored plan both then reached
// `writePendingRoute`. This is the shape M03 already fixed on the save path.
//
// F-30 A FRESHER CANONICAL IS ADOPTED. `PlanSummaryMember` seeded its route
// from props once, so the second member read #1521 was written to add - the one
// the capability landing fires - was dropped on the floor: a route another
// device had just saved arrived in `state` and never reached the screen, and
// the editor then PATCHed with a stale `expectedRouteRevision`.

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
  default: ({ stops }: { stops: ReadonlyArray<{ venueId: string; venueName: string; selectedDrinkPriceEvidence?: { category: string; pence: number } }> }) =>
    createElement(
      "ol",
      { "data-testid": "plan-route" },
      stops.map((stop) => createElement("li", { key: stop.venueId },
        stop.venueName,
        stop.selectedDrinkPriceEvidence
          ? createElement("span", { "data-testid": "saved-drink-price" }, `${stop.selectedDrinkPriceEvidence.category}:${stop.selectedDrinkPriceEvidence.pence}`)
          : null)),
    ),
}));
vi.mock("@/components/plan/PlanCollaborationPanel", () => ({ default: ({ draftStops }: { draftStops: unknown[] }) => createElement("pre", { "data-testid": "proposal-draft" }, JSON.stringify(draftStops)) }));
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

function memberState(
  stopNames: readonly string[],
  routeRevision: number,
  drinkPreference: { drinkCategory?: string | null; zeroProof?: boolean } = {},
) {
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
    context: { nightArea: "soho", stopCount: 3, ...drinkPreference },
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

describe("saved route start time", () => {
  it.each([
    [{ drinkCategory: "wine" }, "First stop · 18:30"],
    [{ drinkCategory: "cocktail" }, "First stop · 18:30"],
    [{ drinkCategory: "whisky" }, "First stop · 18:30"],
    [{ zeroProof: true }, "First stop · 18:30"],
    [{ drinkCategory: "beer" }, "First pint · 18:30"],
    [{}, "First pint · 18:30"],
  ])("shows %j as %s", async (drinkPreference, expected) => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse(memberState(
      ["The George", "The Swan", "The Crown"], 1, drinkPreference,
    )))));

    await mountWithMemberRead(null);

    expect(container.querySelector(".planPage__eyebrow")?.textContent).toBe(expected);
  });
});

describe("member selected drink prices", () => {
  it("passes saved wine evidence into the guest proposal draft", async () => {
    capability.role = "guest";
    const state = memberState(["The George", "The Swan", "The Crown"], 1, { drinkCategory: "wine" });
    const evidence = { category: "wine", pence: 550, serving: null, source: "community", reportedAt: "2026-09-25T12:00:00.000Z" };
    state.stops[0] = { ...state.stops[0], selectedDrinkPriceEvidence: evidence } as typeof state.stops[number];
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse(state))));

    await mountWithMemberRead(null);

    const draft = JSON.parse(container.querySelector('[data-testid="proposal-draft"]')?.textContent ?? "[]") as Array<{ selectedDrinkPriceEvidence?: unknown }>;
    expect(draft[0]?.selectedDrinkPriceEvidence).toEqual(evidence);
  });

  it("passes saved wine evidence from member read to route display", async () => {
    const state = memberState(["The George", "The Swan", "The Crown"], 1, { drinkCategory: "wine" });
    state.stops[0] = { ...state.stops[0], selectedDrinkPriceEvidence: {
      category: "wine", pence: 550, serving: null, source: "community", reportedAt: "2026-09-25T12:00:00.000Z",
    } } as typeof state.stops[number];
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse(state))));

    await mountWithMemberRead(null);

    expect(container.querySelector('[data-testid="saved-drink-price"]')?.textContent).toBe("wine:550");
  });
});

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

describe("a fresher canonical route", () => {
  it("replaces the seeded stops when a later member read carries a newer revision", async () => {
    let planBody: unknown = memberState(["The George", "The Swan", "The Crown"], 1);
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse(planBody))));

    await mountWithMemberRead(null);
    expect(renderedStops()).toEqual(["The George", "The Swan", "The Crown"]);

    // The capability lands, which is what fires read 2 (#1521), and the route
    // another device saved in between comes back with a newer revision.
    planBody = memberState(["The George", "The Lamb", "The Crown"], 2);
    capability.token = "member-token-rotated";
    await act(async () => {
      window.dispatchEvent(new Event(`pubmax:plan-capability:${PLAN}`));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(renderedStops()).toEqual(["The George", "The Lamb", "The Crown"]);
  });

  it("leaves an open editor's draft alone while a later read lands", async () => {
    let planBody: unknown = memberState(["The George", "The Swan", "The Crown"], 1);
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/plans/generate")) {
        return Promise.resolve(jsonResponse({
          stops: [
            { venueId: "v-the-george", venueName: "The George" },
            { venueId: "v-the-swan", venueName: "The Swan" },
            { venueId: "v-the-crown", venueName: "The Crown" },
          ],
          alternatives: [[], [{ venueId: "v-the-bell", venueName: "The Bell" }], []],
        }));
      }
      return Promise.resolve(jsonResponse(planBody));
    });
    vi.stubGlobal("fetch", fetchMock);

    await mountWithMemberRead(null);
    await act(async () => {
      editControl().click();
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector(".planSummary__editor")).not.toBeNull();

    planBody = memberState(["The George", "The Lamb", "The Crown"], 2);
    capability.token = "member-token-rotated";
    await act(async () => {
      window.dispatchEvent(new Event(`pubmax:plan-capability:${PLAN}`));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // The editor is still the reader's own working copy.
    expect(container.querySelector(".planSummary__editor")).not.toBeNull();
  });
});

describe("saved named Stop 1 refresh request", () => {
  // Synthetic saved member-state boundary, not a fresh publisher observation.
  const namedEvidence = {
    category: "wine",
    pence: 550,
    serving: "125ml",
    source: "listed",
    sourceUrl: "https://pub.example/menu",
    observedAt: "2026-09-29T10:40:17.846Z",
    drinkLabel: "Chardonnay, Pays D’oc, France",
    drinkSubtype: "wine-white",
  } as const;

  it.each([
    { label: "named White wine", selectedEvidence: namedEvidence },
    { label: "generic wine control", selectedEvidence: undefined },
  ])("keeps $label intent in the actual Edit generation POST", async ({ selectedEvidence }) => {
    const saved = memberState(["The George", "The Swan", "The Crown"], 7, { drinkCategory: "wine" });
    const anchorVenueId = saved.stops[0].venueId;
    const state = {
      ...saved,
      context: { ...saved.context, nightArea: "piccadilly-soho" },
      plan: { ...saved.plan, anchorVenueId, anchorSource: "map-search" },
      stops: saved.stops.map((stop, index) => ({
        ...stop,
        ...(index === 0 && selectedEvidence ? { selectedDrinkPriceEvidence: selectedEvidence } : {}),
      })),
    };
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/plans/generate") {
        // Only inspect the outgoing request. A controlled refusal avoids
        // inventing generation authority or persisting a pending route.
        return Promise.resolve({
          ...jsonResponse({ error: "Controlled generation refusal." }),
          ok: false,
          status: 503,
        });
      }
      expect(init?.method ?? "GET").toBe("GET");
      expect(String(input)).toBe(`/api/plans/${PLAN}`);
      return Promise.resolve(jsonResponse(state));
    });
    vi.stubGlobal("fetch", fetchMock);

    await mountWithMemberRead(state);
    expect(renderedStops()).toEqual([
      selectedEvidence ? "The Georgewine:550" : "The George",
      "The Swan",
      "The Crown",
    ]);
    const control = editControl();
    expect(control.disabled).toBe(false);
    await act(async () => {
      control.click();
      await Promise.resolve();
    });

    const generationRequests = fetchMock.mock.calls.filter(([input]) => String(input) === "/api/plans/generate");
    expect(generationRequests).toHaveLength(1);
    const request = generationRequests[0][1];
    expect(request).toMatchObject({ method: "POST", headers: { "content-type": "application/json" } });
    expect(JSON.parse(String(request?.body))).toEqual({
      context: state.context,
      cityId: "london",
      anchor: {
        venueId: anchorVenueId, source: "map-search", acceptedArea: null, startsAt: state.plan.startTime,
        ...(selectedEvidence ? { selectedDrinkPriceEvidence: namedEvidence } : {}),
      },
    });
    expect(window.localStorage.getItem(`${PLAN_PENDING_ROUTE_PREFIX}${PLAN}`)).toBeNull();
  });
});

describe("saved refresh anchor evidence boundaries", () => {
  const evidence = {
    category: "wine", pence: 550, serving: "125ml", source: "listed",
    sourceUrl: "https://pub.example/menu", observedAt: "2026-09-29T10:40:17.846Z",
    drinkLabel: "Chardonnay, Pays D’oc, France", drinkSubtype: "wine-white",
  } as const;

  it.each([
    { label: "ordered Stop 1 despite reversed DTO array", anchorIndex: 0, expectEvidence: true },
    { label: "different anchor from ordered Stop 1", anchorIndex: 1, expectEvidence: false },
    { label: "no anchor", anchorIndex: null, expectEvidence: false },
  ])("qualifies $label without borrowing another stop's quote", async ({ anchorIndex, expectEvidence }) => {
    // Direct DTO controls complement the mounted POST cases above. They do not
    // prove browser rendering, server approval or persistence of these fixtures.
    const { planSummaryGenerationBody } = await import("@/components/plan/PlanSummary");
    const saved = memberState(["The George", "The Swan", "The Crown"], 7, { drinkCategory: "wine" });
    const anchorVenueId = anchorIndex === null ? null : saved.stops[anchorIndex].venueId;
    const state = {
      ...saved,
      context: { ...saved.context, nightArea: "piccadilly-soho" },
      plan: { ...saved.plan, anchorVenueId, anchorSource: anchorVenueId ? "map-search" : null },
      stops: saved.stops.map((stop, index) => ({
        ...stop,
        ...(index === 0 ? { selectedDrinkPriceEvidence: evidence } : {}),
      })).reverse(),
    };
    const before = JSON.stringify(state);
    expect(planSummaryGenerationBody(state as unknown as import("@/lib/plan").PlanState)).toEqual({
      context: state.context,
      cityId: "london",
      ...(anchorVenueId ? { anchor: {
        venueId: anchorVenueId, source: "map-search", acceptedArea: null, startsAt: state.plan.startTime,
        ...(expectEvidence ? { selectedDrinkPriceEvidence: evidence } : {}),
      } } : {}),
    });
    expect(JSON.stringify(state)).toBe(before);
  });
});
