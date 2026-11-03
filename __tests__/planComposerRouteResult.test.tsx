// @vitest-environment jsdom

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) =>
    createElement("a", { href, className }, children),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/plan",
  useRouter: () => ({
    back: () => undefined,
    forward: () => undefined,
    refresh: () => undefined,
    push: () => undefined,
    replace: () => undefined,
    prefetch: () => Promise.resolve(),
  }),
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ user: null, session: null, loading: false, identityResolved: true }),
}));

vi.mock("@/components/plan/PlanIntake", () => ({ default: () => null }));
vi.mock("@/components/plan/PlanCultureOpener", () => ({ default: () => null }));
vi.mock("@/components/wanted/WantedPlanChips", () => ({ default: () => null }));
vi.mock("@/components/plan/PlanRouteMiniMap", () => ({ default: () => null }));

vi.mock("@/lib/analytics", () => ({
  trackEvent: () => undefined,
  trackMeaningfulCoreAction: () => undefined,
  laneSourceFromSearch: () => null,
}));

import PlanComposer, { planComposerVenueIndexPath } from "@/components/plan/PlanComposer";
import { createPlanIntakeDraft, PLAN_INTAKE_STORAGE_KEY, readPlanIntakeDraft, readPlanIntakeDraftWithMetadata, resolveFutureLondonStartIso, skipRemainingPlanIntake, writePlanIntakeDraft } from "@/lib/planIntake";
import { readPlanningIntent, writePlanningIntent } from "@/lib/planningIntent";
import { parsePlanGenerationRequest } from "@/lib/planGenerationRequest";
import { reconcilePlanContext } from "@/lib/planGenerationContext";
import { parsePlanDraft, PLAN_DRAFT_KEY, readPlanDraftEnvelope, writePlanDraftEnvelope } from "@/lib/planDraft";
import { writeAskPlanDraft } from "@/lib/conciergeAskClient";
import { ASK_PLAN_DRAFT_STORAGE_KEY } from "@/lib/ask/types";
import { inferNightContext, type NightContext } from "@/lib/nightPlanning";
import { carryRouteToPlan } from "@/components/plan/MapRouteTransferButton";
import { transferGeneratedRouteToDraft, type MapGeneratedRouteResponse } from "@/lib/mapRouteTransfer";
import { PLAN_ROUTE_DRAFT_KEY, PLAN_ROUTE_DRAFT_V2_KEY } from "@/lib/planRouteDraft";

const GENERATED = {
  routeRevision: 1,
  groundingProof: "test-proof",
  stops: [
    { venueId: "venue-a", venueName: "Pub A", reason: "Close to the heart of the area." },
    { venueId: "venue-b", venueName: "Pub B", reason: "0.6 km from the area centre." },
  ],
  inferredContext: { ...inferNightContext("Quiet in Clapham for 4").context, nightArea: "clapham", daypart: "evening", groupSize: 4 } satisfies NightContext,
};

let root: Root | null = null;
let host: HTMLElement | null = null;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return new Response(JSON.stringify(url.includes("/api/plans/generate") ? GENERATED : []), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  sessionStorage.clear();
  localStorage.clear();
  window.history.replaceState({}, "", "/plan");
});

afterEach(async () => {
  if (root) {
    const current = root;
    await act(async () => { current.unmount(); });
  }
  root = null;
  host?.remove();
  host = null;
  vi.unstubAllGlobals();
  sessionStorage.clear();
  localStorage.clear();
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
  });
}

async function mountComposer(): Promise<void> {
  host = document.createElement("div");
  document.body.append(host);
  await act(async () => {
    root = createRoot(host!);
    root.render(createElement(PlanComposer));
  });
  await settle();
  if (document.querySelector(".planStops__placeholder")) {
    await vi.waitFor(() => expect(document.querySelector(".planStops__placeholder")).toBeNull(), { timeout: 4000 });
  }
}

async function remountComposer(): Promise<void> {
  const current = root!;
  await act(async () => { current.unmount(); });
  root = null;
  host?.remove();
  host = null;
  await mountComposer();
}

function venueIndexReads(): number {
  const path = planComposerVenueIndexPath();
  return fetchMock.mock.calls.filter(([input]) => String(input) === path).length;
}

async function sortIt(query: string): Promise<void> {
  const field = document.querySelector<HTMLInputElement>("#plan-describe-first-query")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, query);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Plan it")!.click();
    await Promise.resolve();
  });
  await settle();
  await vi.waitFor(() => {
    if (!document.querySelector(".planStop")) throw new Error("the stop cards have not mounted");
  }, { timeout: 4000 });
}

function blockStorageWrites(name: "localStorage" | "sessionStorage"): Storage {
  const storage = window[name];
  vi.stubGlobal(name, {
    getItem: storage.getItem.bind(storage),
    setItem: () => { throw new DOMException("Storage is full", "QuotaExceededError"); },
    removeItem: storage.removeItem.bind(storage), clear: storage.clear.bind(storage),
    key: storage.key.bind(storage), get length() { return storage.length; },
  } satisfies Storage);
  return storage;
}

function rejectRouteWrites(keys: string[]): Storage {
  const storage = localStorage;
  vi.stubGlobal("localStorage", {
    getItem: storage.getItem.bind(storage),
    setItem: (key: string, value: string) => {
      if (keys.includes(key)) throw new DOMException("Storage is full", "QuotaExceededError");
      storage.setItem(key, value);
    },
    removeItem: storage.removeItem.bind(storage), clear: storage.clear.bind(storage),
    key: storage.key.bind(storage), get length() { return storage.length; },
  } satisfies Storage);
  return storage;
}

const ROUTE_DETAILS_SAVE_FAILURE = "Your stops were saved, but your route details, checks and starting pub could not be saved. Keep this page open to keep them.";

function seedCountRecovery(requestedStopCount?: 6): void {
  const intake = skipRemainingPlanIntake(createPlanIntakeDraft());
  writePlanIntakeDraft({ ...intake, answers: { ...intake.answers, stopCount: requestedStopCount } });
  sessionStorage.setItem(PLAN_DRAFT_KEY, JSON.stringify({
    title: "Night", creatorName: "", startTime: "", conciergeQuery: "Clapham tonight", requestedStopCount,
    stops: GENERATED.stops.map((stop, index) => ({ key: index + 1, venueId: stop.venueId, venueName: stop.venueName })),
  }));
  localStorage.setItem("pubmaxx:plan-route-draft:v1", JSON.stringify({
    stops: GENERATED.stops,
    nightContext: { nightArea: "clapham", daypart: "evening", partyType: "friends", budget: "standard", stopCount: 6 },
    groundingProof: "test-proof", routeStale: true,
  }));
}

function expectTuneDescriptionAndCount(query: string, requestedStopCount: number | undefined): void {
  expect(document.querySelector<HTMLInputElement>("#plan-concierge-query")?.value).toBe(query);
  expect(document.querySelector<HTMLSelectElement>("#plan-context-stops")?.value).toBe(String(requestedStopCount ?? 3));
}

async function typeTuneQuery(query: string): Promise<void> {
  const field = document.querySelector<HTMLInputElement>("#plan-concierge-query")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, query);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function handoffRoute(samePubs: boolean): MapGeneratedRouteResponse {
  const payload = btoa(JSON.stringify({ v: 1, expiresAt: Date.now() + 3_600_000 }));
  return {
    ...GENERATED,
    stops: samePubs ? GENERATED.stops : [
      { venueId: "handoff-a", venueName: "Handoff A" },
      { venueId: "handoff-b", venueName: "Handoff B" },
    ],
    inferredContext: { ...GENERATED.inferredContext, stopCount: 2, budgetLimitPence: null, transportConstraints: [] },
    groundingProof: `${payload}.test-only-signature`, operationKey: "handoff-operation",
    outcome: "route", anchorVenueId: samePubs ? "venue-a" : "handoff-a", anchorSource: "near",
  };
}

function seedOlderSession(requestedStopCount?: 6): void {
  seedCountRecovery(requestedStopCount);
  const savedAt = Date.now() - 2000;
  const plan = parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))!;
  const draft = { ...plan, conciergeQuery: requestedStopCount ? "Six pubs in Soho tonight" : plan.conciergeQuery };
  expect(writePlanDraftEnvelope(draft, "manual", sessionStorage, savedAt).v2).toBe(true);
  const intake = readPlanIntakeDraft()!;
  expect(writePlanIntakeDraft(intake, localStorage, savedAt)).toBe(true);
}

function expectDisplayedRoute(names: string[], ids: string[]): void {
  expect([...document.querySelectorAll(".planStop__name")].map((node) => node.textContent)).toEqual(names);
  expect([...document.querySelectorAll<HTMLAnchorElement>(".planStop__open")]
    .map((node) => new URL(node.href).searchParams.get("sel"))).toEqual(ids);
}

