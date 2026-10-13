// @vitest-environment jsdom

// F-33: the Night Mode card kept showing a revoked member the route.
//
// Every plan surface upgrades itself through the capability-gated
// GET /api/plans/[id], and a read that comes back as the PREVIEW is an ANSWER
// (#1521): it takes the route back down. This card only ever tested for
// `stops`, which a preview body has none of, so the branch was skipped and the
// route and the get-in report it had already fetched stayed on screen after the
// capability was revoked. The server withheld the data; the client did not.

import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PLAN = "11111111-1111-4111-8111-111111111111";

const capability = vi.hoisted(() => ({ token: "member-token" }));

vi.mock("next/navigation", () => ({ usePathname: () => "/tonight" }));
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

import { getLateFoodForArea } from "@/lib/lateFood";
import { markActivePlan, setActivePlanStopIndex } from "@/lib/activePlan";
import { loadSlimVenues } from "@/lib/venuesSlim";
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
  localStorage.clear();
  markActivePlan(PLAN, new Date().toISOString());
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
  it("opens Get home after confirmed stops under Strict Mode", async () => {
    setActivePlanStopIndex(2);
    planBody = {
      ...memberBody,
      stops: [...memberBody.stops, { venueId: "v-crown", venueName: "The Crown", position: 3 }],
      actions: [
        { stopPosition: 1, type: "arrived" },
        { stopPosition: 2, type: "skipped" },
        { stopPosition: 3, type: "skipped" },
      ],
    };
    await act(async () => root.render(createElement(StrictMode, null, createElement(NightModeCard))));
    await settle();
    expect(container.querySelector(".nightCard__loading")).toBeNull();
    const review = container.querySelector<HTMLButtonElement>('.routeEndingCard__choice[data-ending="get_home"]');
    expect(review).not.toBeNull();
    await act(async () => review!.click());
    await settle();
    expect(container.textContent).toContain("Confirm Get home ending");
    expect(vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url).endsWith("/complete") && init?.method === "POST")).toHaveLength(0);
    const confirmation = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Confirm Get home ending"))!;
    vi.mocked(fetch).mockImplementation(async (input) => String(input).endsWith("/complete")
      ? jsonResponse({ ...(planBody as object), plan: { ...memberBody.plan, status: "completed" }, ending: "get_home" })
      : routeAnswer(input));
    await act(async () => confirmation.click());
    await settle();
    const calls = vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url).endsWith("/complete") && init?.method === "POST");
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0]![1]!.body as string)).toMatchObject({ ending: "get_home", terminalVenueId: "v-crown", expectedRouteRevision: 1 });
    expect(container.textContent).toContain("Night complete");
  });

  it.each(["food", "get_home", "keep_going"] as const)("review regression: confirms %s only through a named action", async (ending) => {
    planBody = { ...memberBody, stops: [memberBody.stops[0]], context: { nightArea: "clapham" } };
    const food = getLateFoodForArea("clapham", [], { now: Date.parse("2026-07-16T23:00:00.000Z") })[0]!;
    const read = async (input: RequestInfo | URL) => String(input).includes("/api/late-food") ? jsonResponse({ terminals: [food] }) : routeAnswer(input);
    vi.mocked(fetch).mockImplementation(read);
    vi.mocked(loadSlimVenues).mockResolvedValueOnce([
      { id: "v-george", name: "The George", lat: 51.513, lng: -0.13, cheapestPrice: 6, kind: "pub" },
      { id: "v-stone", name: "The Stonhouse", lat: 51.514, lng: -0.13, cheapestPrice: 5, kind: "pub" },
    ] as Awaited<ReturnType<typeof loadSlimVenues>>);
    await act(async () => root.render(createElement(NightModeCard)));
    await settle();
    const review = container.querySelector<HTMLButtonElement>(`.routeEndingCard__choice[data-ending="${ending}"]`)!;
    await act(async () => review.click());
    await settle();
    expect(vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url).endsWith("/complete") && init?.method === "POST")).toHaveLength(0);
    const label = ending === "keep_going" ? "Confirm Keep going to The Stonhouse"
      : ending === "food" ? `Confirm food ending with ${food.name}` : "Confirm Get home ending";
    const confirmation = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes(label))!;
    expect(confirmation.textContent).toContain(label);
    expect(confirmation.getAttribute("aria-label") ?? confirmation.textContent?.trim()).toBe(label);
    if (ending === "keep_going") expect(confirmation.textContent).toContain("hours not checked");
    vi.mocked(fetch).mockImplementation(async (input) => String(input).endsWith("/complete")
      ? jsonResponse({ ...(planBody as object), plan: { ...memberBody.plan, status: "completed" }, ending })
      : read(input));
    await act(async () => confirmation.click());
    await settle();
    const calls = vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url).endsWith("/complete") && init?.method === "POST");
    expect(calls).toHaveLength(1);
    expect(container.textContent).toContain("Night complete");
    expect(JSON.parse(calls[0]![1]!.body as string)).toMatchObject({ ending, terminalVenueId: "v-george", endingSelection: { kind: ending, ...(ending === "keep_going" ? { venueId: "v-stone" } : ending === "food" ? { optionId: food.id } : {}) } });
  });

  it("puts the route and the get-in report down when a read answers the preview", async () => {
    await act(async () => {
      root.render(createElement(NightModeCard));
    });
    await settle();

    expect(container.querySelector(".nightCard__now")?.textContent).toBe("The George");
    expect(container.querySelector(".nightCard__busy")?.textContent).toContain("Busy right now");
    expect(container.querySelector(".nightCard__loading")).toBeNull();

    // The capability is revoked, so the read that follows it answers preview.
    planBody = previewBody;
    capability.token = "";
    await act(async () => {
      window.dispatchEvent(new Event(`pubmax:plan-capability:${PLAN}`));
    });
    await settle();

    expect(container.querySelector(".nightCard__now")).toBeNull();
    expect(container.querySelector(".nightCard__busy")).toBeNull();
    expect(container.querySelector(".nightCard__loading")).toBeNull();
    expect(container.querySelector(".nightCard__routeEmpty")).not.toBeNull();
    expect(container.textContent).toContain("Tonight's route isn't open here yet.");
  });
});
