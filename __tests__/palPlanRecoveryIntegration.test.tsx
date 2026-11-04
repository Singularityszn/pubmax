// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => createElement("a", { href }, children) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/plan", useRouter: () => ({ push: () => undefined, replace: () => undefined }) }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: null, session: null, loading: false, identityResolved: true }) }));
vi.mock("@/components/plan/PlanRouteMiniMap", () => ({ default: () => null }));
vi.mock("@/components/wanted/WantedPlanChips", () => ({ default: () => null }));
vi.mock("@/lib/analytics", () => ({ trackEvent: () => undefined, trackMeaningfulCoreAction: () => undefined, laneSourceFromSearch: () => null }));

import PlanComposer from "@/components/plan/PlanComposer";
import { ASK_PLAN_DRAFT_STORAGE_KEY } from "@/lib/ask/types";
import { inferNightContext } from "@/lib/nightPlanning";
import { readPlanDraftEnvelope } from "@/lib/planDraft";
import { readPlanIntakeDraft } from "@/lib/planIntake";
import { writePlanningIntent } from "@/lib/planningIntent";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pubs = ["venue-a", "venue-b", "venue-c", "venue-d"];
const query = "Plan a night in Soho";
let root: Root | null = null;
let host: HTMLDivElement | null = null;
let requests: Array<Record<string, unknown>>;
let generate: (body: Record<string, unknown>) => Response | Promise<Response>;

function reply(ids: string[], outcome = "route", requestedCount = ids.length) {
  return new Response(JSON.stringify({
    outcome, anchored: true,
    stops: ids.map((venueId) => ({ venueId, venueName: venueId })),
    inferredContext: { ...inferNightContext(query).context, nightArea: "soho", stopCount: requestedCount },
    groundingProof: `${btoa(JSON.stringify({ v: 1, expiresAt: Date.now() + 3_600_000 }))}.test-signature`,
    operationKey: "draft-operation", routeRevision: 1,
    anchorVenueId: ids[0], anchorSource: "pal",
  }), { headers: { "content-type": "application/json" } });
}

beforeAll(async () => {
  await Promise.all([
    import("@/components/plan/PlanStopList"),
    import("@/components/plan/PlanTuneSheet"),
    import("@/components/plan/PlanResultProvenance"),
    import("@/components/plan/PlanBudgetLedger"),
    import("@/components/plan/PlanDryRoundLedger"),
  ]);
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-04T12:00:00Z"));
  sessionStorage.clear();
  localStorage.clear();
  requests = [];
  generate = () => reply(pubs);
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    if (String(input) === "/api/plans/generate") {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push(body);
      return generate(body);
    }
    return new Response(JSON.stringify([...pubs, "venue-held"].map((id) => ({ id, name: id, kind: "pub", lat: 51.514, lng: -0.132 }))),
      { headers: { "content-type": "application/json" } });
  }));
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  host?.remove();
  host = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
  sessionStorage.clear();
  localStorage.clear();
});

function seed(ask = query) {
  sessionStorage.setItem(ASK_PLAN_DRAFT_STORAGE_KEY, JSON.stringify({ query: ask, stopIds: pubs, stopNames: pubs, origin: "pal" }));
  window.history.replaceState({}, "", `/plan?query=${encodeURIComponent(ask)}`);
}

async function mount() {
  host = document.createElement("div");
  document.body.append(host);
  await act(async () => {
    root = createRoot(host!);
    root.render(createElement(PlanComposer));
  });
}

async function settleRoute() {
  await vi.waitFor(async () => {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(document.querySelectorAll(".planStop__name").length).toBeGreaterThan(0);
  }, { timeout: 4000 });
}

async function tune() {
  const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === "Tune details");
  if (button) await act(async () => button.click());
  await vi.waitFor(() => expect(document.querySelector("#plan-context-stops")).not.toBeNull());
}

it("keeps four drafted pubs without turning their inferred count into a user choice", async () => {
  seed();
  await mount();
  await settleRoute();
  expect(requests).toHaveLength(1);
  expect((requests[0]!.anchor as { venueIds: string[] }).venueIds).toEqual(pubs);
  expect([...document.querySelectorAll(".planStop__name")].map((node) => node.textContent)).toEqual(pubs);
  expect(readPlanIntakeDraft()?.answers.stopCountSource).toBeUndefined();
  expect(readPlanDraftEnvelope(sessionStorage)?.draft.requestedStopCountSource).toBeUndefined();
  await tune();
  expect(document.querySelector<HTMLSelectElement>("#plan-context-stops")!.value).toBe("4");
  await act(async () => root!.unmount());
  root = null;
  host!.remove();
  window.history.replaceState({}, "", "/plan");
  await mount();
  await settleRoute();
  await tune();
  expect(document.querySelector<HTMLSelectElement>("#plan-context-stops")!.value).toBe("4");
  expect(requests).toHaveLength(1);
});

it.each([1, 2])("keeps an explicit %i-stop request ahead of a four-pub draft", async (count) => {
  seed(`Plan ${count} pubs in Soho`);
  generate = () => reply(pubs.slice(0, count));
  await mount();
  await settleRoute();
  expect(requests).toHaveLength(1);
  expect(requests[0]!.anchor).toMatchObject({ venueId: "venue-a" });
  expect(requests[0]!.anchor).not.toHaveProperty("venueIds");
  expect(requests[0]!.context).toMatchObject({ stopCount: count });
  expect(document.querySelectorAll(".planStop__name")).toHaveLength(count);
  expect(readPlanDraftEnvelope(sessionStorage)?.draft.requestedStopCount).toBe(count);
  expect(readPlanDraftEnvelope(sessionStorage)?.draft.requestedStopCountSource).toBe("text");
});

it("keeps an accepted first pub and its scarcity explanation ahead of the Pal draft", async () => {
  writePlanningIntent({ source: "near", cityId: "london", acceptedVenueId: "venue-held",
    acceptedArea: { kind: "night-patch", id: "soho" }, startsAt: null,
    displayEvidence: { kind: "directory", observedAt: null } });
  seed();
  generate = () => reply(["venue-held"], "anchor-only", 3);
  await mount();
  await settleRoute();
  await vi.waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0]!.anchor).toMatchObject({ venueId: "venue-held", source: "near" });
  expect(document.querySelector("#plan-concierge-status")?.textContent).toContain("Your chosen first pub stays first");
  expect(document.querySelector("#plan-route-status")?.textContent).toContain("We could not build the 3-stop route you asked for");
});