async function nameRouteCreator(): Promise<void> {
  await act(async () => {
    const name = document.querySelector<HTMLInputElement>("#plan-name")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "Captain");
    name.dispatchEvent(new Event("input", { bubbles: true }));
    const time = document.querySelector<HTMLInputElement>("#plan-time")!;
    if (!time.value) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(time, new Date(Date.now() + 86_400_000).toISOString().slice(0, 16));
      time.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
}

async function submitRecoveredRoute(): Promise<Record<string, unknown>> {
  await nameRouteCreator();
  await act(async () => document.querySelector<HTMLFormElement>("#plan-composer")!.requestSubmit());
  const creation = fetchMock.mock.calls.find(([input]) => String(input) === "/api/plans")!;
  expect(creation).toBeDefined();
  return JSON.parse(String(creation[1]?.body));
}

describe("the Plan result", () => {
  describe.each(["Map", "import"])("the %s route handoff", (source) => {
    it.each([false, true])("restores a V2-only handoff as one complete record (same pubs: %s)", async (samePubs) => {
      let now = Date.now();
      const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
      onTestFinished(() => clock.mockRestore());
      seedOlderSession(6);
      const old = handoffRoute(true);
      old.inferredContext = { ...GENERATED.inferredContext, nightArea: "piccadilly-soho", stopCount: 6, transportConstraints: ["walking"] };
      expect(transferGeneratedRouteToDraft(old, localStorage, "map-generated", Date.now() - 1000)).toBe(true);
      const oldV1 = localStorage.getItem(PLAN_ROUTE_DRAFT_KEY);
      const local = rejectRouteWrites([PLAN_ROUTE_DRAFT_KEY]);
      const next = {
        ...handoffRoute(samePubs), operationKey: "replacement-operation", routeRevision: 2,
        outcome: "unanchored", anchorVenueId: null, anchorSource: null,
      };
      if (source === "Map") carryRouteToPlan(next);
      else expect(transferGeneratedRouteToDraft(next, localStorage)).toBe(true);
      expect(local.getItem(PLAN_ROUTE_DRAFT_KEY)).toBe(oldV1);
      expect(JSON.parse(local.getItem(PLAN_ROUTE_DRAFT_V2_KEY)!)).toMatchObject({
        operationKey: "replacement-operation", anchorVenueId: null, routeRevision: 2,
        nightContext: { nightArea: "clapham", stopCount: 2, transportConstraints: [] },
      });
      now += 100;
      await mountComposer();
      expect(readPlanDraftEnvelope(sessionStorage)?.savedAt)
        .toBe(JSON.parse(local.getItem(PLAN_ROUTE_DRAFT_V2_KEY)!).savedAt);
      const ids = samePubs ? ["venue-a", "venue-b"] : ["handoff-a", "handoff-b"];
      const names = samePubs ? ["Pub A", "Pub B"] : ["Handoff A", "Handoff B"];
      expectDisplayedRoute(names, ids);
      expect(document.body.textContent).not.toContain(ROUTE_DETAILS_SAVE_FAILURE);
      await openTune();
      expectTuneDescriptionAndCount("", undefined);
      now += 100;
      await remountComposer();
      expectDisplayedRoute(names, ids);
      const saved = await submitRecoveredRoute();
      expect(saved.stops).toEqual(ids.map((venueId, index) => ({ venueId, venueName: names[index] })));
      expect(saved.context).toMatchObject({ nightArea: "clapham", stopCount: 2, transportConstraints: [] });
      expect(saved.groundingProof).toBe(next.groundingProof);
      expect(saved.anchor).toBeUndefined();
      expect(saved.status).toBeUndefined();
      expect(saved.routeReadyAt).toBeUndefined();
      expect(local.getItem(PLAN_ROUTE_DRAFT_KEY)).toBe(oldV1);
      await openTune();
      await sortAgainFromTune();
      const generation = fetchMock.mock.calls.find(([input]) => String(input).includes("/api/plans/generate"))!;
      const sent = JSON.parse(String(generation[1]?.body));
      expect(sent.query).toBeUndefined();
      expect(sent.context.nightArea).toBe("clapham");
      expect(sent.context.stopCount).toBeUndefined();
      expect(sent.intake.stopCount).toBeUndefined();
      expect(sent.anchor).toBeUndefined();
    });

    it.each([false, true])("replaces the old request through generation and reload (local writes blocked: %s)", async (blocked) => {
      seedOlderSession(6);
      const response = handoffRoute(false);
      if (source === "Map") carryRouteToPlan(response);
      else expect(transferGeneratedRouteToDraft(response, localStorage)).toBe(true);
      if (blocked) blockStorageWrites("localStorage");
      await mountComposer();
      await openTune();
      expectTuneDescriptionAndCount("", undefined);
      await sortAgainFromTune();
      const generation = fetchMock.mock.calls.find(([input]) => String(input).includes("/api/plans/generate"))!;
      expect(generation).toBeDefined();
      const sent = JSON.parse(String(generation[1]?.body));
      expect(sent.query).toBeUndefined();
      expect(sent.context.nightArea).toBe("clapham");
      expect(sent.context.stopCount).toBeUndefined();
      expect(sent.intake.stopCount).toBeUndefined();
      expect(parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))).toMatchObject({ conciergeQuery: "" });
      expect(parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))?.requestedStopCount).toBeUndefined();
      await remountComposer();
      expectDisplayedRoute(["Pub A", "Pub B"], ["venue-a", "venue-b"]);
      await openTune();
      expectTuneDescriptionAndCount("", undefined);
    });

    it.each([false, true])("keeps the new route ahead of an older session (same pubs: %s)", async (samePubs) => {
      seedOlderSession(6);
      const response = handoffRoute(samePubs);
      if (source === "Map") carryRouteToPlan(response);
      else expect(transferGeneratedRouteToDraft(response, localStorage)).toBe(true);
      expect(JSON.parse(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)!).savedAt)
        .toBe(JSON.parse(localStorage.getItem(PLAN_ROUTE_DRAFT_V2_KEY)!).savedAt);
      expect(JSON.parse(localStorage.getItem(PLAN_ROUTE_DRAFT_V2_KEY)!).savedAt).toBeDefined();
      await mountComposer();
      const names = samePubs ? ["Pub A", "Pub B"] : ["Handoff A", "Handoff B"];
      const ids = samePubs ? ["venue-a", "venue-b"] : ["handoff-a", "handoff-b"];
      expectDisplayedRoute(names, ids);
      expect(fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/plans/generate"))).toHaveLength(0);
      expect(parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))?.requestedStopCount).toBeUndefined();
      expect(JSON.parse(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)!)).toMatchObject({
        nightContext: { nightArea: "clapham", stopCount: 2, transportConstraints: [] },
        routeNight: { nightArea: "clapham", daypart: "evening" },
        groundingProof: response.groundingProof, createOperationKey: "handoff-operation", routeStale: false,
        planAnchor: { venueId: ids[0], source: "near", outcome: "route" },
      });
      await remountComposer();
      expectDisplayedRoute(names, ids);
      const saved = await submitRecoveredRoute();
      expect(saved.stops).toEqual(ids.map((venueId, index) => ({ venueId, venueName: names[index] })));
      expect(saved.context).toMatchObject({ nightArea: "clapham", stopCount: 2, transportConstraints: [] });
      expect(saved.groundingProof).toBe(response.groundingProof);
      expect(saved.anchor).toEqual({ venueId: ids[0], source: "near", outcome: "route" });
      expect(saved.status).toBeUndefined();
      expect(saved.routeReadyAt).toBeUndefined();
    });
  });

  it("restores equal-time conflicting route records as an unverified preview", async () => {
    seedOlderSession(6);
    const savedAt = Date.now() - 1000;
    const response = handoffRoute(true);
    expect(transferGeneratedRouteToDraft(response, localStorage, "map-generated", savedAt)).toBe(true);
    const oldV2 = localStorage.getItem(PLAN_ROUTE_DRAFT_V2_KEY)!;
    expect(transferGeneratedRouteToDraft({
      ...response, operationKey: "replacement-operation", anchorSource: "map-search",
    }, localStorage, "map-generated", savedAt)).toBe(true);
    localStorage.setItem(PLAN_ROUTE_DRAFT_V2_KEY, oldV2);
    await mountComposer();
    expectDisplayedRoute(["Pub A", "Pub B"], ["venue-a", "venue-b"]);
    expect(JSON.parse(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)!)).toMatchObject({
      routeStale: true, groundingProof: null, createOperationKey: null, planAnchor: null,
      nightContext: { nightArea: "clapham", transportConstraints: [] },
    });
    expect(localStorage.getItem(PLAN_ROUTE_DRAFT_V2_KEY)).toBe(oldV2);
    await openTune();
    expectTuneDescriptionAndCount("", undefined);
    await remountComposer();
    expectDisplayedRoute(["Pub A", "Pub B"], ["venue-a", "venue-b"]);
    await nameRouteCreator();
    expect(document.querySelector("#plan-lock-hint")?.textContent).toBe("Refresh the route before locking it in.");
    await act(async () => document.querySelector<HTMLFormElement>("#plan-composer")!.requestSubmit());
    expect(fetchMock.mock.calls.filter(([input]) => String(input) === "/api/plans")).toHaveLength(0);
  });

  it.each([
    { age: "undated", samePubs: false }, { age: "undated", samePubs: true },
    { age: "equal", samePubs: false }, { age: "equal", samePubs: true },
  ])("excludes companion acceptance across $age conflicts (same pubs: $samePubs)", async ({ age, samePubs }) => {
    seedOlderSession();
    const savedAt = Date.now() - 1000;
    expect(writePlanningIntent({
      source: "near", cityId: "london", acceptedVenueId: "venue-a",
      acceptedArea: { kind: "night-patch", id: "soho" }, startsAt: null,
      displayEvidence: { kind: "directory", observedAt: null },
    })).not.toBeNull();
    const session = parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))!;
    expect(writePlanDraftEnvelope({
      ...session,
      acceptedAnchor: {
        venueId: "venue-a", source: "near", cityId: "london",
        acceptedArea: { kind: "night-patch", id: "soho" }, startsAt: null,
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      },
    }, "planning-intent", sessionStorage, savedAt).v2).toBe(true);
    expect(transferGeneratedRouteToDraft(handoffRoute(true), localStorage, "map-generated", savedAt)).toBe(true);
    const oldV2 = localStorage.getItem(PLAN_ROUTE_DRAFT_V2_KEY)!;
    expect(transferGeneratedRouteToDraft({
      ...handoffRoute(samePubs), operationKey: "replacement-operation", anchorSource: "map-search",
    }, localStorage, "map-generated", savedAt)).toBe(true);
    localStorage.setItem(PLAN_ROUTE_DRAFT_V2_KEY, oldV2);
    if (age === "undated") {
      const route = JSON.parse(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)!);
      delete route.savedAt;
      localStorage.setItem(PLAN_ROUTE_DRAFT_KEY, JSON.stringify(route));
    }
    await mountComposer();
    expectDisplayedRoute(samePubs ? ["Pub A", "Pub B"] : ["Handoff A", "Handoff B"],
      samePubs ? ["venue-a", "venue-b"] : ["handoff-a", "handoff-b"]);
    expect(document.body.textContent).not.toContain("Release this pub");
    expect(parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))?.acceptedAnchor).toBeUndefined();
    const stored = JSON.parse(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)!);
    expect(stored).toMatchObject({ routeStale: true, groundingProof: null, createOperationKey: null, planAnchor: null });
    await openTune();
    await typeTuneQuery("Clapham tonight");
    await sortAgainFromTune();
    const generation = fetchMock.mock.calls.find(([input]) => String(input).includes("/api/plans/generate"))!;
    expect(JSON.parse(String(generation[1]?.body)).anchor).toBeUndefined();
  });

  it("preserves a complete handoff through session copies when all local writes fail", async () => {
    seedOlderSession(6);
    const savedAt = Date.now() - 500;
    const response = handoffRoute(false);
    expect(transferGeneratedRouteToDraft(response, localStorage, "map-generated", savedAt)).toBe(true);
    const local = blockStorageWrites("localStorage");
    const original = local.getItem(PLAN_ROUTE_DRAFT_V2_KEY);
    await mountComposer();
    expect(readPlanDraftEnvelope(sessionStorage)?.savedAt).toBe(new Date(savedAt).toISOString());
    await remountComposer();
    expectDisplayedRoute(["Handoff A", "Handoff B"], ["handoff-a", "handoff-b"]);
    expect(document.body.textContent).not.toContain(ROUTE_DETAILS_SAVE_FAILURE);
    const saved = await submitRecoveredRoute();
    expect(saved.context).toMatchObject({ nightArea: "clapham", stopCount: 2, transportConstraints: [] });
    expect(saved.groundingProof).toBe(response.groundingProof);
    expect(saved.anchor).toEqual({ venueId: "handoff-a", source: "near", outcome: "route" });
    expect(saved.status).toBeUndefined();
    expect(saved.routeReadyAt).toBeUndefined();
    expect(local.getItem(PLAN_ROUTE_DRAFT_V2_KEY)).toBe(original);
  });

  it("does not merge a valid V2 handoff with a malformed V1 route", async () => {
    seedOlderSession(6);
    const old = JSON.parse(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)!);
    const next = handoffRoute(false);
    expect(transferGeneratedRouteToDraft(next, localStorage)).toBe(true);
    localStorage.setItem(PLAN_ROUTE_DRAFT_KEY, JSON.stringify({ ...old, nightContext: "invalid" }));
    await mountComposer();
    expectDisplayedRoute(["Handoff A", "Handoff B"], ["handoff-a", "handoff-b"]);
    const saved = await submitRecoveredRoute();
    expect(saved.context).toMatchObject({ nightArea: "clapham", transportConstraints: [] });
    expect(saved.groundingProof).toBe(next.groundingProof);
    expect(saved.anchor).toEqual({ venueId: "handoff-a", source: "near", outcome: "route" });
  });

  it.each(["changed", "absent"])("keeps the V1 handoff's %s anchor when its V2 write fails", async (anchor) => {
    seedOlderSession(6);
    const response = handoffRoute(true);
    expect(transferGeneratedRouteToDraft(response, localStorage, "map-generated", Date.now() - 1000)).toBe(true);
    const oldV2 = localStorage.getItem(PLAN_ROUTE_DRAFT_V2_KEY)!;
    const next = anchor === "changed"
      ? { ...response, anchorSource: "map-search" }
      : { ...response, outcome: "unanchored", anchorVenueId: null, anchorSource: null };
    expect(transferGeneratedRouteToDraft(next, {
      getItem: localStorage.getItem.bind(localStorage),
      setItem: (key, value) => {
        if (key === PLAN_ROUTE_DRAFT_V2_KEY) throw new DOMException("Storage is full", "QuotaExceededError");
        localStorage.setItem(key, value);
      },
    }, "map-generated")).toBe(false);
    const current = JSON.parse(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)!);
    expect(Date.parse(current.savedAt)).toBeGreaterThan(Date.parse(JSON.parse(oldV2).savedAt));
    await mountComposer();
    expectDisplayedRoute(["Pub A", "Pub B"], ["venue-a", "venue-b"]);
    expect(parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))?.requestedStopCount).toBeUndefined();
    const saved = await submitRecoveredRoute();
    expect(saved.groundingProof).toBe(response.groundingProof);
    expect(saved.context).toMatchObject({ nightArea: "clapham", stopCount: 2, transportConstraints: [] });
    expect(saved.anchor).toEqual(anchor === "changed"
      ? { venueId: "venue-a", source: "map-search", outcome: "route" } : undefined);
    expect(saved.status).toBeUndefined();
    expect(saved.routeReadyAt).toBeUndefined();
    expect(localStorage.getItem(PLAN_ROUTE_DRAFT_V2_KEY)).toBe(oldV2);
    await remountComposer();
    await openTune();
    expectTuneDescriptionAndCount("", undefined);
  });

  it.each(["V1", "V2"])("does not combine conflicting legacy records after only %s of a handoff saves", async (written) => {
    seedOlderSession();
    expect(transferGeneratedRouteToDraft(handoffRoute(true), localStorage, "plan-generated", Date.now() - 1000)).toBe(true);
    const previousV2 = localStorage.getItem(PLAN_ROUTE_DRAFT_V2_KEY)!;
    const response = handoffRoute(true);
    response.operationKey = "replacement-operation";
    response.inferredContext = { ...GENERATED.inferredContext, nightArea: "piccadilly-soho", stopCount: 2, transportConstraints: ["walking"] };
    const rejectedKey = written === "V1" ? PLAN_ROUTE_DRAFT_V2_KEY : PLAN_ROUTE_DRAFT_KEY;
    expect(transferGeneratedRouteToDraft(response, {
      getItem: localStorage.getItem.bind(localStorage),
      setItem: (key, value) => {
        if (key === rejectedKey) throw new DOMException("Storage is full", "QuotaExceededError");
        localStorage.setItem(key, value);
      },
    })).toBe(written === "V2");
    const writtenV2 = localStorage.getItem(PLAN_ROUTE_DRAFT_V2_KEY);
    const undated = JSON.parse(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)!);
    delete undated.savedAt;
    localStorage.setItem(PLAN_ROUTE_DRAFT_KEY, JSON.stringify(undated));
    await mountComposer();
    expectDisplayedRoute(["Pub A", "Pub B"], ["venue-a", "venue-b"]);
    const stored = JSON.parse(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)!);
    expect(stored.createOperationKey).toBeNull();
    expect(stored.nightContext.nightArea).toBe(written === "V1" ? "piccadilly-soho" : "clapham");
    expect(stored.groundingProof).toBeNull();
    expect(stored.routeStale).toBe(true);
    expect(stored.planAnchor).toBeNull();
    await nameRouteCreator();
    expect(document.querySelector("#plan-lock-hint")?.textContent).toBe("Refresh the route before locking it in.");
    await act(async () => document.querySelector<HTMLFormElement>("#plan-composer")!.requestSubmit());
    expect(fetchMock.mock.calls.filter(([input]) => String(input) === "/api/plans")).toHaveLength(0);
    expect(localStorage.getItem(PLAN_ROUTE_DRAFT_V2_KEY)).toBe(written === "V1" ? previousV2 : writtenV2);
  });

  it("keeps a newer V1 route ahead of a stale V2 with the same pub IDs", async () => {
    seedOlderSession();
    const old = handoffRoute(true);
    old.operationKey = "old-operation";
    old.inferredContext = { ...GENERATED.inferredContext, nightArea: "piccadilly-soho", stopCount: 2, transportConstraints: ["walking"] };
    expect(transferGeneratedRouteToDraft(old, localStorage, "plan-generated", Date.now() - 1000)).toBe(true);
    const staleV2 = localStorage.getItem(PLAN_ROUTE_DRAFT_V2_KEY)!;
    const current = handoffRoute(true);
    expect(transferGeneratedRouteToDraft(current, localStorage)).toBe(true);
    const route = JSON.parse(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)!);
    route.savedAt = new Date().toISOString();
    route.planAnchor = { venueId: "venue-a", source: "near", outcome: "route" };
    localStorage.setItem(PLAN_ROUTE_DRAFT_KEY, JSON.stringify(route));
    localStorage.setItem(PLAN_ROUTE_DRAFT_V2_KEY, staleV2);
    await mountComposer();
    expectDisplayedRoute(["Pub A", "Pub B"], ["venue-a", "venue-b"]);
    const saved = await submitRecoveredRoute();
    expect(saved.groundingProof).toBe(current.groundingProof);
    expect(saved.context).toMatchObject({ nightArea: "clapham", transportConstraints: [] });
    expect(saved.anchor).toEqual({ venueId: "venue-a", source: "near", outcome: "route" });
    expect(localStorage.getItem(PLAN_ROUTE_DRAFT_V2_KEY)).toBe(staleV2);
  });

  it.each([false, true])("warns when only session stops survive generation (operation key absent: %s)", async (withoutOperation) => {
    seedOlderSession(6);
    await mountComposer();
    const local = rejectRouteWrites([PLAN_ROUTE_DRAFT_KEY, PLAN_ROUTE_DRAFT_V2_KEY]);
    const oldV1 = local.getItem(PLAN_ROUTE_DRAFT_KEY);
    const next = {
      ...handoffRoute(false),
      ...(withoutOperation ? { operationKey: undefined, outcome: "unanchored", anchorVenueId: null, anchorSource: null } : {}),
    };
    fetchMock.mockImplementation(async (input) => new Response(JSON.stringify(
      String(input).includes("/api/plans/generate") ? next : [],
    ), { status: 200, headers: { "content-type": "application/json" } }));
    await openTune();
    await typeTuneQuery("Clapham tonight");
    await sortAgainFromTune();
    expectDisplayedRoute(["Handoff A", "Handoff B"], ["handoff-a", "handoff-b"]);
    expect(document.body.textContent).toContain(ROUTE_DETAILS_SAVE_FAILURE);
    expect(local.getItem(PLAN_ROUTE_DRAFT_KEY)).toBe(oldV1);
    expect(parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))?.stops.map((stop) => stop.venueId))
      .toEqual(["handoff-a", "handoff-b"]);
    await remountComposer();
    expectDisplayedRoute(["Handoff A", "Handoff B"], ["handoff-a", "handoff-b"]);
    expect(document.body.textContent).toContain("Opening and travel checks are unavailable for this restored draft.");
    await nameRouteCreator();
    expect(document.querySelector("#plan-lock-hint")?.textContent).toBe("Refresh the route before locking it in.");
    expect(document.querySelector(".planBudgetLedger")).toBeNull();
    await act(async () => document.querySelector<HTMLFormElement>("#plan-composer")!.requestSubmit());
    expect(fetchMock.mock.calls.filter(([input]) => String(input) === "/api/plans")).toHaveLength(0);
  });

  it("reports route loss when intake saves but neither route store saves an empty description", async () => {
    seedCountRecovery();
    await mountComposer();
    await openTune();
    await typeTuneQuery("");
    const local = localStorage;
    const oldRoute = local.getItem(PLAN_ROUTE_DRAFT_KEY)!;
    blockStorageWrites("sessionStorage");
    vi.stubGlobal("localStorage", {
      getItem: local.getItem.bind(local),
      setItem: (key: string, value: string) => {
        if (key === PLAN_ROUTE_DRAFT_KEY && value.length > oldRoute.length) throw new DOMException("Storage is full", "QuotaExceededError");
        local.setItem(key, value);
      },
      removeItem: local.removeItem.bind(local), clear: local.clear.bind(local),
      key: local.key.bind(local), get length() { return local.length; },
    } satisfies Storage);
    fetchMock.mockImplementation(async (input) => new Response(JSON.stringify(
      String(input).includes("/api/plans/generate") ? {
        ...GENERATED, inferredContext: { ...GENERATED.inferredContext, stopCount: 6 },
        stops: Array.from({ length: 6 }, (_, index) => ({ venueId: `new-${index}`, venueName: `New pub ${index} with a longer name for the larger route` })),
      } : [],
    ), { status: 200, headers: { "content-type": "application/json" } }));
    await act(async () => {
      const picker = document.querySelector<HTMLSelectElement>("#plan-context-stops")!;
      picker.value = "6";
      picker.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const savedBeforeGeneration = local.getItem(PLAN_ROUTE_DRAFT_KEY);
    await sortAgainFromTune();
    expect(document.querySelectorAll(".planStop__name")).toHaveLength(6);
    expect(readPlanIntakeDraft(local)?.answers.stopCount).toBe(6);
    expect(local.getItem(PLAN_ROUTE_DRAFT_KEY)).toBe(savedBeforeGeneration);
    expect([...document.querySelectorAll('[role="alert"]')].map((node) => node.textContent))
      .toContain("Your route could not be saved on this device. Keep this page open to keep it.");
    const generation = fetchMock.mock.calls.find(([input]) => String(input).includes("/api/plans/generate"))!;
    expect(JSON.parse(String(generation[1]?.body)).query).toBeUndefined();
    expect(JSON.parse(String(generation[1]?.body)).context.stopCount).toBe(6);
    expect(parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))?.requestedStopCount).toBeUndefined();
    await remountComposer();
    expectDisplayedRoute(["Pub A", "Pub B"], ["venue-a", "venue-b"]);
    await openTune();
    expectTuneDescriptionAndCount("", 6);
  });

  it("checks the remaining route after a handoff replaces a failed persistence copy", async () => {
    seedOlderSession();
    const savedAt = Date.now() - 1000;
    expect(transferGeneratedRouteToDraft(handoffRoute(true), localStorage, "map-generated", savedAt)).toBe(true);
    const local = localStorage;
    const next = { ...handoffRoute(false), operationKey: "replacement-operation" };
    let replaced = false;
    vi.stubGlobal("localStorage", {
      getItem: local.getItem.bind(local),
      setItem: (key: string, value: string) => {
        if (key !== PLAN_ROUTE_DRAFT_KEY) return local.setItem(key, value);
        if (!replaced) {
          replaced = true;
          expect(transferGeneratedRouteToDraft(next, local, "map-generated", Date.now() + 1000)).toBe(true);
        }
        throw new DOMException("Storage is full", "QuotaExceededError");
      },
      removeItem: local.removeItem.bind(local), clear: local.clear.bind(local),
      key: local.key.bind(local), get length() { return local.length; },
    } satisfies Storage);
    await mountComposer();
    expectDisplayedRoute(["Pub A", "Pub B"], ["venue-a", "venue-b"]);
    expect(document.body.textContent).toContain(ROUTE_DETAILS_SAVE_FAILURE);
    expect(JSON.parse(local.getItem(PLAN_ROUTE_DRAFT_V2_KEY)!)).toMatchObject({ operationKey: "replacement-operation" });
    await remountComposer();
    expectDisplayedRoute(["Handoff A", "Handoff B"], ["handoff-a", "handoff-b"]);
    expect(document.body.textContent).not.toContain(ROUTE_DETAILS_SAVE_FAILURE);
    const saved = await submitRecoveredRoute();
    expect(saved.groundingProof).toBe(next.groundingProof);
    expect(saved.anchor).toEqual({ venueId: "handoff-a", source: "near", outcome: "route" });
  });

  it.each([false, true])("preserves a newer handoff during a failed legacy route save (undated V1: %s)", async (undated) => {
    seedCountRecovery();
    const local = localStorage;
    const replacements: Array<{ v1: string; v2: string }> = [];
    vi.stubGlobal("localStorage", {
      getItem: local.getItem.bind(local),
      setItem: (key: string, value: string) => {
        if (key !== PLAN_ROUTE_DRAFT_KEY) return local.setItem(key, value);
        if (JSON.parse(value).createOperationKey === "new-operation" && replacements.length === 0) {
          expect(transferGeneratedRouteToDraft(handoffRoute(false), local, "map-generated", Date.now() + 1000)).toBe(true);
          const record = JSON.parse(local.getItem(PLAN_ROUTE_DRAFT_KEY)!);
          if (undated) delete record.savedAt;
          local.setItem(PLAN_ROUTE_DRAFT_KEY, JSON.stringify(record));
          replacements.push({ v1: local.getItem(PLAN_ROUTE_DRAFT_KEY)!, v2: local.getItem(PLAN_ROUTE_DRAFT_V2_KEY)! });
        }
        throw new DOMException("Storage is full", "QuotaExceededError");
      },
      removeItem: local.removeItem.bind(local), clear: local.clear.bind(local),
      key: local.key.bind(local), get length() { return local.length; },
    } satisfies Storage);
    fetchMock.mockImplementation(async (input) => new Response(JSON.stringify(
      String(input).includes("/api/plans/generate") ? { ...GENERATED, operationKey: "new-operation" } : [],
    ), { status: 200, headers: { "content-type": "application/json" } }));
    await mountComposer();
    await openTune();
    await sortAgainFromTune();
    expect(replacements).toHaveLength(1);
    const replacement = replacements[0]!;
    expect(local.getItem(PLAN_ROUTE_DRAFT_KEY)).toBe(replacement.v1);
    expect(local.getItem(PLAN_ROUTE_DRAFT_V2_KEY)).toBe(replacement.v2);
    await remountComposer();
    expectDisplayedRoute(["Handoff A", "Handoff B"], ["handoff-a", "handoff-b"]);
    const saved = await submitRecoveredRoute();
    expect(saved.groundingProof).toBe(JSON.parse(replacement.v2).groundingProof);
    expect(saved.anchor).toEqual({ venueId: "handoff-a", source: "near", outcome: "route" });
  });

  it.each([false, true])("restores the new Ask route when only session storage saves generation (same pubs: %s)", async (samePubs) => {
    let now = Date.now();
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now++);
    onTestFinished(() => clock.mockRestore());
    const sixStops = Array.from({ length: 6 }, (_, index) => ({
      venueId: `old-${index + 1}`, venueName: `Old pub ${index + 1}`,
    }));
    const oldContext: NightContext = {
      ...GENERATED.inferredContext, nightArea: "piccadilly-soho", stopCount: 6,
      budgetLimitPence: 2000, transportConstraints: ["walking"],
    };
    const newStops = samePubs
      ? sixStops.map((stop, index) => ({ venueId: stop.venueId, venueName: `New pub ${index + 1}` }))
      : [{ venueId: "new-one", venueName: "New pub" }];
    const query = samePubs ? "Six pubs in Clapham tonight" : "One pub in Clapham tonight";
    const requested = samePubs ? 6 : 1;
    const newIds = newStops.map((stop) => stop.venueId);
    const newNames = newStops.map((stop) => stop.venueName);
    let response = {
      ...GENERATED, groundingProof: "old-proof", stops: sixStops.map((stop, index) => ({
        ...stop, walkingMinutesFromPrevious: index ? 18 : undefined,
        walkFromVenueId: index ? sixStops[index - 1]!.venueId : undefined,
      })),
      operationKey: "old-route-operation", anchored: true, anchorVenueId: "old-1", anchorSource: "near", outcome: "route",
      inferredContext: oldContext,
    };
    fetchMock.mockImplementation(async (input) => new Response(JSON.stringify(
      String(input).includes("/api/plans/generate") ? response : [],
    ), { status: 200, headers: { "content-type": "application/json" } }));
    await mountComposer();
    await sortIt("Six pubs in Soho tonight, walking, £20 each");
    expect(document.querySelectorAll(".planStop__name")).toHaveLength(6);
    const local = blockStorageWrites("localStorage");
    const oldRoute = local.getItem("pubmaxx:plan-route-draft:v1");
    expect(JSON.parse(oldRoute!)).toMatchObject({
      nightContext: { nightArea: "piccadilly-soho", stopCount: 6, transportConstraints: ["walking"] },
      groundingProof: "old-proof", createOperationKey: "old-route-operation",
      planAnchor: { venueId: "old-1", outcome: "route" }, routeStale: false,
    });
    response = { ...GENERATED, groundingProof: "new-proof", stops: newStops.map((stop) => ({ ...stop, walkingMinutesFromPrevious: undefined, walkFromVenueId: undefined })),
      operationKey: "new-route-operation", anchored: false, anchorVenueId: "", anchorSource: "", outcome: "route",
      inferredContext: { ...GENERATED.inferredContext, stopCount: requested, budgetLimitPence: null, transportConstraints: [] } };
    writeAskPlanDraft({ query, stopIds: [], stopNames: [], createdAt: new Date().toISOString() });
    await remountComposer();
    await openTune();
    await sortAgainFromTune();
    expect([...document.querySelectorAll(".planStop__name")].map((node) => node.textContent)).toEqual(newNames);
    expect(parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))?.stops.map((stop) => stop.venueId)).toEqual(newIds);
    expect(local.getItem("pubmaxx:plan-route-draft:v1")).toBe(oldRoute);

    await remountComposer();
    // The confirmed Ask owns the restored route, even though the local route is still readable.
    expect([...document.querySelectorAll(".planStop__name")].map((node) => node.textContent)).toEqual(newNames);
    expect(parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))?.stops.map((stop) => stop.venueId)).toEqual(newIds);
    expect([...document.querySelectorAll<HTMLAnchorElement>(".planStop__open")].map((node) => new URL(node.href).searchParams.get("sel"))).toEqual(newIds);
    expect(document.body.textContent).toContain("Opening and travel checks are unavailable for this restored draft.");
    await act(async () => {
      const name = document.querySelector<HTMLInputElement>("#plan-name")!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "Captain");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(document.querySelector("#plan-lock-hint")?.textContent).toBe("Refresh the route before locking it in.");
    await act(async () => document.querySelector<HTMLFormElement>("#plan-composer")!.requestSubmit());
    expect(fetchMock.mock.calls.filter(([input]) => String(input) === "/api/plans")).toHaveLength(0);
    // Session stores identity and request intent, but no generated route context.
    // The old Soho budget and walking preferences must not describe the new pub.
    expect(document.querySelector(".planBudgetLedger")).toBeNull();
    expect(document.querySelector('[data-testid="plan-route-summary"]')?.textContent).not.toContain("18 min");
    // When local writes recover, save the same conservative record before dating the intake.
    vi.stubGlobal("localStorage", local);
    await remountComposer();
    expect(JSON.parse(local.getItem("pubmaxx:plan-route-draft:v1")!)).toEqual({
      savedAt: readPlanDraftEnvelope(sessionStorage)?.savedAt,
      stops: newStops.map((stop, index) => ({ key: index + 1, ...stop, alternatives: [] })),
      nightContext: null, routeNight: null, routeRevision: null, routeStale: true,
      groundingProof: null, createOperationKey: null, planAnchor: null,
    });
    await remountComposer();
    expect([...document.querySelectorAll(".planStop__name")].map((node) => node.textContent)).toEqual(newNames);
    await openTune();
    expect(document.querySelector("#plan-context-area")).toBeNull();
    expect(document.querySelector<HTMLSelectElement>("#plan-context-stops")?.value).toBe(String(requested));
    await sortAgainFromTune();
    const generation = fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/plans/generate")).at(-1)!;
    const sent = JSON.parse(String(generation[1]?.body));
    expect(sent.query).toBe(query);
    expect(sent.context.stopCount).toBe(requested);
    expect(sent.intake.stopCount).toBe(requested);
    expect(sent.context.nightArea).toBe("clapham");
    expect(sent.context.transportConstraints).toEqual([]);
    expect(sent.anchor).toBeUndefined();
    await act(async () => document.querySelector<HTMLFormElement>("#plan-composer")!.requestSubmit());
    const creation = fetchMock.mock.calls.find(([input]) => String(input) === "/api/plans")!;
    const saved = JSON.parse(String(creation[1]?.body));
    expect(saved.stops).toEqual(newStops);
    expect(saved.context).toMatchObject({ nightArea: "clapham", stopCount: requested, transportConstraints: [] });
    expect(saved.groundingProof).toBe("new-proof");
    expect(saved.anchor).toBeUndefined();
    expect(saved.status).toBeUndefined();
    expect(saved.routeReadyAt).toBeUndefined();
  });

  it.each([
    { quota: false, requested: undefined },
    { quota: true, requested: undefined },
    { quota: false, requested: 6 },
    { quota: true, requested: 6 },
    { quota: true, requested: 6, legacy: true },
  ] as const)("restores the generated route with selective route quota $quota and requested count $requested", async ({ quota, requested, ...options }) => {
    let now = Date.now();
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now++);
    onTestFinished(() => clock.mockRestore());
    const oldStops = [{ venueId: "old-one", venueName: "Old pub" }];
    const oldContext: NightContext = {
      ...GENERATED.inferredContext, nightArea: "piccadilly-soho", stopCount: 1,
      budgetLimitPence: 2000, transportConstraints: ["walking"],
    };
    let response = {
      ...GENERATED, stops: oldStops, groundingProof: "old-proof", operationKey: "old-operation",
      anchored: true, anchorVenueId: "old-one", anchorSource: "near", outcome: "route",
      inferredContext: oldContext,
    };
    fetchMock.mockImplementation(async (input) => new Response(JSON.stringify(
      String(input).includes("/api/plans/generate") ? response : [],
    ), { status: 200, headers: { "content-type": "application/json" } }));
    await mountComposer();
    await sortIt("One pub in Soho tonight, walking, £20 each");
    const local = localStorage;
    const routeKey = "pubmaxx:plan-route-draft:v1";
    if ("legacy" in options) {
      const legacyRoute = JSON.parse(local.getItem(routeKey)!);
      delete legacyRoute.savedAt;
      local.setItem(routeKey, JSON.stringify(legacyRoute));
    }
    const oldRoute = local.getItem(routeKey)!;
    expect(JSON.parse(oldRoute)).toMatchObject({
      groundingProof: "old-proof", createOperationKey: "old-operation",
      planAnchor: { venueId: "old-one", outcome: "route" },
    });
    const rejectedRoutes: string[] = [];
    vi.stubGlobal("localStorage", {
      getItem: local.getItem.bind(local),
      setItem: (key: string, value: string) => {
        if (quota && key === routeKey && value.length > oldRoute.length) {
          rejectedRoutes.push(value);
          throw new DOMException("Storage is full", "QuotaExceededError");
        }
        local.setItem(key, value);
      },
      removeItem: local.removeItem.bind(local), clear: local.clear.bind(local),
      key: local.key.bind(local), get length() { return local.length; },
    } satisfies Storage);
    const newStops = Array.from({ length: requested ?? 3 }, (_, index) => ({
      venueId: `new-${index + 1}`, venueName: `New pub ${index + 1}`,
    }));
    const query = requested ? "Six pubs in Clapham tonight" : "Clapham tonight";
    response = {
      ...response, stops: newStops, groundingProof: "new-proof", operationKey: "new-operation",
      anchored: false, anchorVenueId: "", anchorSource: "",
      inferredContext: {
        ...GENERATED.inferredContext, stopCount: requested ?? 3,
        budgetLimitPence: null, transportConstraints: [],
      },
    };
    writeAskPlanDraft({ query, stopIds: [], stopNames: [], createdAt: new Date(now).toISOString() });
    await remountComposer();
    await openTune();
    await sortAgainFromTune();
    const newNames = newStops.map((stop) => stop.venueName);
    const newIds = newStops.map((stop) => stop.venueId);
    expect([...document.querySelectorAll(".planStop__name")].map((node) => node.textContent)).toEqual(newNames);
    expect(readPlanIntakeDraft(local)?.answers.stopCount).toBe(requested);
    expect(readPlanIntakeDraftWithMetadata(local)?.savedAt).toBe(readPlanDraftEnvelope(sessionStorage)?.savedAt);
    const storedRoute = JSON.parse(local.getItem(routeKey) ?? "null");
    if ("legacy" in options) {
      expect(rejectedRoutes.length).toBeGreaterThan(0);
      expect(local.getItem(routeKey)).toBe(oldRoute);
    } else if (quota) {
      expect(rejectedRoutes.length).toBeGreaterThan(0);
      expect(storedRoute.stops.map((stop: { venueId: string }) => stop.venueId)).toEqual(["old-one"]);
    } else {
      expect(rejectedRoutes).toEqual([]);
      expect(storedRoute).toMatchObject({ groundingProof: "new-proof", createOperationKey: "new-operation", planAnchor: null });
    }
    await remountComposer();
    expect([...document.querySelectorAll(".planStop__name")].map((node) => node.textContent)).toEqual(newNames);
    expect([...document.querySelectorAll<HTMLAnchorElement>(".planStop__open")].map((node) => new URL(node.href).searchParams.get("sel"))).toEqual(newIds);
    expect(parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))?.stops.map((stop) => stop.venueId)).toEqual(newIds);
    expect(parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))?.requestedStopCount).toBe(requested);
    expect(document.body.textContent).not.toContain("Your changes could not be saved");
    const restoredRoute = JSON.parse(local.getItem(routeKey)!);
    expect(restoredRoute.stops.map((stop: { venueId: string }) => stop.venueId)).toEqual(newIds);
    expect(restoredRoute).toMatchObject(quota ? {
      nightContext: null, routeNight: null, routeRevision: null, routeStale: true,
      groundingProof: null, createOperationKey: null, planAnchor: null,
    } : {
      nightContext: { nightArea: "clapham", stopCount: requested ?? 3, transportConstraints: [] },
      routeStale: false, groundingProof: "new-proof", createOperationKey: "new-operation", planAnchor: null,
    });
    expect(restoredRoute.savedAt).toBe(readPlanDraftEnvelope(sessionStorage)?.savedAt);
    await act(async () => {
      const name = document.querySelector<HTMLInputElement>("#plan-name")!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "Captain");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    if (quota) {
      expect(document.querySelector(".planBudgetLedger")).toBeNull();
      expect(document.querySelector("#plan-lock-hint")?.textContent).toBe("Refresh the route before locking it in.");
      await act(async () => document.querySelector<HTMLFormElement>("#plan-composer")!.requestSubmit());
      expect(fetchMock.mock.calls.filter(([input]) => String(input) === "/api/plans")).toHaveLength(0);
    }
    await openTune();
    expectTuneDescriptionAndCount(query, requested);
    await sortAgainFromTune();
    const generation = fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/plans/generate")).at(-1)!;
    const sent = JSON.parse(String(generation[1]?.body));
    expect(sent.query).toBe(query);
    expect(sent.context).toMatchObject({ nightArea: "clapham", transportConstraints: [] });
    expect(sent.context.stopCount).toBe(requested);
    expect(sent.intake.stopCount).toBe(requested);
    expect(sent.anchor).toBeUndefined();
    await act(async () => document.querySelector<HTMLFormElement>("#plan-composer")!.requestSubmit());
    const creation = fetchMock.mock.calls.find(([input]) => String(input) === "/api/plans")!;
    const saved = JSON.parse(String(creation[1]?.body));
    expect(saved.stops).toEqual(newStops);
    expect(saved.context).toMatchObject({ nightArea: "clapham", stopCount: requested ?? 3, transportConstraints: [] });
    expect(saved.groundingProof).toBe("new-proof");
    expect(new Headers(creation[1]?.headers).get("idempotency-key")).toBe("new-operation");
    expect(saved.anchor).toBeUndefined();
    expect(saved.status).toBeUndefined();
    expect(saved.routeReadyAt).toBeUndefined();
  });

  // The option chips change budget or drinks, never explicit stop-count intent.
  // These mounted cases reject promoting the visible default or the two returned stops.
  it.each([
    { query: "Quiet in Clapham for 4", chips: [], expectedQuery: "Quiet in Clapham for 4", requested: undefined },
    { query: "Quiet in Clapham for 4", chips: ["£20 crawl"], expectedQuery: "Quiet in Clapham for 4, a £20 crawl", requested: undefined },
    { query: "Soho for 3, £30.00 per person", chips: ["£20 crawl"], expectedQuery: "Soho for 3, £30.00 per person", requested: undefined },
    { query: "Quiet in Clapham for 4", chips: ["Dry round"], expectedQuery: "Quiet in Clapham for 4, an alcohol-free dry round", requested: undefined },
    { query: "Quiet in Clapham for 4", chips: ["Dry round", "£20 crawl"], expectedQuery: "Quiet in Clapham for 4, an alcohol-free dry round, a £20 crawl", requested: undefined },
    { query: "Camden for 3", chips: [], search: "?dry=1", expectedQuery: "Camden for 3, an alcohol-free dry round", requested: undefined },
    { query: "One pub in Clapham tonight", chips: ["Dry round", "£20 crawl"], expectedQuery: "One pub in Clapham tonight, an alcohol-free dry round, a £20 crawl", requested: 1 },
    { query: "One pub in Clapham tonight", chips: ["Dry round", "£20 crawl"], selected: true, expectedQuery: "One pub in Clapham tonight, an alcohol-free dry round, a £20 crawl", requested: 5 },
  ])("preserves count intent through option submission: $expectedQuery ($requested)", async ({ query, chips, search, selected, expectedQuery, requested }) => {
    window.history.replaceState({}, "", `/plan${search ?? ""}`);
    await mountComposer();
    for (const label of chips) {
      await act(async () => [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === label)!.click());
    }
    if (selected) {
      await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[aria-label="Number of pub stops"] button')].find((button) => button.textContent?.trim() === "5")!.click());
    }
    await sortIt(query);
    const call = fetchMock.mock.calls.find(([input]) => String(input).includes("/api/plans/generate"))!;
    const sent = JSON.parse(String(call[1]?.body));
    expect(sent.query).toBe(expectedQuery);
    expect(sent.context.stopCount).toBe(requested);
    expect(sent.intake.stopCount).toBe(requested);
    const parsed = await parsePlanGenerationRequest(new Request("http://localhost/api/plans/generate", { method: "POST", body: call[1]?.body }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.message);
    const effective = reconcilePlanContext(parsed.value.query, parsed.value.context, parsed.value.intake, new Date());
    expect(effective.context.stopCount).toBe(requested ?? 3);
    expect(parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))?.requestedStopCount).toBe(requested);
    expect(readPlanIntakeDraft()?.answers.stopCount).toBe(requested);
    await remountComposer();
    await openTune();
    expect(document.querySelector<HTMLSelectElement>("#plan-context-stops")?.value).toBe(String(requested ?? 3));
    expect(parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))?.requestedStopCount).toBe(requested);
  });

  it.each(["older", "equal", "legacy", "missing intake"])("keeps local route recovery when the session save is %s", async (age) => {
    seedCountRecovery(6);
    const savedAt = Date.now() - 2000;
    const routeKey = "pubmaxx:plan-route-draft:v1";
    const route = JSON.parse(localStorage.getItem(routeKey)!);
    route.savedAt = new Date(savedAt + (age === "missing intake" ? 2000 : 0)).toISOString();
    localStorage.setItem(routeKey, JSON.stringify(route));
    expect(writePlanIntakeDraft(readPlanIntakeDraft()!, localStorage, savedAt)).toBe(true);
    const plan = {
      ...parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))!,
      stops: [{ key: 1, venueId: "session-only", venueName: "Session pub" }],
    };
    if (age === "legacy") {
      sessionStorage.setItem(PLAN_DRAFT_KEY, JSON.stringify(plan));
    } else {
      expect(writePlanDraftEnvelope(plan, "manual", sessionStorage, savedAt + (age === "equal" ? 0 : age === "older" ? -1000 : 1000)).v2).toBe(true);
    }
    if (age === "missing intake") localStorage.removeItem(PLAN_INTAKE_STORAGE_KEY);
    await mountComposer();
    // Without a strictly newer dated session save, keep the established local route preference.
    expect([...document.querySelectorAll(".planStop__name")].map((node) => node.textContent)).toEqual(["Pub A", "Pub B"]);
  });

  it.each([
    { age: "older", offset: -1000, sessionWins: true },
    { age: "equal", offset: 0, sessionWins: false },
    { age: "newer", offset: 1000, sessionWins: false },
    { age: "undated", offset: null, sessionWins: true },
    { age: "invalid", offset: NaN, sessionWins: true },
    { age: "future", offset: 600_000, sessionWins: true },
  ])("uses the route record's $age date independently of intake saves", async ({ age, offset, sessionWins }) => {
    seedCountRecovery(6);
    const savedAt = Date.now() - 2000;
    const routeKey = "pubmaxx:plan-route-draft:v1";
    const route = JSON.parse(localStorage.getItem(routeKey)!);
    if (offset !== null) route.savedAt = age === "invalid" ? "not-a-date" : new Date(savedAt + offset).toISOString();
    localStorage.setItem(routeKey, JSON.stringify(route));
    expect(writePlanIntakeDraft(readPlanIntakeDraft()!, localStorage, savedAt)).toBe(true);
    const plan = {
      ...parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))!,
      stops: [{ key: 1, venueId: "session-only", venueName: "Session pub" }],
    };
    expect(writePlanDraftEnvelope(plan, "manual", sessionStorage, savedAt).v2).toBe(true);
    await mountComposer();
    expect([...document.querySelectorAll(".planStop__name")].map((node) => node.textContent))
      .toEqual(sessionWins ? ["Session pub"] : ["Pub A", "Pub B"]);
    if (sessionWins) {
      if (offset !== null && Number.isFinite(offset) && offset < 600_000) {
        expect(JSON.parse(localStorage.getItem(routeKey)!)).toMatchObject({
          nightContext: null, groundingProof: null, createOperationKey: null, planAnchor: null, routeStale: true,
        });
      }
      expect(document.querySelector(".planBudgetLedger")).toBeNull();
      expect(document.body.textContent).toContain("Opening and travel checks are unavailable for this restored draft.");
    }
  });

  it("keeps matching older dated stops as a refreshable preview without carrying unverified proof", async () => {
    seedCountRecovery(6);
    const routeKey = "pubmaxx:plan-route-draft:v1";
    const oldRoute = JSON.parse(localStorage.getItem(routeKey)!);
    oldRoute.savedAt = new Date(Date.now() - 1000).toISOString();
    localStorage.setItem(routeKey, JSON.stringify(oldRoute));
    const plan = parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))!;
    expect(writePlanDraftEnvelope(plan, "manual", sessionStorage).v2).toBe(true);
    await mountComposer();
    expect([...document.querySelectorAll(".planStop__name")].map((node) => node.textContent)).toEqual(["Pub A", "Pub B"]);
    const route = JSON.parse(localStorage.getItem("pubmaxx:plan-route-draft:v1")!);
    expect(route).toMatchObject({ routeStale: true, nightContext: null, groundingProof: null, planAnchor: null });
    expect(document.body.textContent).toContain("Opening and travel checks are unavailable for this restored draft.");
  });

  it("keeps a legacy route when no competing route record establishes a newer generation", async () => {
    seedCountRecovery();
    await mountComposer();
    expectDisplayedRoute(["Pub A", "Pub B"], ["venue-a", "venue-b"]);
    expect(JSON.parse(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)!)).toMatchObject({
      nightContext: { nightArea: "clapham", stopCount: 6 },
      groundingProof: "test-proof", routeStale: true,
    });
    expect(parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))?.requestedStopCount).toBeUndefined();
    await remountComposer();
    expectDisplayedRoute(["Pub A", "Pub B"], ["venue-a", "venue-b"]);
  });

  describe.each(["both", "local", "session", "neither"])("description recovery when %s stores can save", (available) => {
    it.each([
      { source: "Ask", query: "Clapham tonight", requested: undefined },
      { source: "Ask", query: "One pub in Clapham tonight", requested: 1 },
      { source: "URL", query: "Clapham tonight", requested: undefined },
      { source: "URL", query: "One pub in Clapham tonight", requested: 1 },
    ])("keeps query and count authority together for $source: $query", async ({ source, query, requested }) => {
      let now = Date.now();
      const clock = vi.spyOn(Date, "now").mockImplementation(() => now++);
      onTestFinished(() => clock.mockRestore());
      seedCountRecovery(6);
      const oldDraft = { ...parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))!, conciergeQuery: "Six pubs in Clapham tonight" };
      const savedAt = now - 1000;
      expect(writePlanDraftEnvelope(oldDraft, "manual", sessionStorage, savedAt).v2).toBe(true);
      expect(writePlanIntakeDraft(readPlanIntakeDraft()!, localStorage, savedAt)).toBe(true);
      if (source === "Ask") {
        writeAskPlanDraft({ query, stopIds: [], stopNames: [], createdAt: new Date(now).toISOString() });
      } else {
        window.history.replaceState({}, "", `/plan?query=${encodeURIComponent(query)}`);
      }
      const localCanSave = available === "both" || available === "local";
      const sessionCanSave = available === "both" || available === "session";
      const local = localCanSave ? localStorage : blockStorageWrites("localStorage");
      const session = sessionCanSave ? sessionStorage : blockStorageWrites("sessionStorage");
      const notices = () => [...document.querySelectorAll('[role="alert"]')].map((node) => node.textContent);
      const generations = () => fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/plans/generate"));

      await mountComposer();
      await openTune();
      expectTuneDescriptionAndCount(query, requested);
      expect(document.querySelectorAll(".planStop__name")).toHaveLength(2);
      if (!sessionCanSave) {
        expect(notices()).toContain(localCanSave
          ? "Your description could not be saved on this device. Keep this page open to keep it."
          : "Your changes could not be saved on this device. Keep this page open to keep them.");
      } else if (source === "URL" && !localCanSave) {
        expect(notices()).toContain(ROUTE_DETAILS_SAVE_FAILURE);
      } else {
        expect(notices().some((notice) => notice?.includes("could not be saved"))).toBe(false);
      }
      expect(readPlanIntakeDraft(local)?.answers.stopCount).toBe(localCanSave ? requested : 6);
      expect(parsePlanDraft(session.getItem(PLAN_DRAFT_KEY))?.conciergeQuery).toBe(sessionCanSave ? query : oldDraft.conciergeQuery);
      if (available === "both") {
        expect(readPlanDraftEnvelope(session)?.savedAt).toBe(readPlanIntakeDraftWithMetadata(local)?.savedAt);
      }
      if (source === "URL") {
        expect(generations()).toHaveLength(1);
        const automatic = JSON.parse(String(generations()[0]![1]?.body));
        expect(automatic.query).toBe(query);
        expect(automatic.context.stopCount).toBe(requested);
        expect(automatic.intake.stopCount).toBe(requested);
      }

      await sortAgainFromTune();
      const initialGenerations = source === "URL" ? 2 : 1;
      expect(generations()).toHaveLength(initialGenerations);
      const immediate = JSON.parse(String(generations().at(-1)![1]?.body));
      expect(immediate.query).toBe(query);
      expect(immediate.context.stopCount).toBe(requested);
      expect(immediate.intake.stopCount).toBe(requested);
      expect(readPlanIntakeDraft(local)?.answers.stopCount).toBe(localCanSave ? requested : 6);
      expect(parsePlanDraft(session.getItem(PLAN_DRAFT_KEY))?.requestedStopCount).toBe(sessionCanSave ? requested : 6);

      now += 1000;
      window.history.replaceState({}, "", "/plan");
      await remountComposer();
      expect(generations()).toHaveLength(initialGenerations);
      expect(document.querySelectorAll(".planStop__name")).toHaveLength(2);
      await openTune();
      const restoredQuery = available === "local" ? "" : available === "neither" ? oldDraft.conciergeQuery : query;
      const restoredCount = available === "neither" ? 6 : requested;
      expectTuneDescriptionAndCount(restoredQuery, restoredCount);
      if (available === "local") {
        expect(notices()).toContain("Your latest description could not be restored. Enter it again.");
      }
      await sortAgainFromTune();
      expect(generations()).toHaveLength(initialGenerations + 1);
      const restored = JSON.parse(String(generations().at(-1)![1]?.body));
      expect(restored.query).toBe(restoredQuery || undefined);
      expect(restored.context.stopCount).toBe(restoredCount);
      expect(restored.intake.stopCount).toBe(restoredCount);

      if (available === "local") {
        await openTune();
        await typeTuneQuery("One pub in Clapham tonight");
        expect(notices()).not.toContain("Your latest description could not be restored. Enter it again.");
        await sortAgainFromTune();
        expect(JSON.parse(String(generations().at(-1)![1]?.body)).context.stopCount).toBe(1);
        expect(readPlanIntakeDraft(local)?.answers.stopCount).toBe(1);
        expect(parsePlanDraft(session.getItem(PLAN_DRAFT_KEY))?.requestedStopCount).toBe(6);
      }
    });
  });

  it("keeps equal-time session query and explicit count ahead of conflicting local intake", async () => {
    seedCountRecovery(6);
    const savedAt = Date.now() - 1000;
    const plan = { ...parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))!, conciergeQuery: "One pub in Clapham tonight", requestedStopCount: 3 as const };
    expect(writePlanDraftEnvelope(plan, "manual", sessionStorage, savedAt).v2).toBe(true);
    expect(writePlanIntakeDraft(readPlanIntakeDraft()!, localStorage, savedAt)).toBe(true);
    await mountComposer();
    await openTune();
    expect(document.querySelector<HTMLInputElement>("#plan-concierge-query")?.value).toBe(plan.conciergeQuery);
    expect(document.querySelector<HTMLSelectElement>("#plan-context-stops")?.value).toBe("3");
    expect(document.body.textContent).not.toContain("could not be restored");
    await sortAgainFromTune();
    const call = fetchMock.mock.calls.find(([input]) => String(input).includes("/api/plans/generate"))!;
    const sent = JSON.parse(String(call[1]?.body));
    expect(sent.query).toBe("One pub in Clapham tonight");
    expect(sent.context.stopCount).toBe(3);
    expect(sent.intake.stopCount).toBeUndefined();
    expect(parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))?.requestedStopCount).toBe(3);
    expect(readPlanIntakeDraft()?.answers.stopCount).toBe(3);
  });

  it.each(["undated", "conflicting copies"])("does not infer counts from an uncertain %s session description", async (kind) => {
    seedCountRecovery();
    const oldDraft = { ...parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))!, conciergeQuery: "Six pubs in Clapham tonight" };
    sessionStorage.setItem(PLAN_DRAFT_KEY, JSON.stringify(oldDraft));
    if (kind === "conflicting copies") {
      // Keep the local route authoritative while the session copies disagree.
      const routeKey = "pubmaxx:plan-route-draft:v1";
      const route = JSON.parse(localStorage.getItem(routeKey)!);
      route.savedAt = new Date().toISOString();
      localStorage.setItem(routeKey, JSON.stringify(route));
      expect(writePlanDraftEnvelope(oldDraft, "manual", sessionStorage, Date.now() - 1000).v2).toBe(true);
      sessionStorage.setItem(PLAN_DRAFT_KEY, JSON.stringify({ ...oldDraft, conciergeQuery: "One pub in Clapham tonight" }));
    }
    await mountComposer();
    await openTune();
    expect(document.querySelectorAll(".planStop__name")).toHaveLength(2);
    expect(document.querySelector<HTMLInputElement>("#plan-concierge-query")?.value).toBe("");
    expect(document.querySelector<HTMLSelectElement>("#plan-context-stops")?.value).toBe("3");
    expect(document.body.textContent).toContain("Your latest description could not be restored. Enter it again.");
    await sortAgainFromTune();
    const call = fetchMock.mock.calls.find(([input]) => String(input).includes("/api/plans/generate"))!;
    const sent = JSON.parse(String(call[1]?.body));
    expect(sent.query).toBeUndefined();
    expect(sent.context.stopCount).toBeUndefined();
    expect(sent.intake.stopCount).toBeUndefined();
    expect(parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))?.requestedStopCount).toBeUndefined();
  });

  it.each([
    { reload: false, localWritesBlocked: false },
    { reload: false, localWritesBlocked: true },
    { reload: true, localWritesBlocked: false },
    { reload: true, localWritesBlocked: true },
  ])("uses a new unsized Ask without retyping after reload $reload with blocked local writes $localWritesBlocked", async ({ reload, localWritesBlocked }) => {
    sessionStorage.setItem(PLAN_DRAFT_KEY, JSON.stringify({
      title: "Night", creatorName: "", startTime: "", conciergeQuery: "Six pubs in Clapham tonight",
      requestedStopCount: 6,
      stops: GENERATED.stops.map((stop, index) => ({ key: index + 1, venueId: stop.venueId, venueName: stop.venueName })),
    }));
    const local = localWritesBlocked ? blockStorageWrites("localStorage") : localStorage;
    writeAskPlanDraft({ query: "Clapham tonight", stopIds: [], stopNames: [], createdAt: new Date().toISOString() });
    await mountComposer();
    expect(sessionStorage.getItem(ASK_PLAN_DRAFT_STORAGE_KEY)).toBeNull();
    expect(document.querySelector<HTMLInputElement>("#plan-describe-first-query")?.value).toBe("Clapham tonight");
    expect(document.querySelector('[aria-label="Number of pub stops"] button[aria-pressed="true"]')?.textContent?.trim()).toBe("3");
    expect(parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))).toMatchObject({ conciergeQuery: "Clapham tonight" });
    expect(parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))?.requestedStopCount).toBeUndefined();
    if (reload) await remountComposer();
    expect(document.querySelector<HTMLInputElement>("#plan-concierge-query")?.value).toBe("Clapham tonight");
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/plans/generate"))).toHaveLength(0);
    const generate = [...document.querySelectorAll<HTMLButtonElement>(".planComposer__concierge button")]
      .find((button) => button.textContent?.trim() === "Make a plan")!;
    expect(generate.disabled).toBe(false);
    await act(async () => { generate.click(); });
    await settle();
    const generations = fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/plans/generate"));
    expect(generations).toHaveLength(1);
    const sent = JSON.parse(String(generations[0]![1]?.body));
    expect(sent.query).toBe("Clapham tonight");
    expect(sent.context.stopCount).toBeUndefined();
    expect(sent.intake.stopCount).toBeUndefined();
    expect(parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))).toMatchObject({ conciergeQuery: "Clapham tonight" });
    expect(parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))?.requestedStopCount).toBeUndefined();
    if (localWritesBlocked) expect(local.getItem(PLAN_INTAKE_STORAGE_KEY)).toBeNull();
    else {
      expect(readPlanIntakeDraft(local)).not.toBeNull();
      expect(readPlanIntakeDraft(local)?.answers.stopCount).toBeUndefined();
    }
    expect(document.body.textContent).not.toContain("Your changes could not be saved");
    await openTune();
    expect(document.querySelector<HTMLInputElement>("#plan-concierge-query")?.value).toBe("Clapham tonight");
    expect(document.querySelector<HTMLSelectElement>("#plan-context-stops")?.value).toBe("3");
  });

  it.each(["Ask", "URL"])("keeps a new unsized %s handoff authoritative over unwritable old intake", async (source) => {
    seedCountRecovery(6);
    const local = blockStorageWrites("localStorage");
    if (source === "Ask") {
      writeAskPlanDraft({ query: "Clapham tonight", stopIds: [], stopNames: [], createdAt: new Date().toISOString() });
    } else {
      window.history.replaceState({}, "", "/plan?query=Clapham%20tonight");
    }
    await mountComposer();
    expect(parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))?.requestedStopCount).toBeUndefined();
    expect(readPlanIntakeDraft(local)?.answers.stopCount).toBe(6);
    if (source === "URL") {
      const call = fetchMock.mock.calls.find(([input]) => String(input).includes("/api/plans/generate"))!;
      const sent = JSON.parse(String(call[1]?.body));
      expect(sent.context.stopCount).toBeUndefined();
      expect(sent.intake.stopCount).toBeUndefined();
    }
    window.history.replaceState({}, "", "/plan");
    await remountComposer();
    await openTune();
    expect(document.querySelector<HTMLSelectElement>("#plan-context-stops")?.value).toBe("3");
    expect(parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))?.requestedStopCount).toBeUndefined();
    await typeTuneQuery("One pub in Clapham tonight");
    await sortAgainFromTune();
    const generations = fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/plans/generate"));
    const sent = JSON.parse(String(generations.at(-1)![1]?.body));
    expect(sent.context.stopCount).toBe(1);
    expect(sent.intake.stopCount).toBe(1);
    expect(parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))?.requestedStopCount).toBe(1);
    expect(readPlanIntakeDraft(local)?.answers.stopCount).toBe(6);
    expect(document.body.textContent).not.toContain("Your changes could not be saved");
    await remountComposer();
    await openTune();
    expect(document.querySelector<HTMLSelectElement>("#plan-context-stops")?.value).toBe("1");
    await typeTuneQuery("Clapham tonight");
    await sortAgainFromTune();
    const last = fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/plans/generate")).at(-1)!;
    expect(JSON.parse(String(last[1]?.body)).context.stopCount).toBe(1);
  });

  describe.each([false, true])("typed Tune count with local writes blocked: %s", (localWritesBlocked) => {
    it.each([
      { query: "One pub in Clapham tonight", requested: 1 },
      { query: "3 pubs in Clapham tonight", requested: 3 },
    ])("records $requested from Tune text after an unsized generation", async ({ query, requested }) => {
      if (localWritesBlocked) blockStorageWrites("localStorage");
      await mountComposer();
      await sortIt("Clapham tonight");
      expect(parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))?.requestedStopCount).toBeUndefined();
      await openTune();
      await typeTuneQuery(query);
      await sortAgainFromTune();
      const calls = fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/plans/generate"));
      expect(calls).toHaveLength(2);
      const sent = JSON.parse(String(calls[1]![1]?.body));
      expect(sent.context.stopCount).toBe(requested);
      expect(sent.intake.stopCount).toBe(requested === 3 ? undefined : requested);
      expect(document.querySelectorAll(".planStop__name")).toHaveLength(2);
      expect(parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))?.requestedStopCount).toBe(requested);
      await remountComposer();
      if (!localWritesBlocked) await openTune();
      const selected = localWritesBlocked
        ? document.querySelector('[aria-label="Number of pub stops"] button[aria-pressed="true"]')?.textContent?.trim()
        : document.querySelector<HTMLSelectElement>("#plan-context-stops")?.value;
      expect(selected).toBe(String(requested));
    });

    it.each(["button", "Enter", "Regenerate route"])("saves text intent through %s and restores the picker", async (action) => {
      seedCountRecovery();
      if (localWritesBlocked) blockStorageWrites("localStorage");
      await mountComposer();
      await openTune();
      await typeTuneQuery("One pub in Clapham tonight");
      if (action === "button") await sortAgainFromTune();
      else if (action === "Enter") {
        await act(async () => {
          document.querySelector<HTMLInputElement>("#plan-concierge-query")!.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
          );
        });
        await settle();
      } else {
        const close = document.querySelector<HTMLButtonElement>('button[aria-label="Close Tune details"]')!;
        await act(async () => { close.click(); });
        const regenerate = [...document.querySelectorAll<HTMLButtonElement>("button")]
          .find((button) => button.textContent?.trim() === "Regenerate route")!;
        await act(async () => { regenerate.click(); });
        await settle();
      }
      const generations = fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/plans/generate"));
      expect(generations).toHaveLength(1);
      const sent = JSON.parse(String(generations[0]![1]?.body));
      expect(sent.context.stopCount).toBe(1);
      expect(sent.intake.stopCount).toBe(1);
      expect(document.querySelectorAll(".planStop__name")).toHaveLength(2);
      expect(parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))?.requestedStopCount).toBe(1);
      if (!localWritesBlocked) expect(readPlanIntakeDraft()?.answers.stopCount).toBe(1);
      await remountComposer();
      await openTune();
      expect(document.querySelector<HTMLSelectElement>("#plan-context-stops")?.value).toBe("1");
      await typeTuneQuery("Clapham tonight");
      await sortAgainFromTune();
      const next = fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/plans/generate")).at(-1)!;
      expect(JSON.parse(String(next[1]?.body)).context.stopCount).toBe(1);
    });
  });

  it("recovers the newer local count when session writes fail", async () => {
    seedCountRecovery();
    await mountComposer();
    const session = blockStorageWrites("sessionStorage");
    await openTune();
    const picker = document.querySelector<HTMLSelectElement>("#plan-context-stops")!;
    await act(async () => {
      picker.value = "5";
      picker.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(readPlanIntakeDraft()?.answers.stopCount).toBe(5);
    expect(parsePlanDraft(session.getItem(PLAN_DRAFT_KEY))?.requestedStopCount).toBeUndefined();
    await remountComposer();
    await openTune();
    expect(document.querySelector<HTMLSelectElement>("#plan-context-stops")?.value).toBe("5");
    await typeTuneQuery("Clapham tonight");
    await sortAgainFromTune();
    const generation = fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/plans/generate")).at(-1)!;
    expect(JSON.parse(String(generation[1]?.body)).context.stopCount).toBe(5);
  });

  it.each(["both", "session", "neither"])("keeps an explicit picker choice when %s storage can save", async (available) => {
    seedCountRecovery();
    const local = available === "both" ? localStorage : blockStorageWrites("localStorage");
    const session = available === "neither" ? blockStorageWrites("sessionStorage") : sessionStorage;
    await mountComposer();
    await openTune();
    const picker = document.querySelector<HTMLSelectElement>("#plan-context-stops")!;
    await act(async () => {
      picker.value = "5";
      picker.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await typeTuneQuery("One pub in Clapham tonight");
    await sortAgainFromTune();
    const call = fetchMock.mock.calls.find(([input]) => String(input).includes("/api/plans/generate"))!;
    const sent = JSON.parse(String(call[1]?.body));
    expect(sent.context.stopCount).toBe(5);
    expect(sent.intake.stopCount).toBe(5);
    await openTune();
    expect(document.querySelector<HTMLSelectElement>("#plan-context-stops")?.value).toBe("5");
    if (available === "neither") {
      expect([...document.querySelectorAll('[role="alert"]')].some((notice) =>
        notice.textContent === "Your changes could not be saved on this device. Keep this page open to keep them.")).toBe(true);
      expect(readPlanIntakeDraft(local)?.answers.stopCount).toBeUndefined();
      expect(parsePlanDraft(session.getItem(PLAN_DRAFT_KEY))?.requestedStopCount).toBeUndefined();
    } else {
      expect(document.body.textContent).not.toContain("Your changes could not be saved");
      if (available === "both") {
        expect(readPlanIntakeDraft(local)?.answers.stopCount).toBe(5);
      }
      expect(parsePlanDraft(session.getItem(PLAN_DRAFT_KEY))?.requestedStopCount).toBe(5);
      await remountComposer();
      await openTune();
      expect(document.querySelector<HTMLSelectElement>("#plan-context-stops")?.value).toBe("5");
    }
  });

  it.each([undefined, 1])("keeps an unsized automatic handoff unknown after recovering %s", async (recoveredCount) => {
    sessionStorage.setItem(PLAN_DRAFT_KEY, JSON.stringify({
      title: "Night", creatorName: "", startTime: "", conciergeQuery: "Earlier night",
      stops: [{ key: 1, venueId: "venue-a", venueName: "Pub A" }],
      requestedStopCount: recoveredCount,
    }));
    const storage = localStorage;
    vi.stubGlobal("localStorage", {
      getItem: storage.getItem.bind(storage),
      setItem: () => { throw new DOMException("Storage is full", "QuotaExceededError"); },
      removeItem: storage.removeItem.bind(storage), clear: storage.clear.bind(storage),
      key: storage.key.bind(storage), get length() { return storage.length; },
    } satisfies Storage);
    fetchMock.mockImplementation(async (input) => new Response(JSON.stringify(
      String(input).includes("/api/plans/generate")
        ? { ...GENERATED, inferredContext: { ...GENERATED.inferredContext, stopCount: 3 } }
        : [],
    ), { status: 200, headers: { "content-type": "application/json" } }));
    window.history.replaceState({}, "", "/plan?query=Clapham%20tonight");
    await mountComposer();
    const generations = () => fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/plans/generate"));
    expect(generations()).toHaveLength(1);
    const sent = JSON.parse(String(generations()[0]![1]?.body));
    expect(sent.query).toBe("Clapham tonight");
    expect(sent.context.stopCount).toBeUndefined();
    expect(sent.intake.stopCount).toBeUndefined();
    expect(inferNightContext(sent.query).context.stopCount).toBe(3);
    expect(document.querySelectorAll(".planStop__name")).toHaveLength(2);
    expect(parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))?.requestedStopCount).toBeUndefined();
    expect(storage.getItem(PLAN_INTAKE_STORAGE_KEY)).toBeNull();
    window.history.replaceState({}, "", "/plan");
    await remountComposer();
    expect(generations()).toHaveLength(1);
    expect(document.querySelector('[aria-label="Number of pub stops"] button[aria-pressed="true"]')?.textContent?.trim()).toBe("3");
    const field = document.querySelector<HTMLInputElement>("#plan-describe-first-query")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "One pub in Clapham tonight");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(document.querySelector('[aria-label="Number of pub stops"] button[aria-pressed="true"]')?.textContent?.trim()).toBe("1");
    await sortIt("One pub in Clapham tonight");
    expect(generations()).toHaveLength(2);
    const next = JSON.parse(String(generations()[1]![1]?.body));
    expect(next.context.stopCount).toBe(1);
    expect(next.intake.stopCount).toBe(1);
    expect(parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))?.requestedStopCount).toBe(1);
  });

  describe.each(["session-only", "unfinished intake", "completed intake"])("a new Ask handoff with %s recovery", (recovery) => {
    it.each([
      { query: "One pub in Clapham tonight", requested: 1 },
      { query: "3 pubs in Clapham tonight", requested: 3 },
      { query: "Three pubs in Clapham tonight", requested: 3 },
      { query: "Clapham tonight", requested: undefined },
    ])("replaces the recovered count with $requested for $query", async ({ query, requested }) => {
      sessionStorage.setItem(PLAN_DRAFT_KEY, JSON.stringify({
        title: "Night", creatorName: "", startTime: "", conciergeQuery: "Earlier night",
        stops: [{ key: 1, venueId: "venue-a", venueName: "Pub A" }],
        requestedStopCount: 6,
      }));
      if (recovery === "session-only") {
        const storage = localStorage;
        vi.stubGlobal("localStorage", {
          getItem: storage.getItem.bind(storage),
          setItem: () => { throw new DOMException("Storage is full", "QuotaExceededError"); },
          removeItem: storage.removeItem.bind(storage), clear: storage.clear.bind(storage),
          key: storage.key.bind(storage), get length() { return storage.length; },
        } satisfies Storage);
      } else {
        const intake = createPlanIntakeDraft();
        const draft = { ...intake, answers: { ...intake.answers, stopCount: 6 as const } };
        writePlanIntakeDraft(recovery === "completed intake" ? skipRemainingPlanIntake(draft) : draft);
        if (recovery === "completed intake") {
          localStorage.setItem("pubmaxx:plan-route-draft:v1", JSON.stringify({
            stops: GENERATED.stops,
            nightContext: { nightArea: "clapham", daypart: "evening", partyType: "friends", budget: "standard", stopCount: 6 },
            groundingProof: "test-proof",
          }));
        }
      }
      writeAskPlanDraft({ query, stopIds: [], stopNames: [], createdAt: new Date().toISOString() });
      await mountComposer();
      expect(sessionStorage.getItem(ASK_PLAN_DRAFT_STORAGE_KEY)).toBeNull();
      expect(parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))?.requestedStopCount).toBe(requested);
      if (recovery !== "session-only") {
        expect(JSON.parse(localStorage.getItem(PLAN_INTAKE_STORAGE_KEY) ?? "null")?.draft.answers.stopCount).toBe(requested);
      }
      expect(fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/plans/generate"))).toHaveLength(0);
      if (recovery === "completed intake") {
        await openTune();
        expect(document.querySelector<HTMLInputElement>("#plan-concierge-query")?.value).toBe(query);
        expect(document.querySelector<HTMLSelectElement>("#plan-context-stops")?.value).toBe(String(requested ?? 3));
        await sortAgainFromTune();
      } else {
        expect(document.querySelector<HTMLInputElement>("#plan-describe-first-query")?.value).toBe(query);
        expect(document.querySelector('[aria-label="Number of pub stops"] button[aria-pressed="true"]')?.textContent?.trim()).toBe(String(requested ?? 3));
        await sortIt(query);
      }
      const generations = fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/plans/generate"));
      expect(generations).toHaveLength(1);
      const sent = JSON.parse(String(generations[0]![1]?.body));
      expect(sent.query).toBe(query);
      expect(sent.context.stopCount).toBe(requested);
      expect(sent.intake.stopCount).toBe(requested === 3 ? undefined : requested);
      expect(document.querySelectorAll(".planStop__name")).toHaveLength(2);
      expect(parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))?.requestedStopCount).toBe(requested);
      await remountComposer();
      expect(fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/plans/generate"))).toHaveLength(1);
      expect(parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))?.requestedStopCount).toBe(requested);
    });
  });

  it.each(["typed", "chip"])("keeps an unsized %s request unknown across generation and reload", async (entry) => {
    await mountComposer();
    if (entry === "typed") await sortIt("Clapham tonight");
    else {
      const chip = document.querySelector<HTMLButtonElement>('[aria-label="Try an example"] .planDescribeFirst__chip:not(.planDescribeFirst__chip--culture)')!;
      await act(async () => { chip.click(); });
      await settle();
    }
    const generations = fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/plans/generate"));
    expect(generations).toHaveLength(1);
    const sent = JSON.parse(String(generations[0]![1]?.body));
    expect(sent.context.stopCount).toBeUndefined();
    expect(sent.intake.stopCount).toBeUndefined();
    expect(parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))?.requestedStopCount).toBeUndefined();
    await remountComposer();
    expect(parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))?.requestedStopCount).toBeUndefined();
  });

  it.each([false, true])("keeps an unsized occasion unknown before a typed one-pub request with recovery %s", async (recovered) => {
    if (recovered) {
      sessionStorage.setItem(PLAN_DRAFT_KEY, JSON.stringify({
        title: "Night", creatorName: "", startTime: "", conciergeQuery: "Clapham tonight",
        stops: GENERATED.stops.map((stop, index) => ({ key: index + 1, venueId: stop.venueId, venueName: stop.venueName })),
        requestedStopCount: 3,
      }));
    }
    window.history.replaceState({}, "", "/plan?occasion=quiet");
    await mountComposer();
    expect(document.querySelector<HTMLInputElement>("#plan-describe-first-query")?.value).toBe("Quiet in Clapham for 4, not pricey");
    expect(parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))?.requestedStopCount).toBeUndefined();
    expect(JSON.parse(localStorage.getItem(PLAN_INTAKE_STORAGE_KEY) ?? "null")?.draft.answers.stopCount).toBeUndefined();
    const field = document.querySelector<HTMLInputElement>("#plan-describe-first-query")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "One pub in Clapham tonight");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(document.querySelector('[aria-label="Number of pub stops"] button[aria-pressed="true"]')?.textContent?.trim()).toBe("1");
    await sortIt("One pub in Clapham tonight");
    const generations = fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/plans/generate"));
    expect(generations).toHaveLength(1);
    const sent = JSON.parse(String(generations.at(-1)![1]?.body));
    expect(sent.context.stopCount).toBe(1);
    expect(sent.intake.stopCount).toBe(1);
    expect(document.querySelectorAll(".planStop__name")).toHaveLength(2);
    expect(parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))?.requestedStopCount).toBe(1);
    window.history.replaceState({}, "", "/plan");
    await remountComposer();
    expect(document.querySelectorAll(".planStop__name")).toHaveLength(2);
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/plans/generate"))).toHaveLength(1);
    expect(parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))?.requestedStopCount).toBe(1);
  });

  it.each([3, 6])("preserves an explicit picker choice of %s after an unsized occasion", async (requested) => {
    window.history.replaceState({}, "", "/plan?occasion=quiet");
    await mountComposer();
    const picker = document.querySelector('[aria-label="Number of pub stops"]')!;
    const choice = [...picker.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === String(requested))!;
    await act(async () => { choice.click(); });
    await sortIt("One pub in Clapham tonight");
    const generation = fetchMock.mock.calls.find(([input]) => String(input).includes("/api/plans/generate"));
    const sent = JSON.parse(String(generation![1]?.body));
    expect(sent.context.stopCount).toBe(requested);
    expect(sent.intake.stopCount).toBe(requested === 3 ? undefined : requested);
    expect(parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))?.requestedStopCount).toBe(requested);
  });

  it("clears a recovered intake count when an unsized occasion opens the completed composer", async () => {
    sessionStorage.setItem(PLAN_DRAFT_KEY, JSON.stringify({
      title: "Night", creatorName: "", startTime: "", conciergeQuery: "Clapham tonight",
      stops: GENERATED.stops.map((stop, index) => ({ key: index + 1, venueId: stop.venueId, venueName: stop.venueName })),
      requestedStopCount: 3,
    }));
    localStorage.setItem("pubmaxx:plan-route-draft:v1", JSON.stringify({
      stops: GENERATED.stops,
      nightContext: { nightArea: "clapham", daypart: "evening", partyType: "friends", budget: "standard", stopCount: 3 },
      groundingProof: "test-proof",
    }));
    const intake = createPlanIntakeDraft();
    writePlanIntakeDraft(skipRemainingPlanIntake({ ...intake, answers: { ...intake.answers, stopCount: 3 } }));
    window.history.replaceState({}, "", "/plan?occasion=quiet");
    await mountComposer();
    await openTune();
    expect(document.querySelector<HTMLInputElement>("#plan-concierge-query")?.value).toBe("Quiet in Clapham for 4, not pricey");
    expect(parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))?.requestedStopCount).toBeUndefined();
    expect(JSON.parse(localStorage.getItem(PLAN_INTAKE_STORAGE_KEY) ?? "null")?.draft.answers.stopCount).toBeUndefined();
    await sortAgainFromTune();
    const generations = fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/plans/generate"));
    expect(generations).toHaveLength(1);
    const sent = JSON.parse(String(generations[0]![1]?.body));
    expect(sent.context.stopCount).toBeUndefined();
    expect(sent.intake.stopCount).toBeUndefined();
    expect(parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))?.requestedStopCount).toBeUndefined();
  });

  it("uses a positive pub-count request in typed text without a picker override", async () => {
    await mountComposer();
    await sortIt("One pub in Clapham tonight");
    const generation = fetchMock.mock.calls.find(([input]) => String(input).includes("/api/plans/generate"));
    expect(generation).toBeDefined();
    const sent = JSON.parse(String(generation![1]?.body));
    expect(sent.context.stopCount).toBe(1);
    expect(sent.intake.stopCount).toBe(1);
    expect(parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))?.requestedStopCount).toBe(1);
  });

  it.each([
    { action: "remove", requested: 2 },
    { action: "add", requested: 4 },
  ])("uses the mounted picker after an explicit $action on a session-restored route", async ({ action, requested }) => {
    const storage = localStorage;
    vi.stubGlobal("localStorage", {
      getItem: storage.getItem.bind(storage),
      setItem: () => { throw new DOMException("Storage is full", "QuotaExceededError"); },
      removeItem: storage.removeItem.bind(storage), clear: storage.clear.bind(storage),
      key: storage.key.bind(storage), get length() { return storage.length; },
    } satisfies Storage);
    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return new Response(JSON.stringify(url.includes("/api/plans/generate")
        ? { ...GENERATED, stops: [...GENERATED.stops, { venueId: "venue-c", venueName: "Pub C" }], inferredContext: { ...GENERATED.inferredContext, stopCount: 3 } }
        : []), { status: 200, headers: { "content-type": "application/json" } });
    });
    const selectedCount = () => document.querySelector('[aria-label="Number of pub stops"] button[aria-pressed="true"]')?.textContent?.trim();
    await mountComposer();
    await sortIt("Clapham tonight");
    await remountComposer();
    expect(selectedCount()).toBe("3");
    const control = action === "remove"
      ? document.querySelector<HTMLButtonElement>('button[aria-label="Remove stop 3"]')!
      : document.querySelector<HTMLButtonElement>(".planStops__add")!;
    await act(async () => { control.click(); });
    await settle();
    expect(selectedCount()).toBe(String(requested));
    expect(parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))?.requestedStopCount).toBe(requested);
    await sortIt("One pub in Clapham tonight");
    const generations = () => fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/plans/generate"));
    expect(generations()).toHaveLength(2);
    const sent = JSON.parse(String(generations()[1]![1]?.body));
    expect(sent.context.stopCount).toBe(requested);
    expect(sent.intake.stopCount).toBe(requested);
    expect(document.querySelectorAll(".planStop__name")).toHaveLength(3);
    expect(parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))?.requestedStopCount).toBe(requested);
    await remountComposer();
    expect(selectedCount()).toBe(String(requested));
    const makePlan = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "Make a plan")!;
    await act(async () => { makePlan.click(); });
    await settle();
    expect(generations()).toHaveLength(3);
    const restored = JSON.parse(String(generations()[2]![1]?.body));
    expect(restored.context.stopCount).toBe(requested);
    expect(restored.intake.stopCount).toBe(requested);
    expect(parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))?.requestedStopCount).toBe(requested);
    expect(storage.getItem("pubmaxx:plan-route-draft:v1")).toBeNull();
  });

  it.each([
    { field: "budget", value: "value" },
    { field: "area", value: "piccadilly-soho" },
    { field: "time", value: "after_work" },
    { field: "group", value: "solo" },
    { field: "people", value: "2" },
    { field: "budget-limit", value: "25" },
    { field: "zero-proof", value: "zero-proof" },
  ])("preserves an unknown legacy request after a Tune $field edit, reload and generation", async ({ field, value }) => {
    sessionStorage.setItem(PLAN_DRAFT_KEY, JSON.stringify({
      title: "Night", creatorName: "", startTime: "", conciergeQuery: "Clapham tonight",
      stops: GENERATED.stops.map((stop, index) => ({ key: index + 1, venueId: stop.venueId, venueName: stop.venueName })),
    }));
    localStorage.setItem("pubmaxx:plan-route-draft:v1", JSON.stringify({
      stops: GENERATED.stops,
      nightContext: { nightArea: "clapham", daypart: "evening", partyType: "friends", budget: "standard", stopCount: 2 },
      groundingProof: "test-proof",
    }));
    await mountComposer();
    await openTune();
    const control = document.querySelector<HTMLInputElement | HTMLSelectElement>(`#plan-context-${field}`)!;
    await act(async () => {
      if (control instanceof HTMLInputElement) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(control, value);
        control.dispatchEvent(new Event("input", { bubbles: true }));
      } else {
        control.value = value;
        control.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    expect(control.value).toBe(value);
    expect(JSON.parse(localStorage.getItem(PLAN_INTAKE_STORAGE_KEY) ?? "null")?.draft.answers.stopCount).toBeUndefined();
    expect(parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))?.requestedStopCount).toBeUndefined();
    await remountComposer();
    await openTune();
    await sortAgainFromTune();
    const generations = fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/plans/generate"));
    expect(generations).toHaveLength(1);
    const sent = JSON.parse(String(generations[0]![1]?.body));
    expect(sent.intake.stopCount).toBeUndefined();
    expect(sent.context.stopCount).toBeUndefined();
    expect(parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))?.requestedStopCount).toBeUndefined();
    await remountComposer();
    expect(parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))?.requestedStopCount).toBeUndefined();
  });

  it.each([
    { requested: 1, query: "Clapham tonight" },
    { requested: 3, query: "One pub in Clapham tonight" },
  ])("restores requested $requested after one returned stop for $query and session-only recovery", async ({ requested, query }) => {
    const storage = localStorage;
    vi.stubGlobal("localStorage", {
      getItem: storage.getItem.bind(storage),
      setItem: () => { throw new DOMException("Storage is full", "QuotaExceededError"); },
      removeItem: storage.removeItem.bind(storage), clear: storage.clear.bind(storage),
      key: storage.key.bind(storage), get length() { return storage.length; },
    } satisfies Storage);
    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return new Response(JSON.stringify(url.includes("/api/plans/generate")
        ? { ...GENERATED, stops: [GENERATED.stops[0]], inferredContext: { ...GENERATED.inferredContext, stopCount: requested } } : []),
      { status: 200, headers: { "content-type": "application/json" } });
    });
    await mountComposer();
    const countButton = () => [...document.querySelectorAll<HTMLButtonElement>('[aria-label="Number of pub stops"] button')]
      .find((button) => button.textContent?.trim() === String(requested))!;
    await act(async () => { countButton().click(); });
    await sortIt(query);
    const generation = fetchMock.mock.calls.find(([input]) => String(input).includes("/api/plans/generate"));
    expect(generation).toBeDefined();
    const sent = JSON.parse(String(generation![1]?.body));
    expect(sent.context?.stopCount).toBe(requested);
    expect(parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))?.requestedStopCount).toBe(requested);
    expect(document.querySelectorAll(".planStop__name")).toHaveLength(1);
    await remountComposer();
    expect(document.body.textContent).toContain("Pub A");
    expect(countButton().getAttribute("aria-pressed")).toBe("true");
    const field = document.querySelector<HTMLInputElement>("#plan-describe-first-query")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "Quiet in Soho");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(countButton().getAttribute("aria-pressed")).toBe("true");
    const makePlan = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "Make a plan")!;
    await act(async () => { makePlan.click(); });
    await settle();
    const generations = fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/plans/generate"));
    expect(generations).toHaveLength(2);
    expect(JSON.parse(String(generations[1]![1]?.body)).context.stopCount).toBe(requested);
    expect(parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))?.requestedStopCount).toBe(requested);
  });

  it.each([undefined, 7])("keeps the route and uses the default picker for legacy or invalid count %s", async (count) => {
    sessionStorage.setItem(PLAN_DRAFT_KEY, JSON.stringify({ title: "Night", creatorName: "", startTime: "", conciergeQuery: "", stops: [{ key: 1, venueId: "venue-a", venueName: "Pub A" }], requestedStopCount: count }));
    await mountComposer();
    expect(document.body.textContent).toContain("Pub A");
    const selected = document.querySelector('[aria-label="Number of pub stops"] button[aria-pressed="true"]');
    expect(selected?.textContent?.trim()).toBe("3");
  });

  it.each(["3", "three"])("lets an explicit %s-pub handoff URL replace a recovered stop count", async (count) => {
    sessionStorage.setItem(PLAN_DRAFT_KEY, JSON.stringify({ title: "Night", creatorName: "", startTime: "", conciergeQuery: "", stops: [{ key: 1, venueId: "venue-a", venueName: "Pub A" }], requestedStopCount: 1 }));
    window.history.replaceState({}, "", `/plan?query=${encodeURIComponent(`quiet in Soho for ${count} pubs`)}`);
    await mountComposer();
    const generation = fetchMock.mock.calls.find(([input]) => String(input).includes("/api/plans/generate"));
    expect(generation).toBeDefined();
    const sent = JSON.parse(String(generation![1]?.body));
    expect(sent.query).toBe(`quiet in Soho for ${count} pubs`);
    expect(sent.context?.stopCount).toBe(3);
    expect(parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))?.requestedStopCount).toBe(3);
  });

  it("lets an incoming one-pub handoff supersede a recovered request for three", async () => {
    sessionStorage.setItem(PLAN_DRAFT_KEY, JSON.stringify({ title: "Night", creatorName: "", startTime: "", conciergeQuery: "", stops: [{ key: 1, venueId: "venue-a", venueName: "Pub A" }], requestedStopCount: 3 }));
    window.history.replaceState({}, "", "/plan?query=One%20pub%20in%20Clapham%20tonight");
    await mountComposer();
    const generation = fetchMock.mock.calls.find(([input]) => String(input).includes("/api/plans/generate"));
    expect(generation).toBeDefined();
    const sent = JSON.parse(String(generation![1]?.body));
    expect(sent.query).toBe("One pub in Clapham tonight");
    expect(sent.context?.stopCount).toBe(1);
    expect(parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))?.requestedStopCount).toBe(1);
    window.history.replaceState({}, "", "/plan");
    await remountComposer();
    await openTune();
    const generate = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "Plan it again")!;
    await act(async () => { generate.click(); });
    await settle();
    const generations = fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/plans/generate"));
    expect(generations).toHaveLength(2);
    expect(JSON.parse(String(generations[1]![1]?.body)).context.stopCount).toBe(1);
  });

  it.each([1, 3, 6])("preserves a Tune request for %s through reload and regeneration", async (requested) => {
    await mountComposer();
    await sortIt("Clapham tonight");
    await openTune();
    const select = document.querySelector<HTMLSelectElement>("#plan-context-stops")!;
    await act(async () => {
      select.value = String(requested);
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))?.requestedStopCount).toBe(requested);
    await remountComposer();
    await openTune();
    const generate = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "Plan it again")!;
    await act(async () => { generate.click(); });
    await settle();
    const generations = fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/plans/generate"));
    expect(generations).toHaveLength(2);
    expect(JSON.parse(String(generations[1]![1]?.body)).context.stopCount).toBe(requested);
  });

  it.each([
    { action: "remove", requested: 2, localWritesFail: false },
    { action: "add", requested: 4, localWritesFail: false },
    { action: "remove", requested: 2, localWritesFail: true },
    { action: "add", requested: 4, localWritesFail: true },
  ])("preserves an explicit $action through regeneration and reload with blocked local writes $localWritesFail", async ({ action, requested, localWritesFail }) => {
    const storage = localStorage;
    if (localWritesFail) {
      vi.stubGlobal("localStorage", {
        getItem: storage.getItem.bind(storage),
        setItem: () => { throw new DOMException("Storage is full", "QuotaExceededError"); },
        removeItem: storage.removeItem.bind(storage), clear: storage.clear.bind(storage),
        key: storage.key.bind(storage), get length() { return storage.length; },
      } satisfies Storage);
    }
    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return new Response(JSON.stringify(url.includes("/api/plans/generate")
        ? { ...GENERATED, stops: [...GENERATED.stops, { venueId: "venue-c", venueName: "Pub C" }], inferredContext: { ...GENERATED.inferredContext, stopCount: 3 } }
        : []), { status: 200, headers: { "content-type": "application/json" } });
    });
    await mountComposer();
    await sortIt("Clapham tonight");
    expect(document.querySelectorAll(".planStop__name")).toHaveLength(3);
    const control = action === "remove"
      ? document.querySelector<HTMLButtonElement>('button[aria-label="Remove stop 3"]')!
      : document.querySelector<HTMLButtonElement>(".planStops__add")!;
    await act(async () => { control.click(); });
    await settle();
    expect(document.querySelectorAll(".planStop")).toHaveLength(requested);
    expect(parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))?.requestedStopCount).toBe(requested);
    await openTune();
    expect(document.querySelector<HTMLSelectElement>("#plan-context-stops")?.value).toBe(String(requested));
    await sortAgainFromTune();
    const generations = () => fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/plans/generate"));
    expect(generations()).toHaveLength(2);
    const sent = JSON.parse(String(generations()[1]![1]?.body));
    expect(sent.intake.stopCount).toBe(requested);
    expect(sent.context.stopCount).toBe(requested);
    expect(document.querySelectorAll(".planStop__name")).toHaveLength(3);
    expect(parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))?.requestedStopCount).toBe(requested);
    if (localWritesFail) expect(storage.getItem("pubmaxx:plan-route-draft:v1")).toBeNull();
    await remountComposer();
    if (!localWritesFail) await openTune();
    const generate = [...document.querySelectorAll<HTMLButtonElement>(".planComposer__concierge button")]
      .find((button) => button.textContent?.trim() === (localWritesFail ? "Make a plan" : "Plan it again"))!;
    await act(async () => { generate.click(); });
    await settle();
    expect(generations()).toHaveLength(3);
    const restored = JSON.parse(String(generations()[2]![1]?.body));
    expect(restored.intake.stopCount).toBe(requested);
    expect(restored.context.stopCount).toBe(requested);
    expect(parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))?.requestedStopCount).toBe(requested);
  });

  it.each([undefined, 5])("keeps request %s through same-length reorder and swap actions", async (requestedStopCount) => {
    sessionStorage.setItem(PLAN_DRAFT_KEY, JSON.stringify({
      title: "Night", creatorName: "", startTime: "", conciergeQuery: "Clapham tonight", requestedStopCount,
      stops: GENERATED.stops.map((stop, index) => ({ key: index + 1, venueId: stop.venueId, venueName: stop.venueName })),
    }));
    localStorage.setItem("pubmaxx:plan-route-draft:v1", JSON.stringify({
      stops: GENERATED.stops.map((stop) => ({ ...stop, alternatives: [{ venueId: "venue-c", venueName: "Pub C" }] })),
      nightContext: null, groundingProof: "test-proof",
    }));
    await mountComposer();
    await vi.waitFor(() => expect(document.querySelectorAll(".planStop__open")).toHaveLength(2));
    const first = document.querySelector<HTMLElement>(".planStop__open")!;
    await act(async () => {
      first.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true, cancelable: true }));
    });
    await settle();
    expect([...document.querySelectorAll(".planStop__name")].map((node) => node.textContent)).toEqual(["Pub B", "Pub A"]);
    expect(JSON.parse(localStorage.getItem(PLAN_INTAKE_STORAGE_KEY) ?? "null")?.draft.answers.stopCount).not.toBe(2);
    const swap = document.querySelector<HTMLButtonElement>('button[aria-label="Swap stop 1, currently Pub B"]')!;
    await act(async () => { swap.click(); });
    await settle();
    expect([...document.querySelectorAll(".planStop__name")].map((node) => node.textContent)).toEqual(["Pub C", "Pub A"]);
    expect(JSON.parse(localStorage.getItem(PLAN_INTAKE_STORAGE_KEY) ?? "null")?.draft.answers.stopCount).not.toBe(2);
    expect(parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))?.requestedStopCount).toBe(requestedStopCount);
    await remountComposer();
    await openTune();
    await sortAgainFromTune();
    const generations = fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/plans/generate"));
    expect(generations).toHaveLength(1);
    expect(JSON.parse(String(generations[0]![1]?.body)).intake.stopCount).toBe(requestedStopCount);
    expect(parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))?.requestedStopCount).toBe(requestedStopCount);
  });

  it.each([undefined, 5])("keeps request %s when a pub fills an existing stop", async (requestedStopCount) => {
    sessionStorage.setItem(PLAN_DRAFT_KEY, JSON.stringify({
      title: "Night", creatorName: "", startTime: "", conciergeQuery: "Clapham tonight", requestedStopCount,
      stops: [{ key: 1, venueId: "venue-a", venueName: "Pub A" }, { key: 2, venueId: "", venueName: "" }],
    }));
    fetchMock.mockImplementation(async () => new Response(JSON.stringify([{ id: "venue-b", name: "Pub B" }]), {
      status: 200, headers: { "content-type": "application/json" },
    }));
    await mountComposer();
    await vi.waitFor(() => expect(document.querySelectorAll("#plan-venue-options option")).toHaveLength(1));
    const finder = document.querySelector<HTMLInputElement>('input[aria-label="Find a pub for stop 2"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(finder, "Pub B");
      finder.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();
    expect([...document.querySelectorAll(".planStop__name")].map((node) => node.textContent)).toEqual(["Pub A", "Pub B"]);
    expect(JSON.parse(localStorage.getItem(PLAN_INTAKE_STORAGE_KEY) ?? "null")?.draft.answers.stopCount).not.toBe(2);
    expect(parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))?.requestedStopCount).toBe(requestedStopCount);
  });

  it("shows the generated opening and travel gaps and replaces them on a new route", async () => {
    let missingEvidence = ["current_opening_hours", "terminal_get_home"];
    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return new Response(JSON.stringify(url.includes("/api/plans/generate")
        ? { ...GENERATED, planningConfidence: { missingEvidence } } : []), { status: 200, headers: { "content-type": "application/json" } });
    });
    await mountComposer();
    await sortIt("Quiet in Clapham for 4");
    expect(document.body.textContent).toContain("Opening times are not checked.");
    expect(document.body.textContent).toContain("Check travel before you go.");
    expect(document.querySelectorAll(".planStop")).toHaveLength(2);
    const add = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Add another stop")!;
    await act(async () => { add.click(); });
    expect(document.body.textContent).toContain("Opening and travel checks are unavailable for this draft.");
    expect(document.body.textContent).not.toContain("Opening times are not checked.");
    await openTune();
    missingEvidence = [];
    await sortAgainFromTune();
    expect(document.body.textContent).not.toContain("Opening times are not checked.");
    expect(document.body.textContent).not.toContain("Check travel before you go.");
    expect(document.querySelectorAll(".planStop")).toHaveLength(2);
  });

  it("warns that opening and travel checks are unavailable on a restored draft", async () => {
    localStorage.setItem("pubmaxx:plan-route-draft:v1", JSON.stringify({
      stops: [{ venueId: "venue-a", venueName: "Pub A" }], nightContext: null,
    }));
    await mountComposer();
    expect(document.body.textContent).toContain("Opening and travel checks are unavailable for this restored draft.");
    await vi.waitFor(() => expect(document.body.textContent).toContain("Pub A"));
    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return new Response(JSON.stringify(url.includes("/api/plans/generate")
        ? { ...GENERATED, planningConfidence: { missingEvidence: [] } } : []), { status: 200, headers: { "content-type": "application/json" } });
    });
    await openTune();
    const field = document.querySelector<HTMLInputElement>("#plan-concierge-query")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "Quiet in Clapham");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await sortAgainFromTune();
    expect(document.body.textContent).not.toContain("Opening and travel checks are unavailable for this restored draft.");
  });

  it.each([
    { recovery: "session", localWritesFail: true, result: undefined },
    { recovery: "local", localWritesFail: false, result: "true" },
  ])("keeps one disclosure beside $recovery-restored stops through edits and regeneration", async ({ localWritesFail, result }) => {
    const storage = localStorage;
    const failedWrite = vi.fn(() => { throw new DOMException("Storage is full", "QuotaExceededError"); });
    if (localWritesFail) {
      vi.stubGlobal("localStorage", {
        getItem: storage.getItem.bind(storage),
        setItem: failedWrite,
        removeItem: storage.removeItem.bind(storage),
        clear: storage.clear.bind(storage),
        key: storage.key.bind(storage),
        get length() { return storage.length; },
      } satisfies Storage);
    }
    await mountComposer();
    await sortIt("Quiet in Clapham for 4");
    expect(parsePlanDraft(sessionStorage.getItem(PLAN_DRAFT_KEY))?.stops.map((stop) => stop.venueId))
      .toEqual(["venue-a", "venue-b"]);
    if (localWritesFail) {
      expect(failedWrite).toHaveBeenCalledWith("pubmaxx:plan-route-draft:v1", expect.any(String));
      expect(localStorage.getItem("pubmaxx:plan-route-draft:v1")).toBeNull();
    } else {
      expect(localStorage.getItem("pubmaxx:plan-route-draft:v1")).not.toBeNull();
    }

    const current = root!;
    await act(async () => { current.unmount(); });
    root = null;
    host?.remove();
    host = null;
    await mountComposer();
    await vi.waitFor(() => expect(document.querySelectorAll(".planStop__name")).toHaveLength(2));

    const notices = () => [...document.querySelectorAll("p")].filter((node) =>
      node.textContent?.includes("Opening and travel checks are unavailable"));
    expect(document.querySelector<HTMLElement>("#plan-composer")?.dataset.result).toBe(result);
    expect([...document.querySelectorAll(".planStop__name")].map((node) => node.textContent)).toEqual(["Pub A", "Pub B"]);
    expect(notices()).toHaveLength(1);
    expect(notices()[0]?.textContent).toBe("Opening and travel checks are unavailable for this restored draft.");
    expect(notices()[0]?.closest(".planComposer__stops")).not.toBeNull();

    const first = document.querySelector<HTMLElement>(".planStop__open")!;
    await act(async () => {
      first.focus();
      first.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true }));
    });
    await settle();
    expect([...document.querySelectorAll(".planStop__name")].map((node) => node.textContent)).toEqual(["Pub B"]);
    expect(document.activeElement?.textContent).toBe("Pub B");
    expect(notices()).toHaveLength(1);
    expect(notices()[0]?.textContent).toBe("Opening and travel checks are unavailable for this draft.");

    if (result) await openTune();
    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return new Response(JSON.stringify(url.includes("/api/plans/generate")
        ? { ...GENERATED, planningConfidence: { missingEvidence: [] } } : []), { status: 200, headers: { "content-type": "application/json" } });
    });
    const generate = [...document.querySelectorAll<HTMLButtonElement>(".planComposer__concierge button")]
      .find((button) => button.textContent?.trim() === (result ? "Plan it again" : "Make a plan"))!;
    await act(async () => { generate.click(); });
    await settle();
    await vi.waitFor(() => expect(document.querySelectorAll(".planStop__name")).toHaveLength(2));
    expect(notices()).toHaveLength(0);
    expect(document.activeElement?.id).toBe("plan-route-status");
  });

  it.each([
    { gap: "opening_hours", present: "Opening times are not checked.", absent: "Check travel before you go." },
    { gap: "transport_anchor", present: "Check travel before you go.", absent: "Opening times are not checked." },
  ])("shows only the applicable $gap warning", async ({ gap, present, absent }) => {
    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return new Response(JSON.stringify(url.includes("/api/plans/generate")
        ? { ...GENERATED, planningConfidence: { missingEvidence: [gap] } } : []), { status: 200, headers: { "content-type": "application/json" } });
    });
    await mountComposer();
    await sortIt("Quiet in Clapham for 4");
    expect(document.body.textContent).toContain(present);
    expect(document.body.textContent).not.toContain(absent);
  });
  it("reads the venue index and draws its datalist only once the composer is up", async () => {
    await mountComposer();
    expect(document.querySelector("#plan-describe-first-query")).not.toBeNull();
    expect(document.querySelector("#plan-venue-options")).toBeNull();
    expect(venueIndexReads()).toBe(0);

    await sortIt("Quiet in Clapham for 4");

    expect(document.querySelector("#plan-composer #plan-venue-options")).not.toBeNull();
    expect(venueIndexReads()).toBe(1);
  });

  it("keeps the area the route was sorted for when the night's area is changed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-07T12:00:00Z"));
    onTestFinished(() => { vi.useRealTimers(); });
    await mountComposer();
    await sortIt("Quiet in Clapham for 4");
    const heading = () => document.querySelector("#plan-result-title")?.textContent;
    expect(heading()).toBe("Tonight in Clapham");
    expect(document.querySelector(".planComposer__routeStale")).toBeNull();

    const tune = [...document.querySelectorAll("button")].find((button) => button.textContent?.includes("Tune details"))!;
    await act(async () => { tune.click(); });
    await vi.waitFor(() => {
      if (!document.querySelector("#plan-context-area")) throw new Error("Tune details has not mounted");
    }, { timeout: 4000 });
    const area = document.querySelector<HTMLSelectElement>("#plan-context-area")!;
    await act(async () => {
      area.value = "victoria";
      area.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();

    const notice = document.querySelector(".planComposer__routeStale");
    expect(notice?.textContent).toContain("You’ve changed the night since we sorted it");
    expect(notice?.textContent).not.toContain("Context changed");
    expect(notice?.querySelector("button")?.textContent).toBe("Regenerate route");
    expect(area.value).toBe("victoria");
    expect(heading()).toBe("Tonight in Clapham");
    const meta = [...document.querySelectorAll(".planStop__meta")].map((node) => node.textContent);
    expect(meta).toEqual(["Clapham", "Clapham"]);
  });
});

async function openTune(): Promise<void> {
  const tune = [...document.querySelectorAll("button")].find((button) => button.textContent?.includes("Tune details"))!;
  // A real click focuses the button, so it is the focus the sheet returns to.
  await act(async () => { tune.focus(); tune.click(); });
  await vi.waitFor(() => {
    if (!document.querySelector("[role='dialog'] #plan-concierge-query")) throw new Error("Tune details has not mounted");
    // The sheet takes focus a frame after it opens. A press before that frame
    // would have its focus taken back, which no reader's tap can hit.
    if (document.activeElement?.getAttribute("role") !== "dialog") throw new Error("Tune details has not taken focus");
  }, { timeout: 4000 });
}

async function sortAgainFromTune(): Promise<void> {
  const again = [...document.querySelectorAll<HTMLButtonElement>("[role='dialog'] button")].find((button) => button.textContent === "Plan it again")!;
  await act(async () => { again.click(); });
  await settle();
  await settle();
}

// NOBODY SILENTLY LOSES TONIGHT (captain, 16 Oct 2026). From 22:30 London the
// default First pint is tomorrow at 19:00, because a first pint near midnight
// is not a night out. That left a reader standing in the night with no default
// for it, and a summary that never said which night it was.
describe("the First pint beside a night the default stepped over", () => {
  function startField(): HTMLInputElement {
    return document.querySelector<HTMLInputElement>("#plan-time")!;
  }

  function tonightChoice(): HTMLButtonElement | null {
    return document.querySelector<HTMLButtonElement>('[data-testid="plan-tonight-choice"]');
  }

  function summary(): string {
    return document.querySelector('[data-testid="plan-route-summary"]')?.textContent ?? "";
  }

  it("defaults to tomorrow at 19:00 and offers tonight in one tap, with its date", async () => {
    // 21:45 UTC is 22:45 BST: past the cutoff.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-15T21:45:00.000Z"));
    onTestFinished(() => { vi.useRealTimers(); });
    await mountComposer();
    await sortIt("Quiet in Clapham for 4");

    expect(startField().value).toBe("2026-10-16T19:00");
    expect(summary()).toContain("Fri 16 Oct, 19:00");

    const tonight = tonightChoice();
    expect(tonight).not.toBeNull();
    expect(tonight!.textContent).toBe("Tonight, Thu 15 Oct, 23:00");

    await act(async () => { tonight!.click(); });
    await settle();

    expect(startField().value).toBe("2026-10-15T23:00");
    expect(summary()).toContain("Thu 15 Oct, 23:00");
    // The choice is made, so the door closes.
    expect(tonightChoice()).toBeNull();
  });

  // The slot was latched at mount, so a reader who described a night and sorted
  // it before tapping wrote a quarter-hour that had already passed: the lock
  // then refuses the start it was handed, with nothing on screen saying so.
  it("writes the slot the clock says on the tap, not the one it was offered at", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-15T21:45:00.000Z"));
    onTestFinished(() => { vi.useRealTimers(); });
    await mountComposer();
    await sortIt("Quiet in Clapham for 4");
    expect(tonightChoice()!.textContent).toBe("Tonight, Thu 15 Oct, 23:00");

    // Twenty minutes of describing and sorting later, 23:00 is behind us.
    vi.setSystemTime(new Date("2026-10-15T22:05:00.000Z"));
    const tonight = tonightChoice()!;
    await act(async () => { tonight.click(); });
    await settle();

    expect(startField().value).toBe("2026-10-15T23:30");
    expect(summary()).toContain("Thu 15 Oct, 23:30");
    // And the start the lock reads is still ahead of now.
    expect(resolveFutureLondonStartIso(startField().value, null, new Date()))
      .toBe("2026-10-15T22:30:00.000Z");
  });

  // The page runs no timer, so a button offered before midnight is still on
  // screen after it. The slot it was offered then is a moment that has gone:
  // the tap must write the night the control NAMES, read fresh, rather than a
  // start in the past or a different night seventeen hours out.
  it("writes tonight's own slot when tapped after the night it offered", async () => {
    // 22:50 UTC is 23:50 BST: the slot rolls past midnight.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-15T22:50:00.000Z"));
    onTestFinished(() => { vi.useRealTimers(); });
    await mountComposer();
    await sortIt("Quiet in Clapham for 4");
    const tonight = tonightChoice()!;
    expect(tonight.textContent).toBe("Tonight, Fri 16 Oct, 00:15");

    // Back at 00:40, with no render in between.
    vi.setSystemTime(new Date("2026-10-15T23:40:00.000Z"));
    await act(async () => { tonight.click(); });
    await settle();

    // 00:40 is still the 15th's night out, so the fresh slot is the next
    // quarter a clear fifteen minutes out - not the offered 00:15, and not the
    // next evening.
    expect(startField().value).toBe("2026-10-16T01:00");
    expect(resolveFutureLondonStartIso(startField().value, null, new Date()))
      .toBe("2026-10-16T00:00:00.000Z");
    // Nothing the reader had settled is re-opened by the tap.
    expect(document.querySelector("#plan-time")?.getAttribute("aria-invalid")).toBeNull();
  });

  // A start the lock has already refused is the state that needs the door
  // most, and reading the field's NIGHT alone withheld it there: a start
  // earlier tonight is on the night running now, so the door stayed shut over
  // a field the reader could only fix by hand.
  it("comes back once the start in the field has passed", async () => {
    // 21:45 UTC is 22:45 BST.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-15T21:45:00.000Z"));
    onTestFinished(() => { vi.useRealTimers(); });
    await mountComposer();
    await sortIt("Quiet in Clapham for 4");

    await act(async () => { tonightChoice()!.click(); });
    await settle();
    expect(startField().value).toBe("2026-10-15T23:00");
    expect(tonightChoice()).toBeNull();

    // Twenty-five minutes of tuning later, that start has gone by: the lock
    // refuses it, so the way back into tonight has to be on screen.
    vi.setSystemTime(new Date("2026-10-15T22:20:00.000Z"));
    const title = document.querySelector<HTMLInputElement>("#plan-title")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(title, "Late one");
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();

    // The lock's own verdict on the field: the start it holds has gone.
    expect(resolveFutureLondonStartIso(startField().value, null, new Date())).toBeNull();
    const again = tonightChoice();
    expect(again).not.toBeNull();
    expect(again!.textContent).toBe("Tonight, Thu 15 Oct, 23:45");

    await act(async () => { again!.click(); });
    await settle();
    expect(startField().value).toBe("2026-10-15T23:45");
    expect(resolveFutureLondonStartIso(startField().value, null, new Date()))
      .toBe("2026-10-15T22:45:00.000Z");
  });

  // Near the end of the night the rounding runs out of slots: the next quarter
  // lands on the NEXT night, so there is nothing left to step back to. The tap
  // used to fall through to the late default - 19:00 the following evening -
  // under a label naming the small hours, with nothing on screen saying so.
  it("writes nothing rather than a night its label does not name", async () => {
    // 03:28 UTC is 04:28 BST: the last few minutes with a slot left.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-16T03:28:00.000Z"));
    onTestFinished(() => { vi.useRealTimers(); });
    await mountComposer();
    await sortIt("Quiet in Clapham for 4");
    expect(tonightChoice()!.textContent).toBe("Tonight, Fri 16 Oct, 04:45");

    // A start the reader chose, so a wrong write is visible rather than hidden
    // behind the default the door would otherwise have fallen back to.
    const field = startField();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "2026-10-18T19:00");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();
    expect(startField().value).toBe("2026-10-18T19:00");

    // 03:35 UTC is 04:35 BST: the next quarter is 05:00, which is the next
    // night, so the door has nothing to offer and must write nothing.
    vi.setSystemTime(new Date("2026-10-16T03:35:00.000Z"));
    const tonight = tonightChoice()!;
    await act(async () => { tonight.click(); });
    await settle();

    expect(startField().value).toBe("2026-10-18T19:00");
    expect(summary()).toContain("Sun 18 Oct, 19:00");
    expect(document.querySelector("#plan-time")?.getAttribute("aria-invalid")).toBeNull();
  });

  it("re-reads the offer as the clock moves, so the label names the slot it writes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-15T21:45:00.000Z"));
    onTestFinished(() => { vi.useRealTimers(); });
    await mountComposer();
    await sortIt("Quiet in Clapham for 4");
    expect(tonightChoice()!.textContent).toBe("Tonight, Thu 15 Oct, 23:00");

    vi.setSystemTime(new Date("2026-10-15T22:05:00.000Z"));
    // Any re-render re-reads the clock: the name on the door follows it.
    const field = startField();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "2026-10-17T19:00");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();

    expect(tonightChoice()!.textContent).toBe("Tonight, Thu 15 Oct, 23:30");
  });

  it("leaves an ordinary evening alone: the default is tonight and there is no second choice", async () => {
    // 19:05 UTC is 20:05 BST: before the cutoff.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-15T19:05:00.000Z"));
    onTestFinished(() => { vi.useRealTimers(); });
    await mountComposer();
    await sortIt("Quiet in Clapham for 4");

    expect(startField().value).toBe("2026-10-15T20:30");
    expect(summary()).toContain("Thu 15 Oct, 20:30");
    expect(tonightChoice()).toBeNull();
  });
});

describe("sorting again from Tune details", () => {
  it("closes the sheet and lands focus on the new route's status", async () => {
    await mountComposer();
    await sortIt("Quiet in Clapham for 4");
    await openTune();

    await sortAgainFromTune();

    expect(document.querySelector("[role='dialog']")).toBeNull();
    expect(document.activeElement?.id).toBe("plan-route-status");
  });

  it("keeps the busy button focusable while the sort is in flight, and a second press asks nothing", async () => {
    await mountComposer();
    await sortIt("Quiet in Clapham for 4");
    await openTune();
    let answer: (response: Response) => void = () => undefined;
    fetchMock.mockImplementation((input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return url.includes("/api/plans/generate")
        ? new Promise<Response>((resolve) => { answer = resolve; })
        : Promise.resolve(new Response("[]", { status: 200, headers: { "content-type": "application/json" } }));
    });
    const generateCalls = () => fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/plans/generate")).length;
    const before = generateCalls();

    const again = [...document.querySelectorAll<HTMLButtonElement>("[role='dialog'] button")].find((button) => button.textContent === "Plan it again")!;
    await act(async () => { again.focus(); again.click(); });
    await settle();

    // A disabled button cannot hold focus, so the browser would drop it to the
    // page body while the sheet is still open.
    expect(again.textContent).toBe("Planning…");
    expect(again.disabled).toBe(false);
    expect(again.getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(again);
    await act(async () => { again.click(); });
    await settle();
    expect(generateCalls()).toBe(before + 1);

    await act(async () => {
      answer(new Response(JSON.stringify(GENERATED), { status: 200, headers: { "content-type": "application/json" } }));
    });
    await settle();
    await settle();
    expect(document.querySelector("[role='dialog']")).toBeNull();
    expect(document.activeElement?.id).toBe("plan-route-status");
  });

  it("closes the sheet on a failed sort, so the failure is not hidden behind it", async () => {
    await mountComposer();
    await sortIt("Quiet in Clapham for 4");
    await openTune();
    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return url.includes("/api/plans/generate")
        ? new Response(JSON.stringify({ error: { message: "Generator down" } }), { status: 500, headers: { "content-type": "application/json" } })
        : new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    });

    await sortAgainFromTune();

    expect(document.querySelector("[role='dialog']")).toBeNull();
    expect(document.querySelector("#plan-composer .planComposer__error[role='alert']")).not.toBeNull();
  });
});

describe("a refresh that comes back with no route", () => {
  it.each([
    ["no pubs match", { stops: [] }, "No venues matched that ask. Try a nearby area or a broader mood."],
    ["the kept pub is in the way", { outcome: "anchor-conflict", message: "That pub is shut at that time." }, "That pub is shut at that time."],
  ])("keeps the route and says why when %s", async (_case, answer, said) => {
    await mountComposer();
    await sortIt("Quiet in Clapham for 4");
    await openTune();
    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return new Response(JSON.stringify(url.includes("/api/plans/generate") ? answer : []), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    await sortAgainFromTune();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await settle();

    expect(document.querySelector("[role='dialog']")).toBeNull();
    expect(document.querySelector("#plan-route-status")?.textContent).toBe(said);
    expect([...document.querySelectorAll(".planStop__name")].map((node) => node.textContent)).toEqual(["Pub A", "Pub B"]);
  });
});

describe("an accepted place the venue index has no name for", () => {
  const HELD = "venue-held";

  function holdAcceptedPlace(): void {
    writePlanningIntent({
      source: "near",
      cityId: "london",
      acceptedVenueId: HELD,
      acceptedArea: { kind: "night-patch", id: "soho" },
      startsAt: null,
      displayEvidence: { kind: "directory", observedAt: null },
    });
  }

  function serveIndex(...reads: Array<unknown[] | number>): void {
    const path = planComposerVenueIndexPath("london");
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url !== path) return new Response("{}", { status: 404 });
      const read = reads.length > 1 ? reads.shift()! : reads[0]!;
      return typeof read === "number"
        ? new Response("<html></html>", { status: read })
        : new Response(JSON.stringify(read), { status: 200, headers: { "content-type": "application/json" } });
    }));
  }

  const firstStop = () => document.querySelectorAll<HTMLLIElement>("li.planStop")[0]!;
  const stopNames = () => [...document.querySelectorAll("li.planStop")].map((card) =>
    card.querySelector(".planStop__name")?.textContent ?? card.querySelector<HTMLInputElement>(".planStop__find")?.getAttribute("aria-label"));
  const panel = () => document.querySelector("[aria-label='Accepted plan context']");
  const button = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label='${label}']`)!;

  async function click(target: HTMLElement): Promise<void> {
    await act(async () => { target.click(); });
    await settle();
  }

  // The cards are their own chunk. Wait for them, so a test never passes only
  // because an earlier test in the file had already loaded it.
  async function mountHeld(): Promise<void> {
    await mountComposer();
    await vi.waitFor(() => {
      if (!document.querySelector("li.planStop")) throw new Error("the stop cards have not mounted");
    }, { timeout: 4000 });
  }

  it("shows a held place that is not a pub as a card, and Swap releases it for a pub of the reader's choosing", async () => {
    holdAcceptedPlace();
    serveIndex([
      { id: HELD, name: "The Cocktail Den", kind: "bar" },
      { id: "venue-anchor", name: "The Anchor", kind: "pub" },
    ]);
    await mountHeld();

    expect(stopNames()).toEqual(["Your chosen place"]);
    expect(panel()).not.toBeNull();
    const swap = button("Swap stop 1, currently your chosen place");
    expect(swap.disabled).toBe(false);

    await click(swap);

    const finder = firstStop().querySelector<HTMLInputElement>(".planStop__find")!;
    expect(finder.getAttribute("aria-label")).toBe("Find a pub for stop 1");
    expect(document.activeElement).toBe(finder);
    expect(panel()).toBeNull();
    expect(readPlanningIntent()).toBeNull();

    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(finder, "The Anchor");
      finder.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertReplacementText" }));
    });
    await settle();

    expect(stopNames()).toEqual(["The Anchor"]);
    expect(document.querySelector("#plan-route-status")?.textContent).toBe("Stop chosen. Refresh the route before locking.");
  });

  it("releases a held place that is not a pub into a pub finder, and the next pick is kept", async () => {
    holdAcceptedPlace();
    serveIndex([
      { id: HELD, name: "The Cocktail Den", kind: "bar" },
      { id: "venue-anchor", name: "The Anchor", kind: "pub" },
    ]);
    await mountHeld();
    expect(stopNames()).toEqual(["Your chosen place"]);

    await click([...document.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent === "Release this pub")!);

    expect(stopNames()).toEqual(["Find a pub for stop 1"]);
    expect(panel()).toBeNull();
    expect(readPlanningIntent()).toBeNull();

    const finder = firstStop().querySelector<HTMLInputElement>(".planStop__find")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(finder, "The Anchor");
      finder.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertReplacementText" }));
    });
    await settle();

    expect(stopNames()).toEqual(["The Anchor"]);
    expect(document.querySelector("#plan-route-status")?.textContent).toBe("Stop chosen. Refresh the route before locking.");
  });

  it("removes a held place that is not a pub, and the acceptance goes with it", async () => {
    holdAcceptedPlace();
    serveIndex([{ id: HELD, name: "The Cocktail Den", kind: "bar" }]);
    await mountHeld();

    await click([...document.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent === "Add another stop")!);
    const remove = button("Remove stop 1");
    expect(remove.disabled).toBe(false);

    await click(remove);

    expect(stopNames()).toEqual(["Find a pub for stop 1"]);
    expect(panel()).toBeNull();
    expect(readPlanningIntent()).toBeNull();
    expect(document.querySelector("#plan-route-status")?.textContent).toBe("Stop 1 removed. Refresh the route before locking.");
  });

  it("keeps the held place locked while the venue index is still being read", async () => {
    holdAcceptedPlace();
    const path = planComposerVenueIndexPath("london");
    let deliver: ((response: Response) => void) | null = null;
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url !== path) return new Response("{}", { status: 404 });
      return new Promise<Response>((resolve) => { deliver = resolve; });
    }));
    await mountHeld();
    await click([...document.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent === "Add another stop")!);

    expect(stopNames()).toEqual(["Your chosen place", "Find a pub for stop 2"]);
    const swap = button("Your chosen place is the accepted Stop 1. Swap is not available.");
    const remove = button("Your chosen place is the accepted Stop 1. Remove is not available.");
    expect(swap.disabled).toBe(true);
    expect(remove.disabled).toBe(true);
    await act(async () => {
      firstStop().querySelector<HTMLElement>(".planStop__open")!
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true }));
    });
    await settle();
    expect(stopNames()).toEqual(["Your chosen place", "Find a pub for stop 2"]);

    expect(deliver).not.toBeNull();
    await act(async () => {
      deliver!(new Response(JSON.stringify([{ id: HELD, name: "The Held Arms" }]), { status: 200, headers: { "content-type": "application/json" } }));
    });
    await settle();

    expect(stopNames()).toEqual(["The Held Arms", "Find a pub for stop 2"]);
    expect(button("The Held Arms is the accepted Stop 1. Swap is not available.").disabled).toBe(true);
    expect(panel()?.textContent).toContain("The Held Arms");
    expect(readPlanningIntent()?.acceptedVenueId).toBe(HELD);
  });

  it("keeps a pub released while the index was still loading released when the index arrives", async () => {
    holdAcceptedPlace();
    const path = planComposerVenueIndexPath("london");
    let deliver: ((response: Response) => void) | null = null;
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url !== path) return new Response("{}", { status: 404 });
      return new Promise<Response>((resolve) => { deliver = resolve; });
    }));
    await mountHeld();

    await click([...document.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent === "Release this pub")!);
    expect(stopNames()).toEqual(["Find a pub for stop 1"]);

    await act(async () => {
      deliver!(new Response(JSON.stringify([{ id: HELD, name: "The Held Arms" }]), { status: 200, headers: { "content-type": "application/json" } }));
    });
    await settle();

    expect(stopNames()).toEqual(["Find a pub for stop 1"]);
    expect(panel()).toBeNull();
  });

  it("says when the venue index did not load, and a retry names the held pub and keeps it held", async () => {
    holdAcceptedPlace();
    serveIndex(503, [{ id: HELD, name: "The Held Arms" }]);
    await mountHeld();

    const alert = document.querySelector("#plan-composer [role='alert']");
    expect(alert?.textContent).toContain("The pub list did not load.");
    expect(stopNames()).toEqual(["Your chosen place"]);

    await click([...alert!.querySelectorAll("button")].find((node) => node.textContent === "Try again")!);

    expect(document.querySelector("#plan-composer [role='alert']")).toBeNull();
    expect(stopNames()).toEqual(["The Held Arms"]);
    expect(button("The Held Arms is the accepted Stop 1. Swap is not available.").disabled).toBe(true);
    expect(firstStop().querySelector(".planStop__remove")).toBeNull();
    expect(panel()?.textContent).toContain("The Held Arms");
  });

  it("makes a plan from a typed description while a pub is held", async () => {
    holdAcceptedPlace();
    const path = planComposerVenueIndexPath("london");
    const generated = { ...GENERATED, stops: [{ venueId: HELD, venueName: "The Held Arms", reason: "Your pick." }, GENERATED.stops[1]] };
    const sent: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === path) {
        return new Response(JSON.stringify([{ id: HELD, name: "The Held Arms" }]), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (!url.includes("/api/plans/generate")) return new Response("{}", { status: 404 });
      sent.push(JSON.parse(String(init?.body)));
      // The route's own request parser, so the composer is held to what the API accepts.
      const parsed = await parsePlanGenerationRequest(new Request("http://localhost/api/plans/generate", { method: "POST", body: init?.body }));
      return parsed.ok
        ? new Response(JSON.stringify(generated), { status: 200, headers: { "content-type": "application/json" } })
        : new Response(JSON.stringify({ error: { code: parsed.code, message: parsed.message } }), { status: parsed.status, headers: { "content-type": "application/json" } });
    }));
    await mountHeld();

    const field = document.querySelector<HTMLInputElement>("#plan-concierge-query")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "quiet pints after work");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click([...document.querySelectorAll("button")].find((node) => node.textContent?.trim() === "Make a plan")!);
    await vi.waitFor(() => {
      if (stopNames().length < 2) throw new Error(`the generated route has not mounted: ${document.querySelector("#plan-composer [role='alert']")?.textContent ?? ""}`);
    }, { timeout: 4000 });

    expect(stopNames()).toEqual(["The Held Arms", "Pub B"]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      query: "quiet pints after work",
      anchor: { venueId: HELD, acceptedArea: { kind: "night-patch", id: "soho" } },
      intake: {
        area: { kind: "night-patch", id: "soho" },
        timeWindow: null,
        groupSize: null,
        budget: null,
        skipped: ["time-window", "group-size", "budget", "accessibility"],
      },
    });
    expect(panel()?.textContent).toContain("The Held Arms");
  });

  it.each([
    ["Three quiet pints for 4", "piccadilly-soho"],
    ["Three quiet pints in Clapham for 4", "clapham"],
  ])("uses the held location unless the description supplies an area: %s", async (query, nightArea) => {
    writePlanningIntent({
      source: "near", cityId: "london", acceptedVenueId: HELD,
      acceptedArea: null, startsAt: null,
      displayEvidence: { kind: "directory", observedAt: null },
    });
    const sent: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === planComposerVenueIndexPath("london")) {
        return Response.json([{ id: HELD, name: "The Held Arms", lat: 51.513, lng: -0.132 }]);
      }
      sent.push(JSON.parse(String(init?.body)));
      const parsed = await parsePlanGenerationRequest(new Request("http://localhost/api/plans/generate", { method: "POST", body: init?.body }));
      if (!parsed.ok) return Response.json({ error: { message: parsed.message } }, { status: parsed.status });
      return Response.json({ ...GENERATED, stops: [{ venueId: HELD, venueName: "The Held Arms", reason: "Your pick." }, GENERATED.stops[1]] });
    }));
    await mountHeld();
    const field = document.querySelector<HTMLInputElement>("#plan-concierge-query")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, query);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click([...document.querySelectorAll("button")].find((node) => node.textContent?.trim() === "Make a plan")!);
    await vi.waitFor(() => expect(stopNames()).toHaveLength(2));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      context: { nightArea },
      anchor: { venueId: HELD, acceptedArea: null },
    });
    if (nightArea === "piccadilly-soho") {
      expect(sent[0]).toMatchObject({ intake: { area: null, skipped: ["area", "time-window", "group-size", "budget", "accessibility"] } });
    }
    expect(document.querySelector("#plan-composer [role='alert']")).toBeNull();
  });

  it("asks for an area once when held Arnos Arms is outside every supported London route area", async () => {
    const venue = { id: "venue-xjf3n0", name: "Arnos Arms", borough: "Enfield", lat: 51.6162, lng: -0.132117 };
    writePlanningIntent({
      source: "near", cityId: "london", acceptedVenueId: venue.id,
      acceptedArea: null, startsAt: null,
      displayEvidence: { kind: "directory", observedAt: null },
    });
    const sent: Array<{ context?: { nightArea?: string | null } }> = [];
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === planComposerVenueIndexPath("london")) return Response.json([venue]);
      const body = JSON.parse(String(init?.body));
      sent.push(body);
      // The observed API responses distinguish missing area from a wrongly inferred area.
      return body.context?.nightArea
        ? Response.json({
          grounded: false, outcome: "anchor-conflict", anchored: true, routeReady: false, stops: [],
          reason: "ANCHOR_ROUTE_CONFLICT",
          message: "We could not build a route from that pub right now. Try a different pub.",
        })
        : Response.json({ error: { code: "NIGHT_AREA_REQUIRED", message: "Choose an area." } }, { status: 422 });
    }));
    await mountHeld();
    const field = document.querySelector<HTMLInputElement>("#plan-concierge-query")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "Three quiet pints for 4");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click([...document.querySelectorAll("button")].find((node) => node.textContent?.trim() === "Make a plan")!);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.context?.nightArea ?? null).toBeNull();
    expect(document.querySelector("#plan-composer [role='alert']")?.textContent).toBe("Choose an area.");
    expect(document.querySelector("#plan-composer")?.textContent?.match(/Choose an area\./g)).toHaveLength(1);
    expect(document.querySelector("#plan-composer")?.textContent).not.toMatch(/Try a different pub|Refresh the route|earlier route/);
    expect(document.querySelector("#plan-route-status")?.textContent).toBe("");
    expect(document.querySelector(".planComposer__routeStale")).toBeNull();
    expect(stopNames()).toEqual([venue.name]);
  });

  it.each([
    {},
    { lat: 53.4808, lng: -2.2426 },
  ])("shows one area prompt without stale-route copy when the held location cannot resolve: %j", async (coordinates) => {
    // A pub accepted from the map carries no area, and the description names none.
    writePlanningIntent({
      source: "near",
      cityId: "london",
      acceptedVenueId: HELD,
      acceptedArea: null,
      startsAt: null,
      displayEvidence: { kind: "directory", observedAt: null },
    });
    const path = planComposerVenueIndexPath("london");
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === path) {
        return new Response(JSON.stringify([{ id: HELD, name: "The Held Arms", ...coordinates }]), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: { code: "NIGHT_AREA_REQUIRED", message: "Choose an area." } }), { status: 422, headers: { "content-type": "application/json" } });
    }));
    await mountHeld();

    const field = document.querySelector<HTMLInputElement>("#plan-concierge-query")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "Three quiet pints for 4");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click([...document.querySelectorAll("button")].find((node) => node.textContent?.trim() === "Make a plan")!);
    await vi.waitFor(() => {
      if (!document.querySelector("#plan-composer [role='alert']")) throw new Error("the failure has not been shown");
    }, { timeout: 4000 });

    expect(document.querySelector("#plan-composer [role='alert']")?.textContent).toBe("Choose an area.");
    expect(document.querySelector("#plan-route-status")?.textContent).toBe("");
    expect(document.querySelector("#plan-composer")?.textContent?.match(/Choose an area\./g)).toHaveLength(1);
    expect(document.querySelector(".planComposer__routeStale")).toBeNull();
    expect(stopNames()).toEqual(["The Held Arms"]);

    await click([...document.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent === "Release this pub")!);

    const status = document.querySelector("#plan-route-status");
    expect(status?.textContent).toBe("Released The Held Arms. Stop 1 is yours to change.");
    expect(document.activeElement).toBe(status);
  });
});

describe("swapping one stop in place", () => {
  it("swaps to the generator's alternative and leaves the night lockable without a refresh", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const body = url.includes("/api/plans/generate")
        ? {
            ...GENERATED,
            stops: [
              GENERATED.stops[0],
              { ...GENERATED.stops[1], estimatedPintPricePence: 520, alternatives: [{ venueId: "venue-c", venueName: "Pub C", estimatedPintPricePence: 480 }] },
            ],
          }
        : [];
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    });
    await mountComposer();
    await sortIt("Quiet in Clapham for 4");

    const swap = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.getAttribute("aria-label") === "Swap stop 2, currently Pub B")!;
    await act(async () => { swap.click(); });
    await settle();

    expect(document.querySelector("#plan-route-status")?.textContent).toBe("Stop 2 swapped to Pub C.");
    expect(document.querySelector(".planComposer__routeStale")).toBeNull();
    expect(document.querySelector("#plan-lock-hint")?.textContent ?? "").not.toMatch(/Refresh the route/);
    expect(document.body.textContent).toContain("Pub C");
  });
});
