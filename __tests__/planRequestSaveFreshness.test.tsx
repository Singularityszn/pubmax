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

const authSeedFixture = vi.hoisted(() => ({
  user: null as { id: string; user_metadata?: Record<string, unknown> } | null,
  handle: null as string | null,
  identityResolved: true,
}));
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ ...authSeedFixture, session: null, loading: false }),
}));

vi.mock("@/components/plan/PlanCultureOpener", () => ({ default: () => null }));
vi.mock("@/components/wanted/WantedPlanChips", () => ({ default: () => null }));
vi.mock("@/components/plan/PlanRouteMiniMap", () => ({ default: () => null }));
vi.mock("@/lib/analytics", () => ({ trackEvent: () => undefined, trackMeaningfulCoreAction: () => undefined, laneSourceFromSearch: () => null }));
import PlanComposer from "@/components/plan/PlanComposer";
import { createPlanIntakeDraft, nextLondonOccurrenceIso, PLAN_INTAKE_STORAGE_KEY, readPlanIntakeDraftWithMetadata, reopenPlanIntakeStep, skipRemainingPlanIntake, writePlanIntakeDraft } from "@/lib/planIntake";
import { PLAN_DRAFT_KEY, PLAN_DRAFT_V2_KEY, readPlanDraftEnvelope, writePlanDraftEnvelope } from "@/lib/planDraft";
import { rememberPlanHostName } from "@/lib/planHostName";
import { rememberLastCrew } from "@/lib/lastCrew";
import { PLAN_ROUTE_DRAFT_KEY, PLAN_ROUTE_DRAFT_V2_KEY, readPlanRouteDraftEnvelope, reconcilePlanRouteDrafts } from "@/lib/planRouteDraft";
import { inferNightContext } from "@/lib/nightPlanning";
import { transferGeneratedRouteToDraft } from "@/lib/mapRouteTransfer";
import { parsePlanGenerationIntake } from "@/lib/planGenerationIntake";
import { reconcilePlanContext } from "@/lib/planGenerationContext";
import { ASK_PLAN_DRAFT_STORAGE_KEY } from "@/lib/ask/types";
import { readPlanningIntent, writePlanningIntent } from "@/lib/planningIntent";
import { writeRememberedArea } from "@/lib/nightPatches";
import { clearPersistedPlanDrafts } from "@/lib/planComposerHandoff";

const GENERATED = {
  stops: [{ venueId: "venue-a", venueName: "Pub A" }],
  inferredContext: { ...inferNightContext("Clapham tonight").context, stopCount: 1 },
  groundingProof: "new-proof", routeRevision: 1,
};
const T0 = Date.parse("2026-11-03T12:00:00.000Z");
const START = "2026-11-03T19:00";
let root: Root | null = null;
let host: HTMLElement | null = null;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
  authSeedFixture.user = null;
  authSeedFixture.handle = null;
  authSeedFixture.identityResolved = true;
  fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
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
    await act(async () => {
      await vi.waitFor(() => expect(document.querySelector(".planStops__placeholder")).toBeNull(), { timeout: 4000 });
    });
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


function seedStaleRoute(wizard = false): void {
  const intake = skipRemainingPlanIntake(createPlanIntakeDraft());
  const timed = {
    ...intake, skippedSteps: intake.skippedSteps.filter((step) => step !== "time-window"),
    answers: { ...intake.answers, timeWindow: "evening" as const, exactStartIso: "2026-11-03T19:00:00.000Z" },
  };
  expect(writePlanIntakeDraft(wizard ? reopenPlanIntakeStep(timed, "accessibility") : timed, localStorage, T0)).toBe(true);
  writePlanDraftEnvelope({
    title: "Night", creatorName: "Captain", startTime: START, conciergeQuery: "",
    stops: [{ key: 1, venueId: "venue-a", venueName: "Pub A" }],
  }, "manual", sessionStorage, T0);
  localStorage.setItem(PLAN_ROUTE_DRAFT_KEY, JSON.stringify({
    savedAt: new Date(T0).toISOString(), stops: GENERATED.stops.map((stop, index) => ({ key: index + 1, ...stop, alternatives: [] })),
    nightContext: GENERATED.inferredContext, routeNight: null, routeRevision: 1,
    routeStale: true, groundingProof: "old-proof", createOperationKey: "old-operation", planAnchor: null,
  }));
}

async function editInput(selector: string, value: string): Promise<void> {
  await act(async () => {
    const field = document.querySelector<HTMLInputElement>(selector)!;
    expect(field).not.toBeNull();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}

function pinClock(): (offset: number) => void {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  onTestFinished(() => { vi.useRealTimers(); });
  return (offset) => vi.setSystemTime(T0 + offset);
}

async function regenerate(): Promise<Record<string, unknown>> {
  await openTune();
  await editInput("#plan-concierge-query", "Clapham tonight");
  await sortAgainFromTune();
  const post = fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/plans/generate")).at(-1)!;
  expect(post).toBeDefined();
  return JSON.parse(String(post[1]?.body));
}

async function saveRoute(): Promise<Record<string, unknown>> {
  await act(async () => document.querySelector<HTMLFormElement>("#plan-composer")!.requestSubmit());
  const post = fetchMock.mock.calls.find(([input]) => String(input) === "/api/plans")!;
  expect(post, document.querySelector("#plan-composer-error")?.textContent ?? "No plan save request").toBeDefined();
  return JSON.parse(String(post[1]?.body));
}

describe("request save age with an unchanged stale route", () => {
  it("saves failed-generation staleness without advancing the route date", async () => {
    const advance = pinClock();
    seedStaleRoute();
    const route = JSON.parse(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)!);
    localStorage.setItem(PLAN_ROUTE_DRAFT_KEY, JSON.stringify({ ...route, routeStale: false }));
    await mountComposer();
    await openTune();
    advance(1000);
    fetchMock.mockImplementation(async () => new Response("{}", { status: 503 }));
    await sortAgainFromTune();
    expect(JSON.parse(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)!)).toMatchObject({
      savedAt: "2026-11-03T12:00:00.000Z", routeStale: true,
      stops: [{ venueId: "venue-a", venueName: "Pub A" }],
    });
    advance(2000);
    await remountComposer();
    expect(document.querySelector(".planStop__name")?.textContent).toBe("Pub A");
    expect(document.querySelector("#plan-lock-hint")?.textContent).toBe("Refresh the route before locking it in.");
    expect(readPlanDraftEnvelope(sessionStorage)?.savedAt).toBe("2026-11-03T12:00:00.000Z");
  });

  it.each(["failure", "empty", "anchor-conflict"].flatMap((outcome) => [false, true].map((samePub) => ({ outcome, samePub }))))(
    "does not redate an unchanged route after $outcome with matching pubs $samePub", async ({ outcome, samePub }) => {
    const advance = pinClock();
    seedStaleRoute();
    const initial = JSON.parse(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)!);
    localStorage.setItem(PLAN_ROUTE_DRAFT_KEY, JSON.stringify({ ...initial, routeStale: false }));
    await mountComposer();
    await openTune();
    advance(1000);
    const competing = {
      ...initial, savedAt: "2026-11-03T12:00:01.000Z",
      stops: [{ key: 1, venueId: samePub ? "venue-a" : "venue-b", venueName: samePub ? "Pub A" : "Pub B", alternatives: [] }],
      groundingProof: "competing-proof", createOperationKey: "competing-operation",
      nightContext: { ...GENERATED.inferredContext, nightArea: "piccadilly-soho", transportConstraints: ["walking"] },
    };
    localStorage.setItem(PLAN_ROUTE_DRAFT_KEY, JSON.stringify(competing));
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(outcome === "anchor-conflict"
      ? { outcome: "anchor-conflict", message: "Keep this pub" } : { stops: [] }), {
      status: outcome === "failure" ? 503 : 200,
      headers: { "content-type": "application/json" },
    }));
    advance(2000);
    await sortAgainFromTune();
    expect(document.querySelector(".planStop__name")?.textContent).toBe("Pub A");
    expect(JSON.parse(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)!)).toEqual(competing);
    await remountComposer();
    expect(document.querySelector(".planStop__name")?.textContent).toBe(samePub ? "Pub A" : "Pub B");
    expect(JSON.parse(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)!)).toMatchObject({
      savedAt: "2026-11-03T12:00:01.000Z", createOperationKey: "competing-operation",
      nightContext: { nightArea: "piccadilly-soho", transportConstraints: ["walking"] },
    });
    },
  );

  it.each([false, true].flatMap((localBlocked) => [false, true].map((legacy) => ({ localBlocked, legacy }))))("preserves missing-intake count across reloads, blocked: $localBlocked, legacy: $legacy", async ({ localBlocked, legacy }) => {
    const advance = pinClock();
    seedStaleRoute();
    localStorage.removeItem(PLAN_INTAKE_STORAGE_KEY);
    const draft = readPlanDraftEnvelope(sessionStorage)!.draft;
    writePlanDraftEnvelope({ ...draft, requestedStopCount: 5 }, "manual", sessionStorage, T0);
    if (legacy) {
      const undated = JSON.parse(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)!);
      delete undated.savedAt;
      localStorage.setItem(PLAN_ROUTE_DRAFT_KEY, JSON.stringify(undated));
    }
    const session = blockStorageWrites("sessionStorage");
    const local = localBlocked ? blockStorageWrites("localStorage") : localStorage;
    const route = local.getItem(PLAN_ROUTE_DRAFT_KEY);
    advance(1000);
    await mountComposer();
    advance(2000);
    await remountComposer();
    advance(3000);
    await remountComposer();
    await openTune();
    expect(document.querySelector<HTMLSelectElement>("#plan-context-stops")?.value).toBe("5");
    expect(local.getItem(PLAN_ROUTE_DRAFT_KEY)).toBe(route);
    expect(readPlanDraftEnvelope(session)?.draft.requestedStopCount).toBe(5);
    expect(local.getItem(PLAN_INTAKE_STORAGE_KEY)).toBeNull();
    if (localBlocked) {
      expect(readPlanDraftEnvelope(session)?.draft).toEqual({ ...draft, requestedStopCount: 5 });
      expect(document.querySelector<HTMLInputElement>("#plan-title")?.value).toBe("Night");
      expect(document.querySelector<HTMLInputElement>("#plan-name")?.value).toBe("Captain");
      expect(document.querySelector<HTMLInputElement>("#plan-time")?.value).toBe(START);
      expect(document.body.textContent).not.toContain("Your changes could not be saved on this device");
    }
    advance(4000);
    await editInput("#plan-concierge-query", "Clapham tonight");
    if (localBlocked) {
      expect(local.getItem(PLAN_INTAKE_STORAGE_KEY)).toBeNull();
    } else {
      expect(readPlanIntakeDraftWithMetadata(local)).toMatchObject({
        savedAt: "2026-11-03T12:00:04.000Z", draft: { answers: { stopCount: 5 } },
      });
    }
    await sortAgainFromTune();
    const generation = fetchMock.mock.calls.find(([input]) => String(input).includes("/api/plans/generate"))!;
    expect(JSON.parse(String(generation[1]?.body))).toMatchObject({ intake: { stopCount: 5 }, context: { stopCount: 5 } });
  });

  it("does not overwrite a newer competing route during a request-only edit", async () => {
    const advance = pinClock();
    seedStaleRoute();
    await mountComposer();
    advance(1000);
    const competing = {
      ...JSON.parse(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)!),
      savedAt: "2026-11-03T12:00:01.000Z", groundingProof: "competing-proof", createOperationKey: "competing-operation",
      nightContext: { ...GENERATED.inferredContext, nightArea: "soho" },
    };
    localStorage.setItem(PLAN_ROUTE_DRAFT_KEY, JSON.stringify(competing));
    advance(2000);
    await editInput("#plan-title", "Our night");
    expect(JSON.parse(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)!)).toEqual(competing);
    expect(readPlanDraftEnvelope(sessionStorage)).toMatchObject({
      savedAt: "2026-11-03T12:00:02.000Z", draft: { title: "Our night" },
    });
  });

  it("does not overwrite a newer route saved between recovery and the first copy", async () => {
    const advance = pinClock();
    seedStaleRoute();
    const local = localStorage;
    const competing = JSON.stringify({
      ...JSON.parse(local.getItem(PLAN_ROUTE_DRAFT_KEY)!),
      savedAt: "2026-11-03T12:00:01.000Z", groundingProof: "competing-proof", createOperationKey: "competing-operation",
    });
    let reads = 0;
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => {
        if (key === PLAN_ROUTE_DRAFT_KEY && ++reads === 2) local.setItem(key, competing);
        return local.getItem(key);
      },
      setItem: local.setItem.bind(local), removeItem: local.removeItem.bind(local),
      clear: local.clear.bind(local), key: local.key.bind(local), get length() { return local.length; },
    } satisfies Storage);
    advance(2000);
    await mountComposer();
    expect(local.getItem(PLAN_ROUTE_DRAFT_KEY)).toBe(competing);
    expect(document.body.textContent).toContain("route details, checks and starting pub could not be saved");
  });

  it("keeps generated proof and route age while saving a later request edit", async () => {
    const advance = pinClock();
    seedStaleRoute();
    await mountComposer();
    await openTune();
    await editInput("#plan-concierge-query", "Clapham tonight");
    advance(1000);
    await sortAgainFromTune();
    const route = localStorage.getItem(PLAN_ROUTE_DRAFT_KEY);
    expect(JSON.parse(route!)).toMatchObject({
      savedAt: "2026-11-03T12:00:01.000Z", groundingProof: "new-proof", routeStale: false,
    });
    advance(2000);
    await editInput("#plan-title", "Our night");
    expect(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)).toBe(route);
    expect(readPlanDraftEnvelope(sessionStorage)).toMatchObject({
      savedAt: "2026-11-03T12:00:02.000Z", draft: { title: "Our night" },
    });
    expect(await saveRoute()).toMatchObject({ title: "Our night", groundingProof: "new-proof" });
  });

  it("restores the latest session start time after an earlier local-only exact-time edit", async () => {
    const advance = pinClock();
    seedStaleRoute();
    const session = blockStorageWrites("sessionStorage");
    const local = rejectRouteWrites([PLAN_ROUTE_DRAFT_KEY, PLAN_ROUTE_DRAFT_V2_KEY]);
    const route = local.getItem(PLAN_ROUTE_DRAFT_KEY);
    await mountComposer();
    advance(1000);
    await editInput("#plan-time", "2026-11-03T20:00");
    expect(readPlanIntakeDraftWithMetadata(local)?.savedAt).toBe("2026-11-03T12:00:01.000Z");
    vi.stubGlobal("sessionStorage", session);
    vi.stubGlobal("localStorage", local);
    blockStorageWrites("localStorage");
    advance(2000);
    await remountComposer();
    advance(3000);
    await editInput("#plan-time", "2026-11-03T21:00");
    expect(readPlanDraftEnvelope(session)?.savedAt).toBe("2026-11-03T12:00:03.000Z");
    expect(local.getItem(PLAN_ROUTE_DRAFT_KEY)).toBe(route);
    expect(document.body.textContent).toContain("Opening and travel checks are unavailable for this restored draft.");
    expect(document.querySelector("#plan-lock-hint")?.textContent).toContain("Refresh the route");
    advance(4000);
    await remountComposer();
    expect(document.querySelector<HTMLInputElement>("#plan-time")?.value).toBe("2026-11-03T21:00");
    const request = await regenerate();
    expect(request.intake).toMatchObject({ timeWindow: { exactStartIso: "2026-11-03T21:00:00.000Z" } });
    const saved = await saveRoute();
    expect(saved.startTime).toBe("2026-11-03T21:00:00.000Z");
    expect(saved.groundingProof).toBe("new-proof");
  });

  it.each([
    { field: "start time", selector: "#plan-time", value: "2026-11-03T20:00", stored: "startTime" },
    { field: "description", selector: "#plan-concierge-query", value: "Clapham tonight", stored: "conciergeQuery" },
    { field: "title", selector: "#plan-title", value: "Our night", stored: "title" },
    { field: "creator", selector: "#plan-name", value: "Alex", stored: "creatorName" },
  ].flatMap((testCase) => [false, true].map((routeBlocked) => ({ ...testCase, routeBlocked }))))("dates a $field edit without redating the route, blocked: $routeBlocked", async ({ selector, value, stored, routeBlocked }) => {
    const advance = pinClock();
    seedStaleRoute();
    const local = routeBlocked ? rejectRouteWrites([PLAN_ROUTE_DRAFT_KEY, PLAN_ROUTE_DRAFT_V2_KEY]) : localStorage;
    const route = local.getItem(PLAN_ROUTE_DRAFT_KEY);
    await mountComposer();
    if (selector === "#plan-concierge-query") await openTune();
    advance(1000);
    await editInput(selector, value);
    expect(readPlanDraftEnvelope(sessionStorage)).toMatchObject({
      savedAt: "2026-11-03T12:00:01.000Z", draft: { [stored]: value },
    });
    expect(readPlanIntakeDraftWithMetadata(local)?.savedAt).toBe("2026-11-03T12:00:01.000Z");
    expect(local.getItem(PLAN_ROUTE_DRAFT_KEY)).toBe(route);
    advance(2000);
    await remountComposer();
    if (selector === "#plan-concierge-query") await openTune();
    expect(document.querySelector<HTMLInputElement>(selector)?.value).toBe(value);
  });

  it("keeps a selected count through session-only recovery, generation and saving", async () => {
    const advance = pinClock();
    seedStaleRoute();
    const local = blockStorageWrites("localStorage");
    const route = local.getItem(PLAN_ROUTE_DRAFT_KEY);
    await mountComposer();
    await openTune();
    advance(1000);
    await act(async () => {
      const picker = document.querySelector<HTMLSelectElement>("#plan-context-stops")!;
      picker.value = "5";
      picker.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(readPlanDraftEnvelope(sessionStorage)).toMatchObject({ savedAt: "2026-11-03T12:00:01.000Z", draft: { requestedStopCount: 5 } });
    expect(local.getItem(PLAN_ROUTE_DRAFT_KEY)).toBe(route);
    advance(2000);
    await remountComposer();
    await openTune();
    expect(document.querySelector<HTMLSelectElement>("#plan-context-stops")?.value).toBe("5");
    await editInput("#plan-concierge-query", "Clapham tonight");
    fetchMock.mockImplementation(async (input) => new Response(JSON.stringify(String(input).includes("/api/plans/generate") ? {
      ...GENERATED,
      inferredContext: { ...GENERATED.inferredContext, stopCount: 5 },
      stops: [
        { venueId: "venue-a", venueName: "Pub A" },
        { venueId: "venue-b", venueName: "Pub B" },
        { venueId: "venue-c", venueName: "Pub C" },
        { venueId: "venue-d", venueName: "Pub D" },
        { venueId: "venue-e", venueName: "Pub E" },
      ],
    } : []), { status: 200, headers: { "content-type": "application/json" } }));
    await sortAgainFromTune();
    const generation = fetchMock.mock.calls.find(([input]) => String(input).includes("/api/plans/generate"))!;
    expect(JSON.parse(String(generation[1]?.body))).toMatchObject({ intake: { stopCount: 5 }, context: { stopCount: 5 } });
    expect(readPlanDraftEnvelope(sessionStorage)?.draft.requestedStopCount).toBe(5);
    expect((await saveRoute()).groundingProof).toBe("new-proof");
  });

  it("does not backdate an edit that returns a request field to its original value", async () => {
    const advance = pinClock();
    seedStaleRoute();
    rejectRouteWrites([PLAN_ROUTE_DRAFT_KEY, PLAN_ROUTE_DRAFT_V2_KEY]);
    await mountComposer();
    advance(1000);
    await editInput("#plan-title", "Changed night");
    advance(2000);
    await editInput("#plan-title", "Night");
    expect(readPlanDraftEnvelope(sessionStorage)).toMatchObject({ savedAt: "2026-11-03T12:00:02.000Z", draft: { title: "Night" } });
    advance(3000);
    await remountComposer();
    expect(readPlanDraftEnvelope(sessionStorage)?.savedAt).not.toBe("2026-11-03T12:00:00.000Z");
  });

  it("dates an intake access edit while preserving the stored route and UNKNOWN stop intent", async () => {
    const advance = pinClock();
    seedStaleRoute(true);
    const local = rejectRouteWrites([PLAN_ROUTE_DRAFT_KEY, PLAN_ROUTE_DRAFT_V2_KEY]);
    const route = local.getItem(PLAN_ROUTE_DRAFT_KEY);
    await mountComposer();
    advance(1000);
    await act(async () => {
      [...document.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Step-free access")!.click();
    });
    await settle();
    expect(readPlanIntakeDraftWithMetadata(local)).toMatchObject({
      savedAt: "2026-11-03T12:00:01.000Z", draft: { answers: { accessibilityNeeds: ["step-free"] } },
    });
    expect(readPlanDraftEnvelope(sessionStorage)?.savedAt).toBe("2026-11-03T12:00:01.000Z");
    expect(local.getItem(PLAN_ROUTE_DRAFT_KEY)).toBe(route);
    advance(2000);
    await remountComposer();
    expect(document.querySelector('[aria-label="Choose accessibility needs"] button')?.getAttribute("aria-pressed")).toBe("true");
    expect(readPlanDraftEnvelope(sessionStorage)?.draft.requestedStopCount).toBeUndefined();
    const request = await regenerate();
    expect(request.intake).toMatchObject({ accessibilityNeeds: ["step-free"] });
    expect(request.intake).not.toHaveProperty("stopCount");
    expect((await saveRoute()).groundingProof).toBe("new-proof");
  });

  it("keeps the age and proof of an unchanged copy when local route writes fail", async () => {
    const advance = pinClock();
    seedStaleRoute();
    const local = rejectRouteWrites([PLAN_ROUTE_DRAFT_KEY, PLAN_ROUTE_DRAFT_V2_KEY]);
    const route = local.getItem(PLAN_ROUTE_DRAFT_KEY);
    advance(1000);
    await mountComposer();
    expect(readPlanDraftEnvelope(sessionStorage)?.savedAt).toBe("2026-11-03T12:00:00.000Z");
    expect(local.getItem(PLAN_ROUTE_DRAFT_KEY)).toBe(route);
    advance(2000);
    await remountComposer();
    expect(JSON.parse(local.getItem(PLAN_ROUTE_DRAFT_KEY)!)).toMatchObject({ groundingProof: "old-proof", createOperationKey: "old-operation" });
    expect(document.body.textContent).not.toContain("route details, checks and starting pub could not be saved");
  });
});


it("retains an explicit Tune budget edit after restoring paired route records", async () => {
  const advance = pinClock();
  const payload = btoa(JSON.stringify({ v: 1, expiresAt: T0 + 3_600_000 }));
  expect(transferGeneratedRouteToDraft({
    ...GENERATED,
    inferredContext: { ...GENERATED.inferredContext, budget: "standard", budgetLimitPence: null, transportConstraints: [] },
    groundingProof: `${payload}.test-only-signature`, operationKey: "handoff-operation",
    outcome: "unanchored", anchorVenueId: null, anchorSource: null,
  }, localStorage, "map-generated", T0)).toBe(true);
  await mountComposer();
  await openTune();
  expect(document.querySelector<HTMLSelectElement>("#plan-context-budget")?.value).toBe("standard");
  advance(1000);
  await act(async () => {
    const field = document.querySelector<HTMLSelectElement>("#plan-context-budget")!;
    field.value = "value";
    field.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
  expect(document.querySelector<HTMLSelectElement>("#plan-context-budget")?.value).toBe("value");
  expect(JSON.parse(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)!)).toMatchObject({ nightContext: { budget: "value" } });
  advance(2000);
  await remountComposer();
  await openTune();
  expect(document.querySelector<HTMLSelectElement>("#plan-context-budget")?.value).toBe("value");
  await sortAgainFromTune();
  const post = fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/plans/generate")).at(-1)!;
  expect(JSON.parse(String(post[1]?.body))).toMatchObject({ context: { budget: "value" } });
});


function seedTuneRoute(origin: "map-generated" | "plan-generated", withIntake = false): void {
  const payload = btoa(JSON.stringify({ v: 1, expiresAt: T0 + 3_600_000 }));
  expect(transferGeneratedRouteToDraft({
    ...GENERATED,
    inferredContext: {
      ...GENERATED.inferredContext, nightArea: "clapham", daypart: "evening", partyType: "friends",
      groupSize: 4, budget: "standard", budgetLimitPence: 4500, drinkCategory: "wine", zeroProof: false,
      transportConstraints: [],
    },
    groundingProof: `${payload}.test-only-signature`, operationKey: "handoff-operation",
    outcome: "unanchored", anchorVenueId: null, anchorSource: null,
  }, localStorage, origin, T0)).toBe(true);
  if (withIntake) {
    const draft = skipRemainingPlanIntake(createPlanIntakeDraft());
    const completed = { ...draft, currentStep: "accessibility", skippedSteps: ["accessibility"], answers: {
      ...draft.answers, area: "clapham", timeWindow: "evening", groupSize: 4,
      exactStartIso: nextLondonOccurrenceIso("evening", new Date(T0)),
      budget: "standard", budgetLimitPence: 4500,
    } } satisfies ReturnType<typeof createPlanIntakeDraft>;
    expect(writePlanIntakeDraft(completed, localStorage, T0)).toBe(true);
    expect(readPlanIntakeDraftWithMetadata(localStorage, T0)?.draft).toEqual(completed);
  }
}

async function editTuneControl(id: string, value: string): Promise<void> {
  const selector = `#plan-context-${id}`;
  if (document.querySelector(selector) instanceof HTMLInputElement) {
    await editInput(selector, value);
    return;
  }
  await act(async () => {
    const field = document.querySelector<HTMLSelectElement>(selector)!;
    expect(field).not.toBeNull();
    field.value = value;
    field.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
}

it.each([
  { id: "area", value: "piccadilly-soho", context: { nightArea: "piccadilly-soho" } },
  { id: "time", value: "late_night", context: { daypart: "late_night" } },
  { id: "time", value: "daytime", context: { daypart: "daytime" } },
  { id: "group", value: "work", context: { partyType: "work" } },
  { id: "people", value: "6", context: { groupSize: 6 } },
  { id: "people", value: "", context: { groupSize: null } },
  { id: "budget", value: "value", context: { budget: "value" } },
  { id: "budget-limit", value: "35", context: { budgetLimitPence: 3500 } },
  { id: "budget-limit", value: "", context: { budgetLimitPence: null } },
  { id: "zero-proof", value: "cocktail", context: { drinkCategory: "cocktail", zeroProof: false } },
  { id: "zero-proof", value: "zero-proof", context: { drinkCategory: null, zeroProof: true } },
  { id: "zero-proof", value: "any", context: { drinkCategory: null, zeroProof: false } },
  { id: "stops", value: "5", context: { stopCount: 5 } },
].flatMap((choice) => [false, true].map((withIntake) => ({ ...choice, withIntake }))))(
  "restores Tune $id=$value through request and save, intake: $withIntake",
  async ({ id, value, context, withIntake }) => {
    const advance = pinClock();
    seedTuneRoute(withIntake ? "plan-generated" : "map-generated", withIntake);
    await mountComposer();
    await openTune();
    advance(1000);
    await editTuneControl(id, value);
    expect(JSON.parse(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)!)).toMatchObject({
      savedAt: "2026-11-03T12:00:01.000Z", nightContext: context,
      routeStale: true, groundingProof: null, createOperationKey: null,
    });
    expect(readPlanDraftEnvelope(sessionStorage)).toMatchObject({ savedAt: "2026-11-03T12:00:01.000Z" });
    advance(2000);
    await remountComposer();
    advance(3000);
    await remountComposer();
    await openTune();
    expect(document.querySelector<HTMLInputElement | HTMLSelectElement>(`#plan-context-${id}`)?.value).toBe(value);
    expect(document.querySelector("#plan-route-status")?.textContent).toBe("Recovered a route that needs refreshing before it can be locked.");
    expect(readPlanDraftEnvelope(sessionStorage)?.draft.requestedStopCount).toBe(id === "stops" ? 5 : undefined);
    await editInput("#plan-name", "Captain");
    await sortAgainFromTune();
    const post = fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/plans/generate")).at(-1)!;
    expect(JSON.parse(String(post[1]?.body))).toMatchObject({ context });
    expect(reconciledGenerationContext()).toMatchObject(context);
    if (id === "stops") {
      expect(document.querySelector("#plan-lock-hint")?.textContent).toContain("5 stops");
      expect(readPlanDraftEnvelope(sessionStorage)?.draft.requestedStopCount).toBe(5);
    } else {
      expect(await saveRoute()).toMatchObject({ context, groundingProof: "new-proof" });
    }
  },
);

it.each(["session", "route", "both"] as const)("handles a Tune edit when %s writes fail", async (blocked) => {
  const advance = pinClock();
  seedTuneRoute("map-generated");
  await mountComposer();
  await openTune();
  const local = blocked === "session" ? localStorage : rejectRouteWrites([PLAN_ROUTE_DRAFT_KEY]);
  if (blocked !== "route") blockStorageWrites("sessionStorage");
  advance(1000);
  await editTuneControl("budget", "value");
  expect(document.querySelector<HTMLSelectElement>("#plan-context-budget")?.value).toBe("value");
  if (blocked === "session") {
    expect(JSON.parse(local.getItem(PLAN_ROUTE_DRAFT_KEY)!)).toMatchObject({
      savedAt: "2026-11-03T12:00:01.000Z", nightContext: { budget: "value" }, routeStale: true,
    });
    advance(2000);
    await remountComposer();
    await openTune();
    expect(document.querySelector<HTMLSelectElement>("#plan-context-budget")?.value).toBe("value");
  } else {
    expect(document.body.textContent).toContain("could not be saved");
    expect(JSON.parse(local.getItem(PLAN_ROUTE_DRAFT_KEY)!)).toMatchObject({
      savedAt: "2026-11-03T12:00:00.000Z", nightContext: { budget: "standard" },
    });
  }
  await sortAgainFromTune();
  const post = fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/plans/generate")).at(-1)!;
  expect(JSON.parse(String(post[1]?.body))).toMatchObject({ context: { budget: "value" } });
});

function reconciledGenerationContext() {
  const post = fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/plans/generate")).at(-1)!;
  const request = JSON.parse(String(post[1]?.body));
  const parsed = parsePlanGenerationIntake(request.intake, new Date(T0));
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(parsed.message);
  return reconcilePlanContext(request.query ?? "", request.context, parsed.value, new Date(T0)).context;
}

async function generateFromDescription(query = "Clapham tonight"): Promise<void> {
  await mountComposer();
  await editInput("#plan-describe-first-query", query);
  await act(async () => {
    [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Plan it")!.click();
  });
  await settle();
}

it.each(["immediate", "reload", "legacy", "invalid-ownership"] as const)(
  "lets a new description replace unowned generated defaults after %s",
  async (mode) => {
    pinClock();
    if (mode === "legacy" || mode === "invalid-ownership") {
      seedTuneRoute("map-generated");
      const route = JSON.parse(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)!);
      localStorage.setItem(PLAN_ROUTE_DRAFT_KEY, JSON.stringify({
        ...route, routeStale: true, groundingProof: null,
        ...(mode === "invalid-ownership" ? { explicitNightContext: { daypart: "invalid", groupSize: 90, budget: "invalid", budgetLimitPence: -1 } } : {}),
      }));
      localStorage.removeItem(PLAN_ROUTE_DRAFT_V2_KEY);
      await mountComposer();
    } else {
      await generateFromDescription();
      if (mode === "reload") await remountComposer();
    }
    await openTune();
    const query = "Clapham after work for 8, cheap, under £20 each";
    await editInput("#plan-concierge-query", query);
    await sortAgainFromTune();
    const post = fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/plans/generate")).at(-1)!;
    const request = JSON.parse(String(post[1]?.body));
    expect(request.query).toBe(query);
    expect(reconciledGenerationContext()).toMatchObject({ daypart: "after_work", groupSize: 8, budget: "value", budgetLimitPence: 2000 });
    expect(readPlanDraftEnvelope(sessionStorage)?.draft.requestedStopCount).toBeUndefined();
  },
);

it.each([
  { id: "time", value: "daytime", context: { daypart: "daytime" } },
  { id: "people", value: "", context: { groupSize: null } },
  { id: "budget", value: "treat", context: { budget: "treat" } },
  { id: "budget-limit", value: "", context: { budgetLimitPence: null } },
].flatMap((choice) => [false, true].map((reload) => ({ ...choice, reload }))))(
  "keeps explicit Tune $id=$value ahead of a new description, reload: $reload",
  async ({ id, value, context, reload }) => {
    const advance = pinClock();
    seedTuneRoute("map-generated");
    await mountComposer();
    await openTune();
    advance(1000);
    await editTuneControl(id, value);
    expect(JSON.parse(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)!)).toMatchObject({ explicitNightContext: context });
    if (reload) {
      advance(2000);
      await remountComposer();
      await openTune();
    }
    await editInput("#plan-concierge-query", "Clapham after work for 8, cheap, under £20 each");
    await sortAgainFromTune();
    expect(reconciledGenerationContext()).toMatchObject(context);
  },
);

it("gives a fresh confirmed URL Ask priority over recovered Tune authority", async () => {
  const advance = pinClock();
  seedTuneRoute("map-generated");
  await mountComposer();
  await openTune();
  advance(1000);
  await editTuneControl("budget", "value");
  const query = "Clapham tonight, a treat night";
  window.history.replaceState({}, "", `/plan?query=${encodeURIComponent(query)}`);
  advance(2000);
  await remountComposer();
  await openTune();
  expect(document.querySelector<HTMLInputElement>("#plan-concierge-query")?.value).toBe(query);
  await sortAgainFromTune();
  const post = fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/plans/generate")).at(-1)!;
  const request = JSON.parse(String(post[1]?.body));
  expect(request.query).toBe(query);
  const parsed = parsePlanGenerationIntake(request.intake, new Date(T0 + 2000));
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(parsed.message);
  expect(reconcilePlanContext(query, request.context, parsed.value, new Date(T0 + 2000)).context.budget).toBe("treat");
});

async function confirmFreshAsk(channel: "url" | "session", query: string): Promise<void> {
  if (channel === "url") {
    window.history.replaceState({}, "", `/plan?query=${encodeURIComponent(query)}`);
  } else {
    sessionStorage.setItem(ASK_PLAN_DRAFT_STORAGE_KEY, JSON.stringify({ query }));
  }
  await remountComposer();
}

it.each([
  { id: "area", value: "piccadilly-soho" },
  { id: "time", value: "daytime" },
  { id: "time", value: "get_home" },
  { id: "group", value: "solo" },
  { id: "people", value: "6" },
  { id: "people", value: "" },
  { id: "budget", value: "value" },
  { id: "budget-limit", value: "35" },
  { id: "budget-limit", value: "" },
  { id: "zero-proof", value: "cocktail" },
  { id: "zero-proof", value: "zero-proof" },
  { id: "stops", value: "5" },
].flatMap((choice) => (["url", "session"] as const).map((channel) => ({ ...choice, channel }))))(
  "replaces earlier Tune $id=$value with a fresh $channel Ask",
  async ({ id, value, channel }) => {
    const advance = pinClock();
    seedTuneRoute("plan-generated", true);
    await mountComposer();
    await openTune();
    advance(1000);
    await editTuneControl(id, value);
    advance(2000);
    const query = "Two pubs in Clapham after work for 8 colleagues, a treat night, beer, under £20 each";
    await confirmFreshAsk(channel, query);
    expect(readPlanDraftEnvelope(sessionStorage)?.draft).toMatchObject({ conciergeQuery: query, requestedStopCount: 2 });
    expect(readPlanIntakeDraftWithMetadata(localStorage)?.draft.answers).toMatchObject({
      area: channel === "url" ? "clapham" : null, timeWindow: null, exactStartIso: null, groupSize: null,
      budget: null, budgetLimitPence: null, accessibilityNeeds: [], stopCount: 2,
    });
    expect(JSON.parse(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)!)).toMatchObject({
      savedAt: channel === "url" ? "2026-11-03T12:00:02.000Z" : "2026-11-03T12:00:01.000Z",
    });
    if (channel === "url") {
      expect(fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/plans/generate"))).toHaveLength(1);
      expect(reconciledGenerationContext()).toMatchObject({
        nightArea: "clapham", daypart: "after_work", partyType: "work", groupSize: 8,
        budget: "treat", budgetLimitPence: 2000, drinkCategory: "beer", zeroProof: false, stopCount: 2,
      });
    }
    await openTune();
    expect(document.querySelector<HTMLSelectElement>("#plan-context-stops")?.value).toBe("2");
    await sortAgainFromTune();
    expect(reconciledGenerationContext()).toMatchObject({
      nightArea: "clapham", daypart: "after_work", partyType: "work", groupSize: 8,
      budget: "treat", budgetLimitPence: 2000, drinkCategory: "beer", zeroProof: false, stopCount: 2,
    });
  },
);

it.each(["url", "session"] as const)("keeps UNKNOWN intent and subsequent Tune authority after a fresh %s Ask", async (channel) => {
  const advance = pinClock();
  seedTuneRoute("map-generated");
  await mountComposer();
  await openTune();
  advance(1000);
  await editTuneControl("stops", "5");
  await editTuneControl("budget", "value");
  advance(2000);
  await confirmFreshAsk(channel, "Clapham tonight, a treat night");
  expect(readPlanDraftEnvelope(sessionStorage)?.draft.requestedStopCount).toBeUndefined();
  expect(readPlanIntakeDraftWithMetadata(localStorage)?.draft.answers.stopCount).toBeUndefined();
  await openTune();
  advance(3000);
  await editTuneControl("budget", "standard");
  await sortAgainFromTune();
  expect(reconciledGenerationContext()).toMatchObject({ budget: "standard", stopCount: 3 });
  expect(readPlanDraftEnvelope(sessionStorage)?.draft.requestedStopCount).toBeUndefined();
});

it.each(["existing", "url", "session"] as const)("uses only the owning request's area fallback for %s", async (channel) => {
  pinClock();
  seedTuneRoute("map-generated");
  await mountComposer();
  if (channel !== "existing") await confirmFreshAsk(channel, "A treat night");
  await openTune();
  if (channel === "existing") await editInput("#plan-concierge-query", "A treat night");
  await sortAgainFromTune();
  expect(reconciledGenerationContext()).toMatchObject({
    nightArea: channel === "existing" ? "clapham" : null, budget: "treat",
  });
});

it("does not promote generated drink and group defaults over a new description", async () => {
  pinClock();
  await generateFromDescription();
  await openTune();
  await editInput("#plan-concierge-query", "Clapham tonight, alcohol-free, with work colleagues");
  await sortAgainFromTune();
  expect(reconciledGenerationContext()).toMatchObject({ zeroProof: true, partyType: "work" });
});


it("clears recovered authority before the first automatic URL Ask generation", async () => {
  const advance = pinClock();
  seedTuneRoute("map-generated");
  await mountComposer();
  await openTune();
  advance(1000);
  await editTuneControl("budget", "value");
  fetchMock.mockClear();
  const query = "Clapham tonight, a treat night";
  window.history.replaceState({}, "", `/plan?query=${encodeURIComponent(query)}`);
  advance(2000);
  await remountComposer();
  await vi.waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/plans/generate"))).toBe(true));
  const post = fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/plans/generate"))[0]!;
  const request = JSON.parse(String(post[1]?.body));
  expect(request.query).toBe(query);
  const parsed = parsePlanGenerationIntake(request.intake, new Date(T0 + 2000));
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(parsed.message);
  expect(reconcilePlanContext(query, request.context, parsed.value, new Date(T0 + 2000)).context.budget).toBe("treat");
});


it("sends a valid time window when Tune changes an earlier exact evening to Late", async () => {
  pinClock();
  seedStaleRoute();
  await mountComposer();
  await openTune();
  await editTuneControl("time", "late_night");
  await sortAgainFromTune();
  const post = fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/plans/generate")).at(-1)!;
  const request = JSON.parse(String(post[1]?.body));
  expect(request.intake.timeWindow.id).toBe("late");
  const parsed = parsePlanGenerationIntake(request.intake, new Date(T0));
  expect(parsed).toMatchObject({ ok: true });
  if (!parsed.ok) throw new Error(parsed.message);
  expect(reconcilePlanContext(request.query ?? "", request.context, parsed.value, new Date(T0)).context.daypart).toBe("late_night");
});

function seedTimedRoute(timeWindow: "after-work" | "evening" | "late", input: string): void {
  seedStaleRoute();
  const route = JSON.parse(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)!);
  localStorage.setItem(PLAN_ROUTE_DRAFT_KEY, JSON.stringify({
    ...route, nightContext: { ...route.nightContext, daypart: timeWindow === "late" ? "late_night" : timeWindow === "after-work" ? "after_work" : "evening" },
  }));
  const intake = readPlanIntakeDraftWithMetadata(localStorage, T0)!.draft;
  const timed = { ...intake, answers: { ...intake.answers, timeWindow, exactStartIso: `${input}:00.000Z` } };
  expect(writePlanIntakeDraft(timed, localStorage, T0)).toBe(true);
  expect(readPlanIntakeDraftWithMetadata(localStorage, T0)?.draft).toEqual(timed);
  const session = readPlanDraftEnvelope(sessionStorage)!;
  writePlanDraftEnvelope({ ...session.draft, startTime: input }, session.origin, sessionStorage, T0);
}

function generateWithServerContext(): void {
  fetchMock.mockImplementation(async (input, init) => {
    let body: unknown = [];
    if (String(input).includes("/api/plans/generate")) {
      const request = JSON.parse(String(init?.body));
      const parsed = parsePlanGenerationIntake(request.intake, new Date());
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) throw new Error(parsed.message);
      body = { ...GENERATED, inferredContext: reconcilePlanContext(request.query ?? "", request.context, parsed.value, new Date()).context };
    }
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  });
}

const TIME_EDITS = [
  { from: "evening", input: START, daypart: "late_night", window: "late", output: "2026-11-03T22:00" },
  { from: "late", input: "2026-11-03T23:30", daypart: "evening", window: "evening", output: START },
  { from: "after-work", input: "2026-11-03T17:45", daypart: "evening", window: "evening", output: START },
  { from: "evening", input: "2026-11-03T22:30", daypart: "late_night", window: "late", output: "2026-11-03T22:30" },
  { from: "late", input: "2026-11-03T22:30", daypart: "evening", window: "evening", output: "2026-11-03T22:30" },
  { from: "late", input: "2026-11-04T01:30", daypart: "evening", window: "evening", output: "2026-11-04T19:00" },
  { from: "evening", input: START, daypart: "daytime", window: null, output: START },
  { from: "evening", input: START, daypart: "get_home", window: null, output: START },
] as const;

it.each(TIME_EDITS.flatMap((edit) => (edit.window ? ["none", "session", "route"] as const : ["none", "session"] as const)
  .map((blocked) => ({ ...edit, blocked }))))(
  "keeps $from $input coherent with Tune $daypart when $blocked writes fail",
  async ({ from, input, daypart, window, output, blocked }) => {
    const advance = pinClock();
    seedTimedRoute(from, input);
    generateWithServerContext();
    await mountComposer();
    await openTune();
    if (blocked === "session") blockStorageWrites("sessionStorage");
    if (blocked === "route") rejectRouteWrites([PLAN_ROUTE_DRAFT_KEY, PLAN_ROUTE_DRAFT_V2_KEY]);
    advance(1000);
    await editTuneControl("time", daypart);
    expect(document.querySelector<HTMLInputElement>("#plan-time")?.value).toBe(output);
    expect(readPlanIntakeDraftWithMetadata(localStorage)?.draft.answers).toMatchObject({
      timeWindow: window, exactStartIso: window ? `${output}:00.000Z` : null,
    });
    if (blocked === "route") expect(document.body.textContent).toContain("could not be saved");
    advance(2000);
    await remountComposer();
    const restoredStart = blocked === "session" && !window ? "2026-11-03T18:00" : output;
    expect(document.querySelector<HTMLInputElement>("#plan-time")?.value).toBe(restoredStart);
    await openTune();
    await editInput("#plan-concierge-query", "Clapham tonight");
    await sortAgainFromTune();
    const post = fetchMock.mock.calls.filter(([url]) => String(url).includes("/api/plans/generate")).at(-1)!;
    const request = JSON.parse(String(post[1]?.body));
    expect(request.intake.timeWindow).toEqual(window ? {
      id: window, start: window === "late" ? "22:00" : "19:00", end: window === "late" ? null : "23:00",
      exactStartIso: `${output}:00.000Z`,
    } : null);
    expect(reconciledGenerationContext()).toMatchObject({ daypart });
    await editInput("#plan-name", "Captain");
    expect(await saveRoute()).toMatchObject({ startTime: `${restoredStart}:00.000Z`, context: { daypart } });
  },
);

it("retains a coherent Tune time in memory when both stores fail", async () => {
  pinClock();
  seedTimedRoute("evening", START);
  await mountComposer();
  await openTune();
  const local = blockStorageWrites("localStorage");
  blockStorageWrites("sessionStorage");
  await editTuneControl("time", "late_night");
  expect(document.body.textContent).toContain("could not be saved");
  expect(document.querySelector<HTMLInputElement>("#plan-time")?.value).toBe("2026-11-03T22:00");
  expect(readPlanIntakeDraftWithMetadata(local)?.draft.answers.exactStartIso).toBe("2026-11-03T19:00:00.000Z");
  await sortAgainFromTune();
  expect(reconciledGenerationContext()).toMatchObject({ daypart: "late_night" });
});


it.each([false, true])("updates successive typed stop counts while preserving real picker override: %s", async (picker) => {
  pinClock();
  await mountComposer();
  await editInput("#plan-describe-first-query", "One pub in Clapham tonight");
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Plan it")!.click());
  await settle();
  await openTune();
  if (picker) {
    await editTuneControl("stops", "2");
    await editTuneControl("stops", "1");
  }
  await editInput("#plan-concierge-query", "Six pubs in Clapham tonight");
  await sortAgainFromTune();
  expect(reconciledGenerationContext().stopCount).toBe(picker ? 1 : 6);
  expect(readPlanDraftEnvelope(sessionStorage)?.draft.requestedStopCount).toBe(picker ? 1 : 6);
  expect(readPlanDraftEnvelope(sessionStorage)?.draft.requestedStopCountSource).toBe(picker ? "picker" : "text");
  await remountComposer();
  await openTune();
  expect(document.querySelector<HTMLSelectElement>("#plan-context-stops")?.value).toBe(picker ? "1" : "6");
  await editInput("#plan-concierge-query", "Clapham tonight");
  await sortAgainFromTune();
  expect(reconciledGenerationContext().stopCount).toBe(picker ? 1 : 6);
});

it.each([
  { preset: "late_night", expected: "2026-11-04T22:30" },
  { preset: "evening", expected: "2026-11-04T22:30" },
  { preset: "after_work", expected: "2026-11-04T17:30" },
])("keeps the displayed future date with no intake preset for $preset", async ({ preset, expected }) => {
  pinClock();
  generateWithServerContext();
  await generateFromDescription();
  expect(readPlanIntakeDraftWithMetadata(localStorage)?.draft.answers.timeWindow ?? null).toBeNull();
  await editInput("#plan-time", "2026-11-04T22:30");
  await openTune();
  await editTuneControl("time", preset);
  expect(document.querySelector<HTMLInputElement>("#plan-time")?.value).toBe(expected);
  expect(readPlanDraftEnvelope(sessionStorage)?.draft.startTime).toBe(expected);
  expect(readPlanIntakeDraftWithMetadata(localStorage)?.draft.answers.exactStartIso).toBe(`${expected}:00.000Z`);
  await sortAgainFromTune();
  const post = fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/plans/generate")).at(-1)!;
  const request = JSON.parse(String(post[1]?.body));
  const parsed = parsePlanGenerationIntake(request.intake, new Date(T0));
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(parsed.message);
  expect(parsed.value.handoff.timeWindow?.exactStartIso).toBe(`${expected}:00.000Z`);
  await remountComposer();
  expect(document.querySelector<HTMLInputElement>("#plan-time")?.value).toBe(expected);
  await editInput("#plan-name", "Captain");
  expect(await saveRoute()).toMatchObject({ startTime: `${expected}:00.000Z`, context: { daypart: preset } });
});

it.each(["text", "picker"] as const)("keeps %s origin in both stores and out of the generation API", async (source) => {
  const advance = pinClock();
  await generateFromDescription("One pub in Clapham tonight");
  await openTune();
  advance(1000);
  if (source === "picker") await editTuneControl("stops", "2");
  await editInput("#plan-concierge-query", "Six pubs in Clapham tonight");
  await sortAgainFromTune();
  expect(reconciledGenerationContext().stopCount).toBe(source === "picker" ? 2 : 6);
  const post = fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/plans/generate")).at(-1)!;
  const body = JSON.parse(String(post[1]?.body));
  expect(body.intake).not.toHaveProperty("stopCountSource");
  expect(body.context).not.toHaveProperty("stopCountSource");
  expect(readPlanIntakeDraftWithMetadata(localStorage)?.draft.answers.stopCountSource).toBe(source);
});

it.each([
  { blocked: "localStorage", source: "text" },
  { blocked: "sessionStorage", source: "text" },
  { blocked: "localStorage", source: "picker" },
  { blocked: "sessionStorage", source: "picker" },
] as const)("recovers $source authority when $blocked writes fail", async ({ blocked, source }) => {
  const advance = pinClock();
  await generateFromDescription("One pub in Clapham tonight");
  const oldLocal = readPlanIntakeDraftWithMetadata(localStorage);
  const oldSession = readPlanDraftEnvelope(sessionStorage);
  blockStorageWrites(blocked);
  await openTune();
  advance(1000);
  if (source === "picker") await editTuneControl("stops", "5");
  await editInput("#plan-concierge-query", "Six pubs in Clapham tonight");
  await sortAgainFromTune();
  const count = source === "picker" ? 5 : 6;
  if (blocked === "localStorage") {
    expect(readPlanIntakeDraftWithMetadata(localStorage)).toEqual(oldLocal);
    expect(readPlanDraftEnvelope(sessionStorage)?.draft).toMatchObject({ requestedStopCount: count, requestedStopCountSource: source });
  } else {
    expect(readPlanDraftEnvelope(sessionStorage)).toEqual(oldSession);
    expect(readPlanIntakeDraftWithMetadata(localStorage)?.draft.answers).toMatchObject({ stopCount: count, stopCountSource: source });
    expect(document.body.textContent).toContain("description could not be saved");
  }
  advance(2000);
  await remountComposer();
  await openTune();
  expect(document.querySelector<HTMLSelectElement>("#plan-context-stops")?.value).toBe(String(count));
  await editInput("#plan-concierge-query", "Two pubs in Clapham tonight");
  await sortAgainFromTune();
  expect(reconciledGenerationContext().stopCount).toBe(source === "picker" ? 5 : 2);
});

it("retains in-memory picker origin and reports failure when both stores reject it", async () => {
  pinClock();
  await generateFromDescription("One pub in Clapham tonight");
  blockStorageWrites("localStorage");
  blockStorageWrites("sessionStorage");
  await openTune();
  await editTuneControl("stops", "5");
  await editInput("#plan-concierge-query", "Six pubs in Clapham tonight");
  expect(document.body.textContent).toContain("could not be saved");
  await sortAgainFromTune();
  expect(reconciledGenerationContext().stopCount).toBe(5);
  expect(readPlanDraftEnvelope(sessionStorage)?.draft).toMatchObject({ requestedStopCount: 1, requestedStopCountSource: "text" });
  expect(readPlanIntakeDraftWithMetadata(localStorage)?.draft.answers).toMatchObject({ stopCount: 1, stopCountSource: "text" });
});

it.each(["url", "session"] as const)("does not treat initial %s text as a picker event", async (channel) => {
  pinClock();
  if (channel === "url") window.history.replaceState({}, "", "/plan?describe=One%20pub%20in%20Clapham%20tonight");
  else sessionStorage.setItem(ASK_PLAN_DRAFT_STORAGE_KEY, JSON.stringify({ query: "One pub in Clapham tonight" }));
  await mountComposer();
  await editInput("#plan-describe-first-query", "Six pubs in Clapham tonight");
  expect(document.querySelector<HTMLButtonElement>("[aria-label='Number of pub stops'] [aria-pressed='true']")?.textContent).toBe("6");
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Plan it")!.click());
  await settle();
  expect(reconciledGenerationContext().stopCount).toBe(6);
  expect(readPlanDraftEnvelope(sessionStorage)?.draft).toMatchObject({ requestedStopCount: 6, requestedStopCountSource: "text" });
});

it.each(["v1", "v2"] as const)("retains explicit picker priority after %s-only recovery", async (format) => {
  const advance = pinClock();
  seedTuneRoute("map-generated");
  blockStorageWrites("localStorage");
  const storage = sessionStorage;
  const rejectedKey = format === "v1" ? PLAN_DRAFT_V2_KEY : PLAN_DRAFT_KEY;
  vi.stubGlobal("sessionStorage", {
    getItem: storage.getItem.bind(storage),
    setItem: (key: string, value: string) => {
      if (key === rejectedKey) throw new DOMException("Storage is full", "QuotaExceededError");
      storage.setItem(key, value);
    },
    removeItem: storage.removeItem.bind(storage), clear: storage.clear.bind(storage),
    key: storage.key.bind(storage), get length() { return storage.length; },
  } satisfies Storage);
  await mountComposer();
  await openTune();
  await editTuneControl("stops", "6");
  await editTuneControl("stops", "3");
  await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  await settle();
  advance(1000);
  await editInput("#plan-title", "Our next night");
  expect(readPlanDraftEnvelope(sessionStorage)?.draft).toMatchObject({
    title: "Our next night", requestedStopCount: 3, requestedStopCountSource: "picker",
  });
  expect(storage.getItem(rejectedKey)).toBeNull();
  expect(readPlanIntakeDraftWithMetadata(localStorage)).toBeNull();
  advance(2000);
  await remountComposer();
  await openTune();
  expect(document.querySelector<HTMLSelectElement>("#plan-context-stops")?.value).toBe("3");
  await editInput("#plan-concierge-query", "Five pubs in Clapham tonight");
  await sortAgainFromTune();
  expect(reconciledGenerationContext().stopCount).toBe(3);
  expect(readPlanDraftEnvelope(sessionStorage)?.draft).toMatchObject({
    requestedStopCount: 3, requestedStopCountSource: "picker",
    stops: [{ venueId: "venue-a", venueName: "Pub A" }],
  });
  await openTune();
  expect(document.querySelector<HTMLSelectElement>("#plan-context-stops")?.value).toBe("3");
});

it.each(["text", "picker"] as const)("recovers %s origin from session without intake", async (source) => {
  pinClock();
  await generateFromDescription("One pub in Clapham tonight");
  if (source === "picker") {
    await openTune();
    await editTuneControl("stops", "1");
  }
  localStorage.removeItem(PLAN_INTAKE_STORAGE_KEY);
  await remountComposer();
  await openTune();
  await editInput("#plan-concierge-query", "Six pubs in Clapham tonight");
  await sortAgainFromTune();
  expect(reconciledGenerationContext().stopCount).toBe(source === "picker" ? 1 : 6);
});

it.each([
  { sessionAge: 0, intakeAge: 1, source: "picker", expected: 1 },
  { sessionAge: 1, intakeAge: 0, source: "text", expected: 6 },
  { sessionAge: 0, intakeAge: 0, source: "text", expected: 6 },
])("restores count and origin together for save ages $sessionAge/$intakeAge", async ({ sessionAge, intakeAge, source, expected }) => {
  const advance = pinClock();
  await generateFromDescription("One pub in Clapham tonight");
  const session = readPlanDraftEnvelope(sessionStorage)!.draft;
  const intake = readPlanIntakeDraftWithMetadata(localStorage)!.draft;
  writePlanDraftEnvelope({ ...session, requestedStopCountSource: "text" }, "manual", sessionStorage, T0 + sessionAge);
  writePlanIntakeDraft({ ...intake, answers: { ...intake.answers, stopCountSource: "picker" } }, localStorage, T0 + intakeAge);
  advance(2);
  await remountComposer();
  await openTune();
  expect(document.querySelector<HTMLSelectElement>("#plan-context-stops")?.value).toBe("1");
  expect(readPlanDraftEnvelope(sessionStorage)?.draft.requestedStopCountSource).toBe(source);
  await editInput("#plan-concierge-query", "Six pubs in Clapham tonight");
  await sortAgainFromTune();
  expect(reconciledGenerationContext().stopCount).toBe(expected);
});

it.each(["unknown", "conflict", "legacy"] as const)("does not borrow local picker origin for a %s session request", async (mode) => {
  pinClock();
  await generateFromDescription("One pub in Clapham tonight");
  const session = readPlanDraftEnvelope(sessionStorage)!.draft;
  const intake = readPlanIntakeDraftWithMetadata(localStorage)!.draft;
  writePlanDraftEnvelope({ ...session, requestedStopCountSource: undefined }, "manual", sessionStorage, T0);
  writePlanIntakeDraft({ ...intake, answers: { ...intake.answers, stopCountSource: "picker" } }, localStorage, T0);
  if (mode !== "unknown") sessionStorage.setItem("pubmaxx:plan-draft:v1", JSON.stringify({ ...session, requestedStopCountSource: "picker" }));
  if (mode === "legacy") {
    sessionStorage.removeItem("pubmax:plan-draft:v2");
    localStorage.removeItem(PLAN_ROUTE_DRAFT_KEY);
    localStorage.removeItem(PLAN_ROUTE_DRAFT_V2_KEY);
  }
  await remountComposer();
  if (mode !== "legacy") await openTune();
  expect(document.querySelector<HTMLSelectElement>("#plan-context-stops")?.value).toBe("1");
  await editInput("#plan-concierge-query", "Six pubs in Clapham tonight");
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent === (mode === "legacy" ? "Make a plan" : "Plan it again"))!.click());
  await settle();
  expect(reconciledGenerationContext().stopCount).toBe(6);
  expect(readPlanDraftEnvelope(sessionStorage)?.draft.requestedStopCountSource).toBe("text");
});

it.each([undefined, "unknown", "Picker", 1, {}, null])("keeps invalid or missing source unprivileged after reload: %s", async (source) => {
  pinClock();
  await generateFromDescription("One pub in Clapham tonight");
  for (const key of ["pubmaxx:plan-draft:v1", "pubmax:plan-draft:v2"]) {
    const record = JSON.parse(sessionStorage.getItem(key)!);
    const draft = key.endsWith("v2") ? record.draft : record;
    draft.requestedStopCountSource = source;
    sessionStorage.setItem(key, JSON.stringify(record));
  }
  const intake = JSON.parse(localStorage.getItem(PLAN_INTAKE_STORAGE_KEY)!);
  intake.draft.answers.stopCountSource = source;
  localStorage.setItem(PLAN_INTAKE_STORAGE_KEY, JSON.stringify(intake));
  await remountComposer();
  expect(document.querySelector(".planStop__name")?.textContent).toBe("Pub A");
  await openTune();
  await editInput("#plan-concierge-query", "Six pubs in Clapham tonight");
  await sortAgainFromTune();
  expect(reconciledGenerationContext().stopCount).toBe(6);
});

it("keeps deliberate add and remove counts distinct from picker events after reload", async () => {
  pinClock();
  await generateFromDescription("One pub in Clapham tonight");
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Add another stop")!.click());
  await settle();
  expect(readPlanDraftEnvelope(sessionStorage)?.draft).toMatchObject({ requestedStopCount: 2, requestedStopCountSource: "route-edit" });
  await remountComposer();
  await openTune();
  await sortAgainFromTune();
  expect(reconciledGenerationContext().stopCount).toBe(2);
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Add another stop")!.click());
  await settle();
  await act(async () => document.querySelector<HTMLButtonElement>("[aria-label='Remove stop 2']")!.click());
  await settle();
  expect(readPlanDraftEnvelope(sessionStorage)?.draft).toMatchObject({ requestedStopCount: 1, requestedStopCountSource: "route-edit" });
  await remountComposer();
  await openTune();
  await sortAgainFromTune();
  expect(reconciledGenerationContext().stopCount).toBe(1);
});


function generatedProofFixture(stopCount: 1 | 3 = 1) {
  const payload = btoa(JSON.stringify({ v: 1, expiresAt: T0 + 3_600_000 }));
  return {
    ...GENERATED,
    stops: stopCount === 1 ? GENERATED.stops : [
      { venueId: "venue-a", venueName: "Pub A" },
      { venueId: "venue-b", venueName: "Pub B" },
      { venueId: "venue-c", venueName: "Pub C" },
    ],
    inferredContext: { ...GENERATED.inferredContext, stopCount },
    groundingProof: `${payload}.test-only-signature`, operationKey: "proof-operation",
    outcome: "unanchored", anchorVenueId: null, anchorSource: null,
  };
}

it.each([
  {selector:"#plan-title", value:"Our next night"},
  {selector:"#plan-name", value:"Sam"},
])("retains the generated route after a request-only $selector edit and reload", async ({selector,value}) => {
  const advance = pinClock();
  const generated = generatedProofFixture();
  fetchMock.mockImplementation(async (input) => new Response(JSON.stringify(String(input).includes("/api/plans/generate") ? generated : []), {status:200,headers:{"content-type":"application/json"}}));
  await generateFromDescription();
  await editInput("#plan-name", "Captain");
  const originalRoute = localStorage.getItem(PLAN_ROUTE_DRAFT_KEY);
  advance(1000);
  await editInput(selector, value);
  expect(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)).toBe(originalRoute);
  expect(readPlanDraftEnvelope(sessionStorage)).toMatchObject({
    savedAt: "2026-11-03T12:00:01.000Z",
    draft: { routeReference: { savedAt: "2026-11-03T12:00:00.000Z", operationKey: "proof-operation" } },
  });
  expect(document.body.textContent).not.toContain("could not be saved");
  advance(2000);
  await remountComposer();
  expect(document.querySelector("#plan-lock-hint")?.textContent ?? "").not.toContain("Refresh the route");
  expect(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)).toBe(originalRoute);
  expect(await saveRoute()).toMatchObject({ groundingProof: generated.groundingProof, context: generated.inferredContext });
});

it("prevents locking the prior three-stop route after confirming a new one-pub session Ask", async () => {
  const advance = pinClock();
  const generated = generatedProofFixture(3);
  fetchMock.mockImplementation(async (input) => new Response(JSON.stringify(String(input).includes("/api/plans/generate") ? generated : []), {status:200,headers:{"content-type":"application/json"}}));
  await generateFromDescription();
  await editInput("#plan-name", "Captain");
  sessionStorage.setItem(ASK_PLAN_DRAFT_STORAGE_KEY, JSON.stringify({query:"One pub in Clapham tonight"}));
  advance(1000);
  await remountComposer();
  expect(readPlanDraftEnvelope(sessionStorage)?.draft.requestedStopCount).toBe(1);
  await act(async () => document.querySelector<HTMLFormElement>("#plan-composer")!.requestSubmit());
  const writes = fetchMock.mock.calls.filter(([input]) => String(input) === "/api/plans");
  expect(writes).toHaveLength(0);
  expect(document.querySelector("#plan-lock-hint")?.textContent).toContain("Refresh the route");
});

async function generateProofRoute(stopCount: 1 | 3 = 1): Promise<ReturnType<typeof generatedProofFixture>> {
  const generated = generatedProofFixture(stopCount);
  fetchMock.mockImplementation(async (input) => new Response(JSON.stringify(
    String(input).includes("/api/plans/generate") ? generated : [],
  ), { status: 200, headers: { "content-type": "application/json" } }));
  await generateFromDescription();
  await editInput("#plan-name", "Captain");
  return generated;
}

function expectNoRouteSave(): void {
  expect(fetchMock.mock.calls.filter(([input]) => String(input) === "/api/plans")).toHaveLength(0);
}

async function attemptRouteSave(): Promise<void> {
  await act(async () => { document.querySelector<HTMLFormElement>("#plan-composer")!.requestSubmit(); });
  expectNoRouteSave();
}

function lockButton(): HTMLButtonElement {
  return [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent === "Lock it in")!;
}

// The accepted preview contract separates saved candidates from permission to lock.
// A later exact-time edit must preserve the candidates' date without a false warning.
it.each(["saved", "rejected", "discarded"] as const)(
  "reports stale preview persistence after an exact-time edit when route writes are %s",
  async (mode) => {
    const advance = pinClock();
    await generateProofRoute(3);
    await editInput("#plan-time", "2026-11-03T20:00");
    await openTune();
    advance(1000);
    await sortAgainFromTune();
    expect(lockButton().getAttribute("aria-disabled")).toBeNull();
    const accepted = JSON.parse(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)!);
    expect(accepted).toMatchObject({
      savedAt: "2026-11-03T12:00:01.000Z", routeStale: false,
      groundingProof: generatedProofFixture(3).groundingProof, createOperationKey: "proof-operation",
    });
    const local = localStorage;
    const keys = [PLAN_ROUTE_DRAFT_KEY, PLAN_ROUTE_DRAFT_V2_KEY];
    if (mode === "rejected") rejectRouteWrites(keys);
    if (mode === "discarded") vi.stubGlobal("localStorage", {
      getItem: local.getItem.bind(local),
      setItem: (key: string, value: string) => { if (!keys.includes(key)) local.setItem(key, value); },
      removeItem: local.removeItem.bind(local), clear: local.clear.bind(local),
      key: local.key.bind(local), get length() { return local.length; },
    } satisfies Storage);
    advance(2000);
    await editInput("#plan-time", "2026-11-03T21:00");
    expect(lockButton().getAttribute("aria-disabled")).toBe("true");
    expect(readPlanDraftEnvelope(sessionStorage)).toMatchObject({
      savedAt: "2026-11-03T12:00:02.000Z", draft: { startTime: "2026-11-03T21:00", routeReference: null },
    });
    expect(JSON.parse(sessionStorage.getItem(PLAN_DRAFT_KEY)!))
      .toMatchObject({ creatorName: "Captain", startTime: "2026-11-03T21:00", routeReference: null });
    expect(JSON.parse(sessionStorage.getItem(PLAN_DRAFT_V2_KEY)!).draft)
      .toMatchObject({ creatorName: "Captain", startTime: "2026-11-03T21:00", routeReference: null });
    expect(readPlanIntakeDraftWithMetadata()?.savedAt).toBe("2026-11-03T12:00:02.000Z");
    const preview = JSON.parse(local.getItem(PLAN_ROUTE_DRAFT_KEY)!);
    expect(preview).toEqual({ ...accepted, routeStale: mode === "saved" });
    const warning = "route details, checks and starting pub could not be saved";
    if (mode === "saved") expect.soft(document.body.textContent).not.toContain("could not be saved");
    else expect.soft(document.body.textContent).toContain(warning);
    await attemptRouteSave();
    advance(3000);
    await remountComposer();
    expect(document.querySelector<HTMLInputElement>("#plan-name")?.value).toBe("Captain");
    expect(document.querySelector<HTMLInputElement>("#plan-time")?.value).toBe("2026-11-03T21:00");
    expect([...document.querySelectorAll(".planStop__name")].map((node) => node.textContent))
      .toEqual(["Pub A", "Pub B", "Pub C"]);
    expect(lockButton().getAttribute("aria-disabled")).toBe("true");
    expect(readPlanDraftEnvelope(sessionStorage)?.draft.routeReference).toBeNull();
    if (mode === "saved") {
      expect(document.body.textContent).not.toContain("could not be saved");
      expect(JSON.parse(local.getItem(PLAN_ROUTE_DRAFT_KEY)!)).toMatchObject({
        savedAt: accepted.savedAt, routeStale: true, groundingProof: null, createOperationKey: null,
      });
    }
    await attemptRouteSave();
  },
);

it.each(["both", "session-only", "local-only", "intake-only", "neither"] as const)(
  "reports request persistence independently of its retained route: %s", async (available) => {
    const advance = pinClock();
    const generated = await generateProofRoute();
    const originalRoute = localStorage.getItem(PLAN_ROUTE_DRAFT_KEY);
    const session = available === "local-only" || available === "intake-only" || available === "neither"
      ? blockStorageWrites("sessionStorage") : sessionStorage;
    const local = available === "session-only" || available === "neither" ? blockStorageWrites("localStorage")
      : available === "intake-only" ? rejectRouteWrites([PLAN_ROUTE_DRAFT_KEY, PLAN_ROUTE_DRAFT_V2_KEY]) : localStorage;
    advance(1000);
    await editInput("#plan-title", "Our next night");
    expect(local.getItem(PLAN_ROUTE_DRAFT_KEY)).toBe(originalRoute);
    if (available === "both" || available === "local-only" || available === "intake-only") {
      expect(readPlanIntakeDraftWithMetadata(local)).toMatchObject({
        savedAt: "2026-11-03T12:00:01.000Z",
        routeReference: { savedAt: "2026-11-03T12:00:00.000Z", operationKey: "proof-operation" },
      });
    }
    expect(readPlanDraftEnvelope(session)?.draft.title).toBe(available === "both" || available === "session-only" ? "Our next night" : "Tonight, sorted");
    if (available === "both" || available === "session-only") {
      expect(document.body.textContent).not.toContain("could not be saved");
    } else {
      expect(document.body.textContent).toContain("could not be saved");
    }
    advance(2000);
    await remountComposer();
    expect(document.querySelector(".planStop__name")?.textContent).toBe("Pub A");
    expect((await saveRoute()).groundingProof).toBe(generated.groundingProof);
  },
);

it.each([false, true])("does not attach a same-ID older route after a failed new route save, session blocked: %s", async (sessionBlocked) => {
  const advance = pinClock();
  await generateProofRoute();
  const oldRoute = localStorage.getItem(PLAN_ROUTE_DRAFT_KEY);
  const local = rejectRouteWrites([PLAN_ROUTE_DRAFT_KEY, PLAN_ROUTE_DRAFT_V2_KEY]);
  if (sessionBlocked) blockStorageWrites("sessionStorage");
  advance(1000);
  await openTune();
  const replacement = {
    ...generatedProofFixture(), operationKey: "replacement-operation",
    inferredContext: { ...GENERATED.inferredContext, transportConstraints: ["walking"] },
  };
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(replacement), { status: 200, headers: { "content-type": "application/json" } }));
  await sortAgainFromTune();
  expect(local.getItem(PLAN_ROUTE_DRAFT_KEY)).toBe(oldRoute);
  expect(document.body.textContent).toContain("could not be saved");
  if (!sessionBlocked) expect(readPlanDraftEnvelope(sessionStorage)?.draft.routeReference).toBeUndefined();
  advance(2000);
  await remountComposer();
  expect(document.querySelector(".planStop__name")?.textContent).toBe("Pub A");
  await editInput("#plan-time", START);
  expect(document.querySelector("#plan-lock-hint")?.textContent).toContain("Refresh the route");
  await attemptRouteSave();
});

it.each(["v1", "v2", "local-blocked"] as const)(
  "retains the complete session-only request across reloads: %s",
  async (format) => {
    const advance = pinClock();
    seedReadableBlankHostRequest();
    localStorage.clear();
    blockStorageWrites("localStorage");
    await mountComposer();
    advance(1000);
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Make a plan")!.click());
    await settle();
    const saved = readPlanDraftEnvelope(sessionStorage)!;
    expect(saved.draft.requestIntake).toMatchObject({ answers: { stopCount: 3, groupSize: 6,
      area: "clapham", timeWindow: "evening", exactStartIso: "2026-11-03T19:00:00.000Z",
      budget: "value", budgetLimitPence: 3500, accessibilityNeeds: ["step-free"] } });
    expect(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)).toBeNull();
    if (format === "v1") sessionStorage.removeItem(PLAN_DRAFT_V2_KEY);
    if (format !== "local-blocked") vi.unstubAllGlobals();
    vi.stubGlobal("fetch", fetchMock);
    for (const offset of [2000, 3000]) {
      advance(offset);
      await remountComposer();
      expect(readPlanDraftEnvelope(sessionStorage)?.draft.requestIntake).toEqual(saved.draft.requestIntake);
      expect([...document.querySelectorAll(".planStop__name")].map((node) => node.textContent)).toEqual(["Pub A"]);
    }
    const generationCount = fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/plans/generate")).length;
    expect(document.querySelector<HTMLSelectElement>("#plan-context-stops")?.value).toBe("3");
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Make a plan")!.click());
    await settle();
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/plans/generate"))).toHaveLength(generationCount + 1);
    expect(reconciledGenerationContext()).toMatchObject({ stopCount: 3, groupSize: 6,
      accessibility: ["step-free"], nightArea: "clapham", daypart: "evening",
      budget: "value", budgetLimitPence: 3500, zeroProof: false });
  },
);

it("assigns a new reference to a successful same-ID generation without redating unchanged copies", async () => {
  const advance = pinClock();
  await generateProofRoute();
  await openTune();
  advance(1000);
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ ...generatedProofFixture(), operationKey: "replacement-operation" }), { status: 200, headers: { "content-type": "application/json" } }));
  await sortAgainFromTune();
  const route = localStorage.getItem(PLAN_ROUTE_DRAFT_KEY);
  const writerDate = JSON.parse(route!).savedAt;
  expect(Date.parse(writerDate)).toBeGreaterThan(T0);
  expect(readPlanDraftEnvelope(sessionStorage)?.draft.routeReference).toEqual({ savedAt: writerDate, operationKey: "replacement-operation" });
  advance(2000);
  await remountComposer();
  advance(3000);
  await remountComposer();
  expect(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)).toBe(route);
  expect((await saveRoute()).groundingProof).toBe(generatedProofFixture().groundingProof);
});

it.each([false, true])("keeps six requested stops through untouched reloads with a saved anchor: %s", async (anchored) => {
  const advance = pinClock();
  const intake = skipRemainingPlanIntake(createPlanIntakeDraft());
  expect(writePlanIntakeDraft({ ...intake, answers: { ...intake.answers, stopCount: 6 } }, localStorage, T0)).toBe(true);
  const request = {
    title: "Night", creatorName: "Captain", startTime: START, conciergeQuery: "Clapham tonight",
    requestedStopCount: 6, stops: [{ key: 1, venueId: "venue-a", venueName: "Pub A" }],
    ...(anchored ? { acceptedAnchor: {
      venueId: "venue-a", source: "near", cityId: "london", acceptedArea: null, startsAt: null,
      expiresAt: new Date(T0 + 60_000).toISOString(),
    } } : {}),
  };
  const sessionBytes = JSON.stringify(request);
  sessionStorage.setItem(PLAN_DRAFT_KEY, sessionBytes);
  const intakeBytes = localStorage.getItem(PLAN_INTAKE_STORAGE_KEY);
  expect(readPlanDraftEnvelope(sessionStorage)).toMatchObject({ legacy: true, savedAt: null });
  expect(readPlanningIntent({ storage: sessionStorage })).toBeNull();
  expect(readPlanIntakeDraftWithMetadata(localStorage)?.draft.answers.stopCount).toBe(6);

  advance(1000);
  await mountComposer();
  for (const offset of [2000, 3000]) {
    if (!document.querySelector("#plan-context-stops")) await openTune();
    expect.soft(document.querySelector<HTMLSelectElement>("#plan-context-stops")?.value).toBe("6");
    expect.soft(document.querySelector(".planStop__name")?.textContent).toBe("Pub A");
    expect.soft(Boolean(document.querySelector("[aria-label='Accepted plan context']"))).toBe(anchored);
    expect.soft(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)).toBeNull();
    expect.soft(localStorage.getItem(PLAN_ROUTE_DRAFT_V2_KEY)).toBeNull();
    expect.soft(localStorage.getItem(PLAN_INTAKE_STORAGE_KEY)).toBe(intakeBytes);
    expect.soft(sessionStorage.getItem(PLAN_DRAFT_KEY)).toBe(sessionBytes);
    expect.soft(sessionStorage.getItem(PLAN_DRAFT_V2_KEY)).toBeNull();
    advance(offset);
    await remountComposer();
  }

  await editInput("#plan-title", "Our next night");
  expect(readPlanDraftEnvelope(sessionStorage)).toMatchObject({
    legacy: false,
    savedAt: "2026-11-03T12:00:03.000Z",
    draft: { title: "Our next night", requestedStopCount: 6 },
  });
});

it.each([
  { acceptedOffset: 1000, intakeOffset: 0 },
  { acceptedOffset: 0, intakeOffset: 1000 },
])("preserves acceptance and intake dates ($acceptedOffset / $intakeOffset) until a real edit", async ({
  acceptedOffset, intakeOffset,
}) => {
  const advance = pinClock();
  const generated = {
    ...generatedProofFixture(), grounded: true, outcome: "anchor-only",
    anchored: true, anchorVenueId: "venue-a", anchorSource: "near",
  };
  fetchMock.mockImplementation(async (input) => Response.json(String(input).includes("/api/plans/generate")
    ? generated : [{ id: "venue-a", name: "Pub A" }]));
  const intake = skipRemainingPlanIntake(createPlanIntakeDraft());
  expect(writePlanIntakeDraft({ ...intake, answers: { ...intake.answers, stopCount: 6 } },
    localStorage, T0 + intakeOffset)).toBe(true);
  const initialIntakeBytes = localStorage.getItem(PLAN_INTAKE_STORAGE_KEY);
  advance(acceptedOffset);
  const accepted = writePlanningIntent({
    source: "near", cityId: "london", acceptedVenueId: "venue-a", acceptedArea: null, startsAt: null,
    displayEvidence: { kind: "directory", observedAt: null },
  }, { storage: sessionStorage, now: T0 + acceptedOffset });
  expect(accepted).not.toBeNull();

  advance(2000);
  await mountComposer();
  expect(readPlanningIntent({ storage: sessionStorage })).toEqual(accepted);
  expect(document.querySelector("[aria-label='Accepted plan context']")?.textContent).toContain("Pub A");
  expect(readPlanDraftEnvelope(sessionStorage)?.draft.acceptedAnchor)
    .toMatchObject({ venueId: "venue-a", source: "near", cityId: "london" });
  expect(readPlanDraftEnvelope(sessionStorage)).toMatchObject({
    savedAt: "2026-11-03T12:00:01.000Z", draft: { requestedStopCount: 6 },
  });
  expect(readPlanIntakeDraftWithMetadata(localStorage)).toMatchObject({
    savedAt: new Date(T0 + intakeOffset).toISOString(),
    expiresAt: new Date(T0 + intakeOffset + 24 * 60 * 60 * 1000).toISOString(),
    draft: { answers: { stopCount: 6 } },
  });
  expect(localStorage.getItem(PLAN_INTAKE_STORAGE_KEY)).toBe(initialIntakeBytes);
  const sessionV1 = sessionStorage.getItem(PLAN_DRAFT_KEY);
  const sessionV2 = sessionStorage.getItem(PLAN_DRAFT_V2_KEY);
  const intakeBytes = localStorage.getItem(PLAN_INTAKE_STORAGE_KEY);
  expect(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)).toBeNull();

  advance(3000);
  await remountComposer();
  expect(readPlanningIntent({ storage: sessionStorage })).toEqual(accepted);
  expect(document.querySelector("[aria-label='Accepted plan context']")?.textContent).toContain("Pub A");
  expect(document.querySelector<HTMLSelectElement>("#plan-context-stops")?.value).toBe("6");
  expect(sessionStorage.getItem(PLAN_DRAFT_KEY)).toBe(sessionV1);
  expect(sessionStorage.getItem(PLAN_DRAFT_V2_KEY)).toBe(sessionV2);
  expect(localStorage.getItem(PLAN_INTAKE_STORAGE_KEY)).toBe(intakeBytes);
  expect(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)).toBeNull();
  expect(localStorage.getItem(PLAN_ROUTE_DRAFT_V2_KEY)).toBeNull();

  advance(4000);
  const query = "One pub in Clapham tonight";
  await editInput("#plan-concierge-query", query);
  expect(readPlanDraftEnvelope(sessionStorage)).toMatchObject({
    savedAt: "2026-11-03T12:00:04.000Z", draft: { conciergeQuery: query },
  });
  expect(readPlanIntakeDraftWithMetadata(localStorage)?.savedAt).toBe("2026-11-03T12:00:04.000Z");
  const makePlan = [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent === "Make a plan")!;
  await act(async () => { makePlan.click(); });
  await settle();
  const posts = fetchMock.mock.calls.filter(([input]) => String(input) === "/api/plans/generate");
  expect(posts).toHaveLength(1);
  expect(JSON.parse(String(posts[0]?.[1]?.body))).toMatchObject({
    query, cityId: "london", anchor: { venueId: "venue-a", source: "near" },
  });
  expect(readPlanDraftEnvelope(sessionStorage)?.draft.routeReference).toEqual({
    savedAt: "2026-11-03T12:00:04.000Z", operationKey: generated.operationKey,
  });
  expect(JSON.parse(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)!)).toMatchObject({
    savedAt: "2026-11-03T12:00:04.000Z", groundingProof: generated.groundingProof, routeStale: false,
  });
});

it.each(["expired", "invalid", "read refused"] as const)(
  "persists a fresh acceptance without writing shared storage when intake is %s",
  async (condition) => {
    const advance = pinClock();
    const local = localStorage;
    const completed = skipRemainingPlanIntake(createPlanIntakeDraft());
    const originalIntake = { ...completed, answers: { ...completed.answers, stopCount: 6 as const } };
    if (condition === "invalid") local.setItem(PLAN_INTAKE_STORAGE_KEY, "invalid");
    else expect(writePlanIntakeDraft(originalIntake, local,
      condition === "expired" ? T0 - 24 * 60 * 60 * 1000 : T0)).toBe(true);
    const originalBytes = local.getItem(PLAN_INTAKE_STORAGE_KEY);
    const writes: string[] = [];
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => {
        if (condition === "read refused" && key === PLAN_INTAKE_STORAGE_KEY) throw new Error("Storage read refused");
        return local.getItem(key);
      },
      setItem: (key: string, value: string) => { writes.push(key); local.setItem(key, value); },
      removeItem: local.removeItem.bind(local), clear: local.clear.bind(local),
      key: local.key.bind(local), get length() { return local.length; },
    } satisfies Storage);
    const accepted = writePlanningIntent({
      source: "near", cityId: "london", acceptedVenueId: "venue-a", acceptedArea: null, startsAt: null,
      displayEvidence: { kind: "directory", observedAt: null },
    }, { storage: sessionStorage, now: T0 });
    expect(accepted).not.toBeNull();
    fetchMock.mockImplementation(async () => Response.json([{ id: "venue-a", name: "Pub A" }]));
    advance(1000);
    await mountComposer();
    expect(readPlanDraftEnvelope(sessionStorage)).toMatchObject({
      savedAt: accepted?.acceptedAt, draft: { acceptedAnchor: { venueId: "venue-a", expiresAt: accepted?.expiresAt } },
    });
    expect(document.querySelector("[aria-label='Accepted plan context']")?.textContent).toContain("Pub A");
    expect(writes).not.toContain(PLAN_INTAKE_STORAGE_KEY);
    expect(writes).not.toContain(PLAN_ROUTE_DRAFT_KEY);
    expect(writes).not.toContain(PLAN_ROUTE_DRAFT_V2_KEY);
    expect(local.getItem(PLAN_INTAKE_STORAGE_KEY)).toBe(condition === "read refused" ? originalBytes : null);
  },
);

it("keeps a newer shared intake when a held pub name arrives late", async () => {
  const advance = pinClock();
  const initial = skipRemainingPlanIntake(createPlanIntakeDraft());
  const six = { ...initial, answers: { ...initial.answers, stopCount: 6 as const } };
  expect(writePlanIntakeDraft(six, localStorage, T0)).toBe(true);
  expect(writePlanningIntent({
    source: "near", cityId: "london", acceptedVenueId: "venue-a", acceptedArea: null, startsAt: null,
    displayEvidence: { kind: "directory", observedAt: null },
  }, { storage: sessionStorage, now: T0 })).not.toBeNull();
  const venueIndex = Promise.withResolvers<Response>();
  fetchMock.mockImplementation(async () => venueIndex.promise);
  await mountComposer();
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes("venues_slim"))).toBe(true);
  expect(document.querySelector<HTMLSelectElement>("#plan-context-stops")?.value).toBe("6");
  const initialSession = sessionStorage.getItem(PLAN_DRAFT_V2_KEY);
  expect(initialSession).not.toBeNull();

  advance(1000);
  const five = { ...initial, answers: { ...initial.answers, stopCount: 5 as const, stopCountSource: "picker" as const } };
  expect(writePlanIntakeDraft(five, localStorage, T0 + 1000)).toBe(true);
  const otherTab = localStorage.getItem(PLAN_INTAKE_STORAGE_KEY);
  advance(2000);
  await act(async () => { venueIndex.resolve(Response.json([{ id: "venue-a", name: "Pub A" }])); });
  await settle();
  expect(document.querySelector("[aria-label='Accepted plan context']")?.textContent).toContain("Pub A");
  expect(localStorage.getItem(PLAN_INTAKE_STORAGE_KEY)).toBe(otherTab);
  expect(sessionStorage.getItem(PLAN_DRAFT_V2_KEY)).toBe(initialSession);

  advance(3000);
  await editTuneControl("stops", "4");
  expect(readPlanIntakeDraftWithMetadata(localStorage)).toMatchObject({
    savedAt: "2026-11-03T12:00:03.000Z", draft: { answers: { stopCount: 4, stopCountSource: "picker" } },
  });
  await remountComposer();
  expect(document.querySelector<HTMLSelectElement>("#plan-context-stops")?.value).toBe("4");
});

it.each([
  { edit: "reorder", names: ["Pub A", "Pub C", "Pub B"] },
  { edit: "remove", names: ["Pub A", "Pub C"] },
] as const)("saves the ordered route after a middle-stop $edit", async ({ edit, names }) => {
  const advance = pinClock();
  const generated = await generateProofRoute(3);
  advance(1000);
  if (edit === "reorder") {
    const middle = [...document.querySelectorAll<HTMLElement>(".planStop__open")][1]!;
    await act(async () => {
      middle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true, cancelable: true }));
    });
  } else {
    const remove = document.querySelector<HTMLButtonElement>("[aria-label='Remove stop 2']")!;
    await act(async () => { remove.click(); });
  }
  await settle();
  const displayedStops = () => [...document.querySelectorAll(".planStop__name")].map((node) => node.textContent);
  expect(displayedStops()).toEqual(names);
  const savedAt = "2026-11-03T12:00:01.000Z";
  const stored = JSON.parse(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)!);
  const reference = readPlanDraftEnvelope(sessionStorage)?.draft.routeReference;
  if (edit === "reorder") {
    expect(stored).toMatchObject({
      savedAt, routeStale: false, groundingProof: generated.groundingProof, createOperationKey: generated.operationKey,
    });
    expect(reference).toEqual({ savedAt, operationKey: generated.operationKey });
    expect(lockButton().getAttribute("aria-disabled")).toBeNull();
  } else {
    expect(stored).toMatchObject({ savedAt, routeStale: true, groundingProof: null, createOperationKey: null });
    expect(reference).toBeNull();
    expect(lockButton().getAttribute("aria-disabled")).toBe("true");
  }
  expect(document.body.textContent).not.toContain("could not be saved");
  advance(2000);
  await remountComposer();
  expect(displayedStops()).toEqual(names);
  expect(document.body.textContent).not.toContain("could not be saved");
  if (edit === "reorder") {
    expect(lockButton().getAttribute("aria-disabled")).toBeNull();
    expect(await saveRoute()).toMatchObject({
      groundingProof: generated.groundingProof,
      stops: [{ venueId: "venue-a" }, { venueId: "venue-c" }, { venueId: "venue-b" }],
    });
    const creation = fetchMock.mock.calls.find(([input]) => String(input) === "/api/plans");
    expect(new Headers(creation?.[1]?.headers).get("idempotency-key")).toBe(generated.operationKey);
  } else {
    expect(document.querySelector("#plan-lock-hint")?.textContent).toContain("Refresh the route");
    await attemptRouteSave();
  }
});

it.each(["cleared", "V2 read refused", "equal-time pair changed"] as const)(
  "does not copy a stale preview if its current local authority was %s",
  async (condition) => {
    const advance = pinClock();
    const local = localStorage;
    expect(transferGeneratedRouteToDraft(generatedProofFixture(), local, "plan-generated", T0)).toBe(true);
    const expected = {
      v1: local.getItem(PLAN_ROUTE_DRAFT_KEY),
      v2: local.getItem(PLAN_ROUTE_DRAFT_V2_KEY),
    };
    expect(writePlanDraftEnvelope({
      title: "Session night", creatorName: "Captain", startTime: START, conciergeQuery: "One pub in Clapham tonight",
      stops: [{ key: 1, venueId: "venue-b", venueName: "Pub B" }],
      requestedStopCount: 1, routeReference: null,
    }, "manual", sessionStorage, T0 + 1000)).toMatchObject({ v1: true, v2: true });
    let pairs = 0;
    let interrupted = false;
    const routeWrites: string[] = [];
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => {
        if (key === PLAN_ROUTE_DRAFT_KEY && ++pairs === 2) {
          if (condition === "cleared") {
            clearPersistedPlanDrafts({ routeDraft: local });
            interrupted = true;
          }
          if (condition === "equal-time pair changed") {
            interrupted = transferGeneratedRouteToDraft({
              ...generatedProofFixture(), operationKey: "equal-time-replacement",
              stops: [{ venueId: "venue-c", venueName: "Pub C" }],
            }, local, "plan-generated", T0 + 1000);
          }
          expected.v1 = local.getItem(PLAN_ROUTE_DRAFT_KEY);
          expected.v2 = local.getItem(PLAN_ROUTE_DRAFT_V2_KEY);
        }
        if (key === PLAN_ROUTE_DRAFT_V2_KEY && pairs === 2 && condition === "V2 read refused") {
          interrupted = true;
          throw new Error("Storage read refused");
        }
        return local.getItem(key);
      },
      setItem: (key: string, value: string) => {
        if (key === PLAN_ROUTE_DRAFT_KEY || key === PLAN_ROUTE_DRAFT_V2_KEY) routeWrites.push(key);
        local.setItem(key, value);
      },
      removeItem: local.removeItem.bind(local), clear: local.clear.bind(local),
      key: local.key.bind(local), get length() { return local.length; },
    } satisfies Storage);

    advance(2000);
    await mountComposer();
    expect(interrupted).toBe(true);
    expect(document.querySelector(".planStop__name")?.textContent).toBe("Pub B");
    expect(document.querySelector("#plan-route-stale-title")?.textContent).toBe("This route needs a refresh");
    expect(routeWrites).toEqual([]);
    expect(local.getItem(PLAN_ROUTE_DRAFT_KEY)).toBe(expected.v1);
    expect(local.getItem(PLAN_ROUTE_DRAFT_V2_KEY)).toBe(expected.v2);
    if (condition === "cleared") expect(expected).toEqual({ v1: null, v2: null });
    if (condition === "equal-time pair changed") {
      expect(reconcilePlanRouteDrafts(expected.v2, expected.v1, T0 + 2000)).toMatchObject({
        conflicting: false, ambiguous: false,
        envelope: { savedAt: "2026-11-03T12:00:01.000Z", value: { operationKey: "equal-time-replacement" } },
      });
    }

    await openTune();
    advance(3000);
    await sortAgainFromTune();
    expect(routeWrites).toContain(PLAN_ROUTE_DRAFT_KEY);
    expect(JSON.parse(local.getItem(PLAN_ROUTE_DRAFT_KEY)!)).toMatchObject({
      savedAt: "2026-11-03T12:00:03.000Z", routeStale: false, groundingProof: GENERATED.groundingProof,
    });
  },
);

it("does not claim the stops survived when a newer valid route wins the next reload", async () => {
  const advance = pinClock();
  await generateProofRoute(3);
  const local = localStorage;
  const competing = {
    ...generatedProofFixture(3), operationKey: "competing-operation",
    stops: [
      { venueId: "venue-d", venueName: "Pub D" },
      { venueId: "venue-e", venueName: "Pub E" },
      { venueId: "venue-f", venueName: "Pub F" },
    ],
  };
  let replacementWritten = false;
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => {
      if (key === PLAN_ROUTE_DRAFT_KEY && !replacementWritten) {
        advance(2000);
        replacementWritten = transferGeneratedRouteToDraft(competing, local, "plan-generated", T0 + 2000);
      }
      return local.getItem(key);
    },
    setItem: local.setItem.bind(local), removeItem: local.removeItem.bind(local),
    clear: local.clear.bind(local), key: local.key.bind(local), get length() { return local.length; },
  } satisfies Storage);

  advance(1000);
  await editInput("#plan-title", "Our edited night");
  expect(replacementWritten).toBe(true);
  const oldStops = [{ venueId: "venue-a" }, { venueId: "venue-b" }, { venueId: "venue-c" }];
  expect(JSON.parse(sessionStorage.getItem(PLAN_DRAFT_KEY)!)).toMatchObject({ title: "Our edited night", stops: oldStops });
  expect(readPlanDraftEnvelope(sessionStorage)).toMatchObject({
    legacy: false, savedAt: "2026-11-03T12:00:01.000Z", draft: { title: "Our edited night", stops: oldStops },
  });
  expect(document.body.textContent).toContain("Your route could not be saved");
  expect(document.body.textContent).not.toContain("Your stops were saved");
  const originalV1 = local.getItem(PLAN_ROUTE_DRAFT_KEY);
  const originalV2 = local.getItem(PLAN_ROUTE_DRAFT_V2_KEY);

  advance(3000);
  await remountComposer();
  expect([...document.querySelectorAll(".planStop__name")].map((node) => node.textContent)).toEqual(["Pub D", "Pub E", "Pub F"]);
  expect(local.getItem(PLAN_ROUTE_DRAFT_KEY)).toBe(originalV1);
  expect(local.getItem(PLAN_ROUTE_DRAFT_V2_KEY)).toBe(originalV2);
});

it.each([
  { format: "equal-time", sessionWins: false, sameStops: false },
  { format: "undated V1", sessionWins: false, sameStops: false },
  { format: "equal-time", sessionWins: true, sameStops: false },
  { format: "equal-time", sessionWins: true, sameStops: true },
])("respects $format local ambiguity with Session winner $sessionWins and same stops $sameStops", async ({
  format, sessionWins, sameStops,
}) => {
  const advance = pinClock();
  const generated = generatedProofFixture();
  expect(transferGeneratedRouteToDraft(generated, localStorage, "plan-generated", T0)).toBe(true);
  const originalV2 = localStorage.getItem(PLAN_ROUTE_DRAFT_V2_KEY)!;
  expect(transferGeneratedRouteToDraft({ ...generated, operationKey: "conflicting-operation" },
    localStorage, "plan-generated", T0)).toBe(true);
  localStorage.setItem(PLAN_ROUTE_DRAFT_V2_KEY, originalV2);
  if (format === "undated V1") {
    const v1 = JSON.parse(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)!);
    delete v1.savedAt;
    localStorage.setItem(PLAN_ROUTE_DRAFT_KEY, JSON.stringify(v1));
  }
  const originalV1 = localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)!;
  expect(reconcilePlanRouteDrafts(originalV2, originalV1, T0)).toMatchObject({ ambiguous: true, conflicting: true });
  expect(readPlanDraftEnvelope(sessionStorage)).toBeNull();
  const selectedName = sessionWins && !sameStops ? "Pub B" : "Pub A";
  const selectedArea = sameStops ? "piccadilly-soho" : "clapham";
  if (sessionWins) {
    expect(writePlanDraftEnvelope({
      title: "Session night", creatorName: "Captain", startTime: START, conciergeQuery: "One pub in Clapham tonight",
      stops: [{ key: 1, venueId: sameStops ? "venue-a" : "venue-b", venueName: selectedName }],
      requestedStopCount: 1, routeReference: null, explicitNightContext: { nightArea: selectedArea, stopCount: 1 },
    }, "manual", sessionStorage, T0 + 1000)).toMatchObject({ v1: true, v2: true });
  }

  rememberPlanHostName(localStorage, "Captain");
  advance(2000);
  await mountComposer();
  expect(document.querySelector(".planStop__name")?.textContent).toBe(selectedName);
  expect(document.querySelector("#plan-route-stale-title")?.textContent).toBe("This route needs a refresh");
  expect(localStorage.getItem(PLAN_ROUTE_DRAFT_V2_KEY)).toBe(originalV2);
  if (sessionWins) {
    expect(JSON.parse(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)!)).toMatchObject({
      savedAt: "2026-11-03T12:00:01.000Z", explicitNightContext: { nightArea: selectedArea, stopCount: 1 },
      nightContext: null, groundingProof: null, createOperationKey: null, routeStale: true,
    });
  } else expect(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)).toBe(originalV1);
  advance(3000);
  await remountComposer();
  expect(document.querySelector(".planStop__name")?.textContent).toBe(selectedName);
  expect(localStorage.getItem(PLAN_ROUTE_DRAFT_V2_KEY)).toBe(originalV2);
  if (!sessionWins) expect(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)).toBe(originalV1);
  await attemptRouteSave();
  if (sameStops) {
    sessionStorage.clear();
    advance(4000);
    await remountComposer();
    expect(document.querySelector(".planStop__name")?.textContent).toBe(selectedName);
    expect(document.querySelector("#plan-route-stale-title")?.textContent).toBe("This route needs a refresh");
    await openTune();
    expect(document.querySelector<HTMLSelectElement>("#plan-context-area")?.value).toBe(selectedArea);
    expect(localStorage.getItem(PLAN_ROUTE_DRAFT_V2_KEY)).toBe(originalV2);
  }
});

it("retains an undated local route with no request records through untouched reloads", async () => {
  const advance = pinClock();
  const generated = await generateProofRoute(3);
  const legacy = JSON.parse(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)!);
  delete legacy.savedAt;
  localStorage.setItem(PLAN_ROUTE_DRAFT_KEY, JSON.stringify(legacy));
  localStorage.removeItem(PLAN_ROUTE_DRAFT_V2_KEY);
  localStorage.removeItem(PLAN_INTAKE_STORAGE_KEY);
  sessionStorage.removeItem(PLAN_DRAFT_KEY);
  sessionStorage.removeItem(PLAN_DRAFT_V2_KEY);
  rememberPlanHostName(localStorage, "Captain");

  for (const offset of [1000, 2000]) {
    advance(offset);
    await remountComposer();
    expect.soft(sessionStorage.getItem(PLAN_DRAFT_KEY)).toBeNull();
    expect.soft(sessionStorage.getItem(PLAN_DRAFT_V2_KEY)).toBeNull();
    expect.soft(localStorage.getItem(PLAN_INTAKE_STORAGE_KEY)).toBeNull();
    const route = JSON.parse(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)!);
    expect.soft(route.savedAt).toBeUndefined();
    expect.soft(route).toMatchObject({
      groundingProof: generated.groundingProof, nightContext: { nightArea: "clapham", stopCount: 3 }, routeStale: false,
    });
    expect.soft(lockButton().getAttribute("aria-disabled")).toBeNull();
  }
  await openTune();
  expect(document.querySelector<HTMLSelectElement>("#plan-context-area")?.value).toBe("clapham");
  await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  await settle();
  expect(await saveRoute()).toMatchObject({ groundingProof: generated.groundingProof, context: { nightArea: "clapham", stopCount: 3 } });
});

it.each(["dated", "undated"] as const)("preserves a %s candidate date through repeated preview recovery", async (format) => {
  const advance = pinClock();
  await generateProofRoute();
  await openTune();
  advance(1000);
  await editTuneControl("time", "daytime");
  await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  await settle();
  advance(2000);
  await editInput("#plan-title", "Our next night");
  const preview = JSON.parse(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)!);
  expect(typeof preview.savedAt).toBe("string");
  expect(Date.parse(preview.savedAt)).toBeLessThan(T0 + 3000);
  const expectedDate = format === "dated" ? preview.savedAt : undefined;
  if (format === "undated") {
    delete preview.savedAt;
    localStorage.setItem(PLAN_ROUTE_DRAFT_KEY, JSON.stringify(preview));
    localStorage.removeItem(PLAN_ROUTE_DRAFT_V2_KEY);
  }
  for (const offset of [3000, 4000]) {
    advance(offset);
    await remountComposer();
    expect.soft(JSON.parse(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)!).savedAt,
      "Recovery preserves the candidate writer date").toBe(expectedDate);
    expect(document.querySelector(".planStop__name")?.textContent).toBe("Pub A");
    expect(readPlanDraftEnvelope(sessionStorage)?.draft.routeReference).toBeNull();
    await attemptRouteSave();
  }
});

it.each(["both", "v1", "v2"] as const)(
  "keeps the selected Session candidate date without borrowing route proof: %s",
  async (format) => {
    const advance = pinClock();
    await generateProofRoute();
    const draft = readPlanDraftEnvelope(sessionStorage)!.draft;
    expect(writePlanDraftEnvelope({ ...draft, routeReference: null,
      stops: [{ key: 1, venueId: "venue-b", venueName: "Pub B" }],
    }, "manual", sessionStorage, T0 + 1000)).toMatchObject({ v1: true, v2: true });
    if (format === "v1") sessionStorage.removeItem(PLAN_DRAFT_V2_KEY);
    if (format === "v2") sessionStorage.removeItem(PLAN_DRAFT_KEY);
    blockStorageWrites("sessionStorage");
    advance(2000);
    await remountComposer();
    const route = JSON.parse(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)!);
    // An undated or uncorroborated request cannot replace a dated route.
    expect([...document.querySelectorAll(".planStop__name")].map((node) => node.textContent))
      .toEqual([format === "both" ? "Pub B" : "Pub A"]);
    expect(route.savedAt).toBe(format === "both" ? "2026-11-03T12:00:01.000Z" : "2026-11-03T12:00:00.000Z");
    if (format === "both") {
      expect(route).toMatchObject({ nightContext: null, routeNight: null, groundingProof: null,
        createOperationKey: null, planAnchor: null, routeRevision: null, routeStale: true });
      await attemptRouteSave();
    }
  },
);

it("blocks the old submit handler before the session Ask's deferred state update", async () => {
  pinClock();
  await generateProofRoute(3);
  const session = sessionStorage;
  session.setItem(ASK_PLAN_DRAFT_STORAGE_KEY, JSON.stringify({ query: "One pub in Clapham tonight" }));
  let attempted = false;
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => {
      const value = session.getItem(key);
      if (key === ASK_PLAN_DRAFT_STORAGE_KEY && value) queueMicrotask(() => {
        attempted = true;
        document.querySelector<HTMLFormElement>("#plan-composer")!.requestSubmit();
      });
      return value;
    },
    setItem: session.setItem.bind(session), removeItem: session.removeItem.bind(session),
    clear: session.clear.bind(session), key: session.key.bind(session), get length() { return session.length; },
  } satisfies Storage);
  await remountComposer();
  expect(attempted).toBe(true);
  expectNoRouteSave();
  expect(document.querySelector("#plan-lock-hint")?.textContent).toContain("Refresh the route");
});

it.each(["empty", "anchor-conflict", "failure", "unsupported"] as const)(
  "revokes the old route before the first automatic URL request ends with %s", async (outcome) => {
    const advance = pinClock();
    await generateProofRoute(3);
    advance(1000);
    const query = outcome === "unsupported" ? "One pub in Hackney tonight" : "One pub in Clapham tonight";
    window.history.replaceState({}, "", `/plan?query=${encodeURIComponent(query)}`);
    let attemptedDuringRequest = false;
    fetchMock.mockImplementation(async (input) => {
      if (!String(input).includes("/api/plans/generate")) return new Response("[]", { status: 200 });
      attemptedDuringRequest = true;
      document.querySelector<HTMLFormElement>("#plan-composer")!.requestSubmit();
      return new Response(JSON.stringify(outcome === "anchor-conflict"
        ? { outcome: "anchor-conflict", message: "Keep this pub" } : { stops: [] }), { status: outcome === "failure" ? 503 : 200, headers: { "content-type": "application/json" } });
    });
    await remountComposer();
    expect(attemptedDuringRequest).toBe(outcome !== "unsupported");
    expect(document.querySelector(".planStop__name")?.textContent).toBe("Pub A");
    expect(document.querySelector("#plan-route-stale-title")?.textContent).toContain("This route needs a refresh");
    await attemptRouteSave();
  },
);

it("retains the accepted pub while a fresh session Ask makes its route an unverified preview", async () => {
  const advance = pinClock();
  const generated = await generateProofRoute(3);
  expect(transferGeneratedRouteToDraft({ ...generated, outcome: "route", anchorVenueId: "venue-a", anchorSource: "map-search" }, localStorage, "plan-generated", T0)).toBe(true);
  const draft = readPlanDraftEnvelope(sessionStorage)!.draft;
  writePlanDraftEnvelope({ ...draft, acceptedAnchor: {
    venueId: "venue-a", source: "map-search", cityId: "london", acceptedArea: null, startsAt: null,
    expiresAt: new Date(T0 + 3_600_000).toISOString(),
  } }, "planning-intent", sessionStorage, T0);
  sessionStorage.setItem(ASK_PLAN_DRAFT_STORAGE_KEY, JSON.stringify({ query: "One pub in Clapham tonight" }));
  advance(1000);
  await remountComposer();
  expect(document.body.textContent).toContain("Pub A");
  expect(readPlanDraftEnvelope(sessionStorage)?.draft.acceptedAnchor?.venueId).toBe("venue-a");
  expect(document.querySelector("#plan-lock-hint")?.textContent).toContain("Refresh the route");
  await attemptRouteSave();
  advance(2000);
  await remountComposer();
  expect(readPlanDraftEnvelope(sessionStorage)?.draft.acceptedAnchor?.venueId).toBe("venue-a");
  await attemptRouteSave();
});

it.each(["missing", "malformed", "expired"] as const)("keeps an older route as an unverified preview when correlation is %s", async (condition) => {
  const advance = pinClock();
  await generateProofRoute();
  advance(1000);
  await editInput("#plan-title", "Our next night");
  if (condition === "expired") {
    advance(3_600_001);
  } else {
    for (const key of ["pubmaxx:plan-draft:v1", "pubmax:plan-draft:v2"]) {
      const stored = JSON.parse(sessionStorage.getItem(key)!);
      const draft = stored.draft ?? stored;
      if (condition === "missing") delete draft.routeReference;
      else draft.routeReference = { savedAt: "yesterday", operationKey: "proof-operation" };
      sessionStorage.setItem(key, JSON.stringify(stored));
    }
    advance(2000);
  }
  await remountComposer();
  expect(document.querySelector(".planStop__name")?.textContent).toBe("Pub A");
  expect(document.querySelector("#plan-lock-hint")?.textContent).toContain("Refresh the route");
  await attemptRouteSave();
});
it.each([false, true])("cannot lock the older route when only a newer intake count survives, missing session: %s", async (missingSession) => {
  const advance = pinClock();
  const generated = generatedProofFixture(3);
  fetchMock.mockImplementation(async (input) => new Response(JSON.stringify(String(input).includes("/api/plans/generate") ? generated : []), {status:200,headers:{"content-type":"application/json"}}));
  await generateFromDescription();
  await editInput("#plan-name", "Captain");
  blockStorageWrites("sessionStorage");
  rejectRouteWrites([PLAN_ROUTE_DRAFT_KEY, PLAN_ROUTE_DRAFT_V2_KEY]);
  await openTune();
  advance(1000);
  await editTuneControl("stops", "1");
  expect(readPlanIntakeDraftWithMetadata(localStorage)?.draft.answers).toMatchObject({stopCount:1,stopCountSource:"picker"});
  if (missingSession) {
    sessionStorage.removeItem("pubmaxx:plan-draft:v1");
    sessionStorage.removeItem("pubmax:plan-draft:v2");
  }
  advance(2000);
  await remountComposer();
  if (missingSession) await editInput("#plan-name", "Captain");
  if (!document.querySelector<HTMLInputElement>("#plan-time")?.value) await editInput("#plan-time", START);
  await act(async () => document.querySelector<HTMLFormElement>("#plan-composer")!.requestSubmit());
  expect(fetchMock.mock.calls.filter(([input]) => String(input) === "/api/plans")).toHaveLength(0);
  expect(document.querySelector("#plan-lock-hint")?.textContent).toContain("Refresh the route");
});

it.each([false, true])("retains the newest intake choices while its older route becomes a preview, session blocked: %s", async (sessionBlocked) => {
  const advance = pinClock();
  await generateProofRoute(3);
  if (sessionBlocked) blockStorageWrites("sessionStorage");
  rejectRouteWrites([PLAN_ROUTE_DRAFT_KEY, PLAN_ROUTE_DRAFT_V2_KEY]);
  await openTune();
  advance(1000);
  await editTuneControl("stops", "1");
  await editTuneControl("budget", "value");
  expect(readPlanIntakeDraftWithMetadata(localStorage)?.draft.answers).toMatchObject({stopCount:1,stopCountSource:"picker",budget:"value"});
  const savedAt = readPlanIntakeDraftWithMetadata(localStorage)?.savedAt;
  expect(readPlanIntakeDraftWithMetadata(localStorage)?.routeReference).toBeNull();
  if (!sessionBlocked) expect(readPlanDraftEnvelope(sessionStorage)?.draft.routeReference).toBeNull();
  advance(2000);
  await remountComposer();
  await openTune();
  expect(document.querySelector<HTMLSelectElement>("#plan-context-stops")?.value).toBe("1");
  expect(document.querySelector<HTMLSelectElement>("#plan-context-budget")?.value).toBe("value");
  expect(readPlanIntakeDraftWithMetadata(localStorage)?.savedAt).toBe(savedAt);
  await sortAgainFromTune();
  expect(reconciledGenerationContext()).toMatchObject({stopCount:1,budget:"value"});
});

it("retains fresh Ask revocation through session-only reload", async () => {
  const advance = pinClock();
  blockStorageWrites("localStorage");
  await generateProofRoute();
  expect(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)).toBeNull();
  const query = "One pub in Clapham after work";
  sessionStorage.setItem(ASK_PLAN_DRAFT_STORAGE_KEY, JSON.stringify({query}));
  advance(1000);
  await remountComposer();
  expect(readPlanDraftEnvelope(sessionStorage)?.draft.conciergeQuery).toBe(query);
  await act(async () => document.querySelector<HTMLFormElement>("#plan-composer")!.requestSubmit());
  expect(fetchMock.mock.calls.filter(([input]) => String(input) === "/api/plans")).toHaveLength(0);
  expect(readPlanDraftEnvelope(sessionStorage)?.draft.routeReference).toBeNull();
  for (const elapsed of [2000, 3000]) {
    advance(elapsed);
    await remountComposer();
    await editInput("#plan-title", "Our next night");
    await attemptRouteSave();
    expect(readPlanDraftEnvelope(sessionStorage)?.draft.routeReference).toBeNull();
  }
});

it.each([false, true])("keeps a later First pint edit valid after Tune selected Late, reload: %s", async (reload) => {
  pinClock();
  await generateFromDescription();
  await openTune();
  await editTuneControl("time", "late_night");
  await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", {key:"Escape",bubbles:true})); });
  await settle();
  await editInput("#plan-time", "2026-11-03T21:30");
  expect(document.querySelector<HTMLInputElement>("#plan-time")?.value).toBe("2026-11-03T21:30");
  expect(readPlanIntakeDraftWithMetadata(localStorage)?.draft.answers).toMatchObject({timeWindow:"evening",exactStartIso:"2026-11-03T21:30:00.000Z"});
  if (reload) await remountComposer();
  await openTune();
  expect(document.querySelector<HTMLSelectElement>("#plan-context-time")?.value).toBe("evening");
  await sortAgainFromTune();
  const post = fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/plans/generate")).at(-1)!;
  const request = JSON.parse(String(post[1]?.body));
  expect(request.intake.timeWindow.exactStartIso).toBe("2026-11-03T21:30:00.000Z");
  const parsed = parsePlanGenerationIntake(request.intake, new Date(T0));
  expect(parsed).toMatchObject({ok:true});
});

it.each([1, 5] as const)("does not promote UNKNOWN equal-date correlation for request count %s", async (requestedCount) => {
  const advance = pinClock();
  await generateProofRoute();
  const draft = readPlanDraftEnvelope(sessionStorage)!.draft;
  writePlanDraftEnvelope({
    ...draft, requestedStopCount: requestedCount, requestedStopCountSource: undefined, routeReference: undefined,
  }, "manual", sessionStorage, T0);
  localStorage.removeItem(PLAN_INTAKE_STORAGE_KEY);
  await remountComposer();
  expect(document.querySelector(".planStop__name")?.textContent).toBe("Pub A");
  await openTune();
  expect(document.querySelector<HTMLSelectElement>("#plan-context-stops")?.value).toBe(String(requestedCount));
  await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  await settle();
  await attemptRouteSave();
  advance(1000);
  const fresh = {
    ...generatedProofFixture(), grounded: true, operationKey: "fresh-accepted-operation",
    groundingProof: `${btoa(JSON.stringify({ v: 1, expiresAt: T0 + 7_200_000 }))}.fresh-test-signature`,
    inferredContext: { ...GENERATED.inferredContext, stopCount: requestedCount },
  };
  fetchMock.mockImplementation(async (input) => new Response(JSON.stringify(
    String(input).includes("/api/plans/generate") ? fresh : [],
  ), { status: 200, headers: { "content-type": "application/json" } }));
  await openTune();
  advance(1000);
  await sortAgainFromTune();
  expect(reconciledGenerationContext().stopCount).toBe(requestedCount);
  expect(readPlanDraftEnvelope(sessionStorage)?.draft.routeReference).toEqual({
    savedAt: "2026-11-03T12:00:01.000Z", operationKey: "fresh-accepted-operation",
  });
  expect(readPlanDraftEnvelope(sessionStorage)?.draft.requestedStopCountSource).toBeUndefined();
  if (requestedCount === 1) {
    expect(await saveRoute()).toMatchObject({ groundingProof: fresh.groundingProof, context: { stopCount: 1 } });
    return;
  }
  expect(document.querySelector("#plan-lock-hint")?.textContent).toContain("exactly 5 stops");
  await attemptRouteSave();
  const complete = {
    ...fresh, operationKey: "complete-accepted-operation",
    groundingProof: `${btoa(JSON.stringify({ v: 1, expiresAt: T0 + 7_200_000 }))}.complete-test-signature`,
    stops: [
      { venueId: "venue-a", venueName: "Pub A" }, { venueId: "venue-b", venueName: "Pub B" },
      { venueId: "venue-c", venueName: "Pub C" }, { venueId: "venue-d", venueName: "Pub D" },
      { venueId: "venue-e", venueName: "Pub E" },
    ],
  };
  fetchMock.mockImplementation(async (input) => new Response(JSON.stringify(
    String(input).includes("/api/plans/generate") ? complete : [],
  ), { status: 200, headers: { "content-type": "application/json" } }));
  await openTune();
  advance(2000);
  await sortAgainFromTune();
  expect(reconciledGenerationContext().stopCount).toBe(5);
  expect(readPlanDraftEnvelope(sessionStorage)?.draft).toMatchObject({
    requestedStopCount: 5,
    routeReference: { savedAt: "2026-11-03T12:00:02.000Z", operationKey: "complete-accepted-operation" },
  });
  expect(readPlanDraftEnvelope(sessionStorage)?.draft.requestedStopCountSource).toBeUndefined();
  expect(await saveRoute()).toMatchObject({ groundingProof: complete.groundingProof, context: { stopCount: 5 } });
});

it.each([
  { format: "v2", expired: false }, { format: "v2", expired: true },
  { format: "v1", expired: false }, { format: "v1", expired: true },
  { format: "v2-only", expired: false }, { format: "v2-only", expired: true },
].flatMap((condition) => [false, true].map((localRoute) => ({ ...condition, localRoute }))))(
  "preserves known revocation in $format when acceptance expiry is $expired, local route: $localRoute",
  async ({ format, expired, localRoute }) => {
    const advance = pinClock();
    if (!localRoute) blockStorageWrites("localStorage");
    await generateProofRoute();
    if (localRoute) blockStorageWrites("localStorage");
    const draft = readPlanDraftEnvelope(sessionStorage)!.draft;
    writePlanDraftEnvelope({ ...draft, acceptedAnchor: {
      venueId: "venue-a", source: "map-search", cityId: "london", acceptedArea: null, startsAt: null,
      expiresAt: new Date(T0 + 60_000).toISOString(),
    } }, "planning-intent", sessionStorage, T0);
    sessionStorage.setItem(ASK_PLAN_DRAFT_STORAGE_KEY, JSON.stringify({ query: "One pub in Clapham tonight" }));
    advance(1000);
    await remountComposer();
    expect(readPlanDraftEnvelope(sessionStorage)?.draft.routeReference).toBeNull();
    if (format === "v1") sessionStorage.removeItem("pubmax:plan-draft:v2");
    if (format === "v2-only") sessionStorage.removeItem("pubmaxx:plan-draft:v1");
    blockStorageWrites("sessionStorage");
    advance(expired ? 61_000 : 2000);
    for (let reload = 0; reload < 2; reload += 1) {
      await remountComposer();
      await editInput("#plan-title", "Our next night");
      await attemptRouteSave();
      expect(readPlanDraftEnvelope(sessionStorage)?.draft.routeReference).toBeNull();
      expect(document.querySelector(".planStop__name")?.textContent).toBe("Pub A");
      if (expired) expect(readPlanDraftEnvelope(sessionStorage)?.draft.acceptedAnchor).toBeUndefined();
    }
  },
);

it.each([
  { format: "v1", correlation: "missing" }, { format: "v1", correlation: "malformed" },
  { format: "v2", correlation: "missing" }, { format: "v2", correlation: "malformed" },
])("keeps a session-only $format preview unverified with $correlation correlation", async ({ format, correlation }) => {
  pinClock();
  blockStorageWrites("localStorage");
  await generateProofRoute();
  for (const key of ["pubmaxx:plan-draft:v1", "pubmax:plan-draft:v2"]) {
    const stored = JSON.parse(sessionStorage.getItem(key)!);
    const draft = stored.draft ?? stored;
    if (correlation === "missing") delete draft.routeReference;
    else draft.routeReference = { savedAt: "yesterday", operationKey: "proof-operation" };
    sessionStorage.setItem(key, JSON.stringify(stored));
  }
  if (format === "v1") sessionStorage.removeItem("pubmax:plan-draft:v2");
  blockStorageWrites("sessionStorage");
  for (let reload = 0; reload < 2; reload += 1) {
    await remountComposer();
    expect(document.querySelector(".planStop__name")?.textContent).toBe("Pub A");
    await attemptRouteSave();
    expect(readPlanDraftEnvelope(sessionStorage)?.draft.routeReference).toBeUndefined();
  }
  const fresh = generatedProofFixture();
  fetchMock.mockImplementation(async (input) => new Response(JSON.stringify(
    String(input).includes("/api/plans/generate") ? fresh : [],
  ), { status: 200, headers: { "content-type": "application/json" } }));
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent === "Make a plan")!.click());
  await settle();
  expect(reconciledGenerationContext().stopCount).toBe(3);
  expect(readPlanDraftEnvelope(sessionStorage)?.draft.requestedStopCount).toBeUndefined();
  expect(await saveRoute()).toMatchObject({ groundingProof: fresh.groundingProof, context: { stopCount: 1 } });
});

async function chooseFiveStops(): Promise<void> {
  const picker = [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim() === "5")!;
  await act(async () => { picker.click(); });
  await settle();
  expect(picker.getAttribute("aria-pressed")).toBe("true");
}

function seedCompletedFiveStopIntake(): void {
  const draft = skipRemainingPlanIntake(createPlanIntakeDraft());
  expect(writePlanIntakeDraft({
    ...draft, answers: { ...draft.answers, stopCount: 5, stopCountSource: "picker" },
  }, localStorage, T0)).toBe(true);
}

it.each([
  { savedCount: 3, intakeWritable: false, warning: true },
  { savedCount: 3, intakeWritable: true, warning: false },
  { savedCount: undefined, intakeWritable: false, warning: false },
] as const)("reports the unsaved part of a same-text Ask ($savedCount / local writes $intakeWritable)", async ({
  savedCount, intakeWritable, warning,
}) => {
  const advance = pinClock();
  const query = "Quiet in Clapham tonight";
  const completed = skipRemainingPlanIntake(createPlanIntakeDraft());
  const intake = { ...completed, answers: { ...completed.answers, stopCount: savedCount } };
  expect(writePlanIntakeDraft(intake, localStorage, T0, null, {})).toBe(true);
  expect(writePlanDraftEnvelope({
    title: "Night", creatorName: "Captain", startTime: START, conciergeQuery: query,
    stops: [], requestedStopCount: savedCount, requestIntake: intake, routeReference: null, explicitNightContext: {},
  }, "manual", sessionStorage, T0)).toMatchObject({ v1: true, v2: true });
  expect(readPlanIntakeDraftWithMetadata(localStorage)?.draft.answers.stopCount).toBe(savedCount);
  expect(readPlanIntakeDraftWithMetadata(localStorage)?.draft.answers.stopCountSource).toBeUndefined();
  const sessionV1 = sessionStorage.getItem(PLAN_DRAFT_KEY);
  const sessionV2 = sessionStorage.getItem(PLAN_DRAFT_V2_KEY);
  const localBefore = localStorage.getItem(PLAN_INTAKE_STORAGE_KEY);

  sessionStorage.setItem(ASK_PLAN_DRAFT_STORAGE_KEY, JSON.stringify({ query }));
  blockStorageWrites("sessionStorage");
  if (!intakeWritable) blockStorageWrites("localStorage");
  advance(1000);
  await mountComposer();
  expect(sessionStorage.getItem(ASK_PLAN_DRAFT_STORAGE_KEY)).toBeNull();
  expect(document.querySelector<HTMLInputElement>("#plan-concierge-query")?.value).toBe(query);
  expect(fetchMock.mock.calls.filter(([input]) => String(input) === "/api/plans/generate")).toHaveLength(0);
  const notice = "Your changes could not be saved on this device. Keep this page open to keep them.";
  if (warning) expect(document.body.textContent).toContain(notice);
  else if (intakeWritable) expect(document.body.textContent).toContain("Your description could not be saved");
  else expect(document.body.textContent).not.toContain("could not be saved");
  expect(sessionStorage.getItem(PLAN_DRAFT_KEY)).toBe(sessionV1);
  expect(sessionStorage.getItem(PLAN_DRAFT_V2_KEY)).toBe(sessionV2);
  if (intakeWritable) {
    const saved = readPlanIntakeDraftWithMetadata(localStorage);
    expect(saved?.savedAt).toBe("2026-11-03T12:00:01.000Z");
    expect(saved?.draft.answers.stopCount).toBeUndefined();
    advance(2000);
    await remountComposer();
    expect(document.querySelector<HTMLInputElement>("#plan-concierge-query")?.value).toBe("");
    expect(document.body.textContent).toContain("Your latest description could not be restored");
    expect(readPlanIntakeDraftWithMetadata(localStorage)?.savedAt).toBe(saved?.savedAt);
    expect(sessionStorage.getItem(PLAN_DRAFT_V2_KEY)).toBe(sessionV2);
  } else {
    expect(localStorage.getItem(PLAN_INTAKE_STORAGE_KEY)).toBe(localBefore);
  }
});

it.each([
  { blockedKey: PLAN_DRAFT_KEY, finalCount: 5 },
  { blockedKey: PLAN_DRAFT_V2_KEY, finalCount: 5 },
  { blockedKey: PLAN_DRAFT_V2_KEY, finalCount: 3 },
] as const)("warns when split Session loses requested count or ownership ($blockedKey / $finalCount)", async ({
  blockedKey, finalCount,
}) => {
  const advance = pinClock();
  const completed = skipRemainingPlanIntake(createPlanIntakeDraft());
  const intake = { ...completed, answers: { ...completed.answers, stopCount: 3 as const } };
  expect(writePlanIntakeDraft(intake, localStorage, T0, null, {})).toBe(true);
  expect(writePlanDraftEnvelope({
    title: "Night", creatorName: "Captain", startTime: START, conciergeQuery: "",
    stops: [], requestedStopCount: 3, requestIntake: intake, routeReference: null, explicitNightContext: {},
  }, "manual", sessionStorage, T0)).toMatchObject({ v1: true, v2: true });
  const blockedBefore = sessionStorage.getItem(blockedKey);
  const writableKey = blockedKey === PLAN_DRAFT_KEY ? PLAN_DRAFT_V2_KEY : PLAN_DRAFT_KEY;
  rejectSessionRecordWrites([blockedKey]);
  await mountComposer();
  expect(document.querySelector<HTMLSelectElement>("#plan-context-stops")?.value).toBe("3");

  advance(1000);
  await editTuneControl("stops", "5");
  if (finalCount === 3) {
    advance(1500);
    await editTuneControl("stops", "3");
  }
  expect(document.querySelector<HTMLSelectElement>("#plan-context-stops")?.value).toBe(String(finalCount));
  expect(document.body.textContent).toContain("Your plan details could not be saved");
  const written = JSON.parse(sessionStorage.getItem(writableKey)!);
  expect(written.draft ?? written).toMatchObject({ requestedStopCount: finalCount, requestedStopCountSource: "picker" });
  expect(sessionStorage.getItem(blockedKey)).toBe(blockedBefore);
  expect(readPlanIntakeDraftWithMetadata(localStorage)?.draft.answers)
    .toMatchObject({ stopCount: finalCount, stopCountSource: "picker" });

  advance(2000);
  await remountComposer();
  expect(action("3").getAttribute("aria-pressed")).toBe("true");
  expect(sessionStorage.getItem(blockedKey)).toBe(blockedBefore);
  if (finalCount === 3) {
    await editInput("#plan-describe-first-query", "One pub in Clapham tonight");
    expect(action("1").getAttribute("aria-pressed")).toBe("true");
  }
});

function seedSplitSaveRequest(query: string, count: 1 | 3): void {
  const complete = skipRemainingPlanIntake(createPlanIntakeDraft());
  const intake = { ...complete, answers: { ...complete.answers, stopCount: count } };
  expect(writePlanIntakeDraft(intake, localStorage, T0, null, {})).toBe(true);
  expect(writePlanDraftEnvelope({
    title: "Night", creatorName: "Captain", startTime: START, conciergeQuery: query,
    stops: [], requestedStopCount: count, requestIntake: intake, routeReference: null, explicitNightContext: {},
  }, "manual", sessionStorage, T0)).toMatchObject({ v1: true, v2: true });
}

it("warns when a saved generation cannot be selected after the old V1 request survives", async () => {
  const advance = pinClock();
  const generated = generatedProofFixture();
  seedSplitSaveRequest("One pub in Clapham tonight", 1);
  const stale = sessionStorage.getItem(PLAN_DRAFT_KEY);
  rejectSessionRecordWrites([PLAN_DRAFT_KEY]);
  fetchMock.mockImplementation(async (input) => Response.json(String(input).includes("/api/plans/generate") ? generated : []));
  await mountComposer();

  advance(1000);
  await act(async () => { action("Make a plan").click(); });
  await settle();
  expect(document.querySelector(".planStop__name")?.textContent).toBe("Pub A");
  const reference = { savedAt: "2026-11-03T12:00:01.000Z", operationKey: generated.operationKey };
  expect(readPlanDraftEnvelope(sessionStorage)?.draft.routeReference).toEqual(reference);
  expect(readPlanIntakeDraftWithMetadata(localStorage)?.routeReference).toEqual(reference);
  expect(JSON.parse(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)!)).toMatchObject({ groundingProof: generated.groundingProof });
  expect(sessionStorage.getItem(PLAN_DRAFT_KEY)).toBe(stale);
  expect(document.body.textContent).toContain("Your route could not be saved");

  advance(2000);
  await remountComposer();
  expect(document.querySelector(".planStop__name")).toBeNull();
  expect(document.querySelector("[data-result]")).toBeNull();
  expect(sessionStorage.getItem(PLAN_DRAFT_KEY)).toBe(stale);
});

it("warns when a saved group size is unavailable after a split Session reload", async () => {
  const advance = pinClock();
  seedSplitSaveRequest("", 3);
  const stale = sessionStorage.getItem(PLAN_DRAFT_KEY);
  rejectSessionRecordWrites([PLAN_DRAFT_KEY]);
  await mountComposer();

  advance(1000);
  await editTuneControl("people", "5");
  expect(document.querySelector<HTMLInputElement>("#plan-context-people")?.value).toBe("5");
  expect(readPlanDraftEnvelope(sessionStorage)?.draft).toMatchObject({
    explicitNightContext: { groupSize: 5 }, requestIntake: { answers: { groupSize: 5 } },
  });
  expect(readPlanIntakeDraftWithMetadata(localStorage)?.draft.answers.groupSize).toBe(5);
  expect(sessionStorage.getItem(PLAN_DRAFT_KEY)).toBe(stale);
  expect(document.body.textContent).toContain("Your plan details could not be saved");

  advance(2000);
  await remountComposer();
  await editInput("#plan-describe-first-query", "Quiet in Clapham tonight");
  await act(async () => { action("Plan it").click(); });
  await settle();
  expect(reconciledGenerationContext().groupSize).not.toBe(5);
});

it("does not report a save failure when an empty plan only saves its stop picker", async () => {
  pinClock();
  blockStorageWrites("sessionStorage");
  await mountComposer();
  await chooseFiveStops();
  expect(readPlanIntakeDraftWithMetadata(localStorage)?.draft.answers)
    .toMatchObject({ stopCount: 5, stopCountSource: "picker" });
  expect(readPlanDraftEnvelope(sessionStorage)).toBeNull();
  expect(document.body.textContent).not.toContain("could not be saved");
  await remountComposer();
  expect(readPlanIntakeDraftWithMetadata(localStorage)?.draft.answers)
    .toMatchObject({ stopCount: 5, stopCountSource: "picker" });
  expect(document.querySelector("[aria-pressed='true']")?.textContent).toBe("5");
  expect(document.body.textContent).not.toContain("could not be saved");
});

it("still reports an unsaved description when only the stop picker can persist", async () => {
  pinClock();
  await mountComposer();
  await chooseFiveStops();
  blockStorageWrites("sessionStorage");
  await editInput("#plan-describe-first-query", "Quiet in Clapham tonight");
  expect(readPlanIntakeDraftWithMetadata(localStorage)?.draft.answers.stopCount).toBe(5);
  expect(readPlanDraftEnvelope(sessionStorage)?.draft.conciergeQuery).toBe("");
  expect(document.body.textContent).toContain("Your description could not be saved");
});

it.each([
  { selector: "#plan-title", value: "Our Friday" },
  { selector: "#plan-name", value: "Captain" },
])("still reports an unsaved $selector with saved intake and no stops", async ({ selector, value }) => {
  const advance = pinClock();
  seedCompletedFiveStopIntake();
  blockStorageWrites("sessionStorage");
  await mountComposer();
  advance(1000);
  await editInput(selector, value);
  expect(document.querySelector<HTMLInputElement>(selector)?.value).toBe(value);
  expect(readPlanIntakeDraftWithMetadata(localStorage)?.draft.answers.stopCount).toBe(5);
  expect(readPlanDraftEnvelope(sessionStorage)).toBeNull();
  expect(document.body.textContent).toContain("Your plan details could not be saved");
  await remountComposer();
  expect(document.querySelector<HTMLInputElement>(selector)?.value).not.toBe(value);
});

it("reports an exact-time edit if an empty request cannot restore it", async () => {
  const advance = pinClock();
  seedCompletedFiveStopIntake();
  blockStorageWrites("sessionStorage");
  await mountComposer();
  advance(1000);
  const chosen = "2026-11-04T21:30";
  await editInput("#plan-time", chosen);
  expect(document.querySelector<HTMLInputElement>("#plan-time")?.value).toBe(chosen);
  expect(readPlanDraftEnvelope(sessionStorage)).toBeNull();
  expect(document.body.textContent).toContain("Your plan details could not be saved");
  await remountComposer();
  expect(document.querySelector<HTMLInputElement>("#plan-time")?.value).not.toBe(chosen);
});


type SaveMatrixField = "count" | "description" | "time-preset" | "time-no-preset" | "title" | "name";
type SaveMatrixMode = "intake-only-empty" | "session-only-valid" | "neither-empty" | "neither-valid" | "both-valid";
const saveMatrixFields: SaveMatrixField[] = ["count", "description", "time-preset", "time-no-preset", "title", "name"];
const saveMatrixModes: SaveMatrixMode[] = ["intake-only-empty", "session-only-valid", "neither-empty", "neither-valid", "both-valid"];

function saveMatrixExpectedValue(field: SaveMatrixField): string {
  if (field === "count") return "5";
  if (field === "description") return "Quiet in Clapham tonight";
  if (field === "time-preset") return "2026-11-03T20:00";
  if (field === "time-no-preset") return "2026-11-04T21:30";
  return field === "title" ? "Our Friday" : "Captain";
}

function saveMatrixSelector(field: SaveMatrixField): string {
  if (field === "count") return "#plan-context-stops";
  if (field === "description") return "#plan-concierge-query";
  if (field === "time-preset" || field === "time-no-preset") return "#plan-time";
  return field === "title" ? "#plan-title" : "#plan-name";
}

function saveMatrixPublicReads(field: SaveMatrixField) {
  const intake = readPlanIntakeDraftWithMetadata(localStorage);
  const session = readPlanDraftEnvelope(sessionStorage);
  const expected = saveMatrixExpectedValue(field);
  let intakeValue: unknown;
  let sessionValue: unknown;
  if (field === "count") {
    intakeValue = intake?.draft.answers.stopCount === undefined ? undefined : String(intake.draft.answers.stopCount);
    sessionValue = session?.draft.requestedStopCount === undefined ? undefined : String(session.draft.requestedStopCount);
  } else if (field === "description") sessionValue = session?.draft.conciergeQuery;
  else if (field === "title") sessionValue = session?.draft.title;
  else if (field === "name") sessionValue = session?.draft.creatorName;
  else {
    intakeValue = intake?.draft.answers.exactStartIso?.slice(0,16);
    sessionValue = session?.draft.startTime;
  }
  return { intakeValue, sessionValue, intakeCarriesEdit: intakeValue === expected, sessionCarriesEdit: sessionValue === expected };
}

it.each(saveMatrixFields.flatMap((field) => saveMatrixModes.map((mode) => ({ field, mode }))))(
  "public recovery matrix $field / $mode",
  async ({ field, mode }) => {
    const advance = pinClock();
    const completed = skipRemainingPlanIntake(createPlanIntakeDraft());
    const preset = field === "time-preset";
    const intake = {
      ...completed,
      skippedSteps: preset ? completed.skippedSteps.filter((step) => step !== "time-window") : completed.skippedSteps,
      answers: { ...completed.answers, stopCount: 3 as const, stopCountSource: "picker" as const,
        ...(preset ? { timeWindow: "evening" as const, exactStartIso: "2026-11-03T19:00:00.000Z" } : {}) },
    };
    expect(writePlanIntakeDraft(intake, localStorage, T0)).toBe(true);
    const validSession = mode.endsWith("valid");
    if (validSession) {
      expect(writePlanDraftEnvelope({
        title: "Initial night", creatorName: "Initial host", startTime: START,
        conciergeQuery: "", requestedStopCount: 3, requestedStopCountSource: "picker", routeReference: null,
        stops: [{ key: 1, venueId: "venue-a", venueName: "Pub A" }],
      }, "manual", sessionStorage, T0)).toMatchObject({ v1: true, v2: true });
    }
    if (mode === "intake-only-empty") blockStorageWrites("sessionStorage");
    if (mode === "session-only-valid") rejectRouteWrites([PLAN_INTAKE_STORAGE_KEY]);
    if (mode === "neither-empty" || mode === "neither-valid") {
      blockStorageWrites("localStorage");
      blockStorageWrites("sessionStorage");
    }
    await mountComposer();
    advance(1000);
    const selector = saveMatrixSelector(field);
    const value = saveMatrixExpectedValue(field);
    expect(document.querySelector<HTMLInputElement | HTMLSelectElement>(selector), "Field is editable before stops, or in the valid Session control").not.toBeNull();
    if (field === "count") {
      await act(async () => {
        const select = document.querySelector<HTMLSelectElement>(selector)!;
        select.value = value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await settle();
    } else await editInput(selector, value);
    expect(document.querySelector<HTMLInputElement | HTMLSelectElement>(selector)?.value).toBe(value);
    const notice = [...document.querySelectorAll("[role='alert']")].map((el) => el.textContent).join(" ");
    const warned = notice.includes("could not be saved");
    const reads = saveMatrixPublicReads(field);
    await remountComposer();
    if (!document.querySelector(selector) && (field === "count" || field === "description")) await openTune();
    const restoredValue = document.querySelector<HTMLInputElement | HTMLSelectElement>(selector)?.value;
    const restored = restoredValue === value;
    const expectedRestoration = mode === "both-valid" || mode === "session-only-valid"
      || (mode === "intake-only-empty" && (field === "count" || field === "time-preset"));
    expect.soft(restored, "Actual mounted reload must preserve every field supported by a successful reader").toBe(expectedRestoration);
    expect.soft(reads.intakeCarriesEdit || reads.sessionCarriesEdit, "Public readers must carry an edit that reload restores").toBe(restored);
    expect.soft(warned, "The warning must describe an edit actually lost on reload").toBe(!restored);
  },
);


type AutomaticNameSource = "account-handle" | "account-full-name" | "account-name" | "remembered-host";
const automaticNameSources: AutomaticNameSource[] = ["account-handle", "account-full-name", "account-name", "remembered-host"];
function seedAutomaticName(source: AutomaticNameSource): void {
  if (source === "remembered-host") {
    rememberPlanHostName(localStorage, "Sam");
    return;
  }
  authSeedFixture.user = { id: "private-test-account", user_metadata: source === "account-full-name"
    ? { full_name: "Sam" } : source === "account-name" ? { name: "Sam" } : {} };
  authSeedFixture.handle = source === "account-handle" ? "Sam" : null;
}

it.each(automaticNameSources.flatMap((source) => [false, true].map((completed) => ({ source, completed }))))(
  "automatic name seed $source does not warn on an untouched visit, completed intake: $completed",
  async ({ source, completed }) => {
    pinClock();
    seedAutomaticName(source);
    if (completed) seedCompletedFiveStopIntake();
    await mountComposer();
    if (completed) expect(document.querySelector<HTMLInputElement>("#plan-name")?.value).toBe("Sam");
    expect(readPlanDraftEnvelope(sessionStorage)).toBeNull();
    expect.soft(document.body.textContent).not.toContain("could not be saved");
    await remountComposer();
    if (completed) expect(document.querySelector<HTMLInputElement>("#plan-name")?.value).toBe("Sam");
    expect(document.body.textContent).not.toContain("could not be saved");
  },
);

it.each(automaticNameSources)("a manually edited %s seed still warns when its new name cannot restore", async (source) => {
  const advance = pinClock();
  seedAutomaticName(source);
  seedCompletedFiveStopIntake();
  blockStorageWrites("sessionStorage");
  await mountComposer();
  expect(document.querySelector<HTMLInputElement>("#plan-name")?.value).toBe("Sam");
  advance(1000);
  await editInput("#plan-name", "Alex");
  expect(readPlanDraftEnvelope(sessionStorage)).toBeNull();
  expect(document.body.textContent).toContain("Your plan details could not be saved");
  await remountComposer();
  expect(document.querySelector<HTMLInputElement>("#plan-name")?.value).toBe("Sam");
});

it.each([false, true])("a remembered crew alone neither fills a host nor warns, completed intake: %s", async (completed) => {
  pinClock();
  rememberLastCrew(["Sam", "Alex"], "private-test-crew");
  if (completed) seedCompletedFiveStopIntake();
  await mountComposer();
  if (completed) {
    expect(document.querySelector<HTMLInputElement>("#plan-name")?.value).toBe("");
    expect(document.querySelector("[data-testid='plan-usual-lot']")?.textContent).toContain("Sam, Alex");
  }
  expect(document.body.textContent).not.toContain("could not be saved");
  await remountComposer();
  if (completed) expect(document.querySelector<HTMLInputElement>("#plan-name")?.value).toBe("");
  expect(document.body.textContent).not.toContain("could not be saved");
});

it("late identity resolution neither replaces a manual name nor hides its real save failure", async () => {
  pinClock();
  authSeedFixture.identityResolved = false;
  seedCompletedFiveStopIntake();
  blockStorageWrites("sessionStorage");
  await mountComposer();
  await editInput("#plan-name", "Alex");
  authSeedFixture.user = { id: "private-test-account", user_metadata: { full_name: "Sam" } };
  authSeedFixture.identityResolved = true;
  await act(async () => { root!.render(createElement(PlanComposer)); });
  await settle();
  expect(document.querySelector<HTMLInputElement>("#plan-name")?.value).toBe("Alex");
  expect(document.body.textContent).toContain("Your plan details could not be saved");
});
function rejectSessionRecordWrites(keys: string[]): void {
  const storage = sessionStorage;
  vi.stubGlobal("sessionStorage", {
    getItem: storage.getItem.bind(storage),
    setItem: (key: string, value: string) => {
      if (keys.includes(key)) throw new DOMException("Storage is full", "QuotaExceededError");
      storage.setItem(key, value);
    },
    removeItem: storage.removeItem.bind(storage), clear: storage.clear.bind(storage),
    key: storage.key.bind(storage), get length() { return storage.length; },
  } satisfies Storage);
}

it.each([
  { lane: "v1-only", routeAvailable: true },
  { lane: "v1-only", routeAvailable: false },
  { lane: "v2-only", routeAvailable: true },
  { lane: "both", routeAvailable: true },
])("retains five requested stops through $lane with route available: $routeAvailable", async ({ lane, routeAvailable }) => {
  const advance = pinClock();
  const generated = {
    ...generatedProofFixture(3), inferredContext: { ...GENERATED.inferredContext, stopCount: 5 },
    stops: [
      { venueId: "venue-a", venueName: "Pub A" }, { venueId: "venue-b", venueName: "Pub B" },
      { venueId: "venue-c", venueName: "Pub C" }, { venueId: "venue-d", venueName: "Pub D" },
      { venueId: "venue-e", venueName: "Pub E" },
    ],
  };
  fetchMock.mockImplementation(async (input) => new Response(JSON.stringify(
    String(input).includes("/api/plans/generate") ? generated : [],
  ), { status: 200, headers: { "content-type": "application/json" } }));
  if (lane === "v1-only") rejectSessionRecordWrites(["pubmax:plan-draft:v2"]);
  if (lane === "v2-only") rejectSessionRecordWrites(["pubmaxx:plan-draft:v1"]);
  rejectRouteWrites([PLAN_INTAKE_STORAGE_KEY, ...(routeAvailable ? [] : [PLAN_ROUTE_DRAFT_KEY, PLAN_ROUTE_DRAFT_V2_KEY])]);
  await mountComposer();
  await chooseFiveStops();
  await editInput("#plan-describe-first-query", "Clapham tonight");
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Plan it")!.click());
  await settle();
  await editInput("#plan-name", "Captain");
  await act(async () => { await vi.waitFor(() => expect(document.querySelectorAll(".planStop__name")).toHaveLength(5)); });
  const saved = readPlanDraftEnvelope(sessionStorage);
  expect(saved?.draft.requestedStopCount).toBe(5);
  if (lane === "v1-only") expect(saved).toMatchObject({ legacy: true, savedAt: null });
  expect(readPlanIntakeDraftWithMetadata(localStorage)).toBeNull();
  advance(1000);
  await remountComposer();
  expect(document.querySelectorAll(".planStop__name")).toHaveLength(5);
  expect(document.querySelector<HTMLInputElement>("#plan-name")?.value).toBe("Captain");
  if (lane === "v1-only") {
    expect(readPlanDraftEnvelope(sessionStorage)?.savedAt).toBeNull();
    expect(readPlanDraftEnvelope(sessionStorage)?.draft.requestedStopCountSource).toBe("picker");
    await editInput("#plan-title", "Our five pubs");
    await act(async () => { document.querySelector<HTMLFormElement>("#plan-composer")!.requestSubmit(); });
    await settle();
    expect.soft(fetchMock.mock.calls.filter(([input]) => String(input) === "/api/plans"), "Legacy freshness must remain UNKNOWN even after a title edit").toHaveLength(0);
  }
  if (!document.querySelector("#plan-context-stops")) await openTune();
  const selected = document.querySelector<HTMLSelectElement>("#plan-context-stops")?.value;
  expect.soft(selected, "Request recovery is independent of legacy route authority").toBe("5");
  advance(2000);
  if (document.querySelector("[role='dialog']")) await sortAgainFromTune();
  else {
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Make a plan")!.click());
    await settle();
  }
  const post = fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/plans/generate")).at(-1)!;
  const request = JSON.parse(String(post[1]?.body));
  const reconciled = reconciledGenerationContext();
  expect.soft(request.context.stopCount).toBe(5);
  expect(request.query).toBe("Clapham tonight");
  expect(reconciled.stopCount).toBe(5);
});

it("does not warn when unchanged restored records remain readable despite all blocked writes", async () => {
  const advance = pinClock();
  await generateProofRoute(3);
  const before = { session: readPlanDraftEnvelope(sessionStorage), intake: readPlanIntakeDraftWithMetadata(localStorage), route: localStorage.getItem(PLAN_ROUTE_DRAFT_KEY) };
  expect(before.session?.draft.routeReference).toBeDefined();
  expect(before.intake).not.toBeNull();
  blockStorageWrites("localStorage");
  blockStorageWrites("sessionStorage");
  for (let turn = 1; turn <= 2; turn += 1) {
    advance(turn * 1000);
    await remountComposer();
    expect(document.querySelectorAll(".planStop__name")).toHaveLength(3);
    expect(document.querySelector<HTMLInputElement>("#plan-name")?.value).toBe("Captain");
    expect(readPlanDraftEnvelope(sessionStorage)).toEqual(before.session);
    expect(readPlanIntakeDraftWithMetadata(localStorage)).toEqual(before.intake);
    expect(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)).toBe(before.route);
    expect.soft(document.body.textContent, "No edited value or route detail is lost").not.toContain("could not be saved");
  }
});

it.each(["title", "count"] as const)("still warns when a real %s edit cannot replace readable older records", async (field) => {
  const advance = pinClock();
  await generateProofRoute(3);
  blockStorageWrites("localStorage");
  blockStorageWrites("sessionStorage");
  advance(1000);
  if (field === "title") await editInput("#plan-title", "Our Friday");
  else {
    await openTune();
    await editTuneControl("stops", "5");
  }
  expect(document.body.textContent).toContain("could not be saved");
  await remountComposer();
  if (field === "title") expect(document.querySelector<HTMLInputElement>("#plan-title")?.value).not.toBe("Our Friday");
  else {
    await openTune();
    expect(document.querySelector<HTMLSelectElement>("#plan-context-stops")?.value).not.toBe("5");
  }
});


const cosmeticContextChoices = [
  { id: "area", value: "piccadilly-soho", context: { nightArea: "piccadilly-soho" } },
  { id: "time", value: "late_night", context: { daypart: "late_night" } },
  { id: "time", value: "daytime", context: { daypart: "daytime" } },
  { id: "time", value: "get_home", context: { daypart: "get_home" } },
  { id: "group", value: "work", context: { partyType: "work" } },
  { id: "people", value: "6", context: { groupSize: 6 } },
  { id: "people", value: "", context: { groupSize: null } },
  { id: "budget", value: "value", context: { budget: "value" } },
  { id: "budget-limit", value: "35", context: { budgetLimitPence: 3500 } },
  { id: "budget-limit", value: "", context: { budgetLimitPence: null } },
  { id: "zero-proof", value: "cocktail", context: { drinkCategory: "cocktail", zeroProof: false } },
  { id: "zero-proof", value: "zero-proof", context: { drinkCategory: null, zeroProof: true } },
  { id: "zero-proof", value: "any", context: { drinkCategory: null, zeroProof: false } },
  { id: "stops", value: "5", context: { stopCount: 5 } },
] as const;

it.each(cosmeticContextChoices.flatMap((choice) => ["title", "name"].map((cosmetic) => ({ ...choice, cosmetic }))))(
  "keeps explicit Tune $id=$value after a later cosmetic $cosmetic edit",
  async ({ id, value, context, cosmetic }) => {
    const advance = pinClock();
    const query = id === "area" ? "Tonight for 4, under £45 each, wine with friends"
      : "Clapham tonight for 4, under £45 each, wine with friends";
    const initialContext = { ...inferNightContext(query).context, nightArea: "clapham" as const, stopCount: 3 };
    expect(initialContext).toMatchObject({ groupSize: 4, budgetLimitPence: 4500, drinkCategory: "wine", zeroProof: false });
    const generated = { ...generatedProofFixture(3), inferredContext: initialContext };
    fetchMock.mockImplementation(async (input) => new Response(JSON.stringify(
      String(input).includes("/api/plans/generate") ? generated : [],
    ), { status: 200, headers: { "content-type": "application/json" } }));
    await generateFromDescription(query);
    await editInput("#plan-name", "Captain");
    await openTune();
    advance(1000);
    await editTuneControl(id, value);
    expect(JSON.parse(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)!)).toMatchObject({ explicitNightContext: context });
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    await settle();
    advance(2000);
    await editInput(cosmetic === "title" ? "#plan-title" : "#plan-name", cosmetic === "title" ? "Our next night" : "Alex");
    expect(readPlanDraftEnvelope(sessionStorage)).toMatchObject({ savedAt: "2026-11-03T12:00:02.000Z", draft: { routeReference: null } });
    expect(JSON.parse(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)!)).toMatchObject({ savedAt: "2026-11-03T12:00:01.000Z", explicitNightContext: context });
    advance(3000);
    await remountComposer();
    expect.soft(JSON.parse(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)!).savedAt,
      "A cosmetic request edit must not redate unchanged preview candidates").toBe("2026-11-03T12:00:01.000Z");
    await openTune();
    const selected = document.querySelector<HTMLInputElement | HTMLSelectElement>(`#plan-context-${id}`)?.value;
    expect.soft(selected, "A cosmetic edit must not discard an actual Tune choice").toBe(value);
    expect(readPlanDraftEnvelope(sessionStorage)?.draft.routeReference).toBeNull();
    await sortAgainFromTune();
    const reconciled = reconciledGenerationContext();
    expect(reconciled).toMatchObject(context);
  },
);

it.each(["both", "session", "intake", "neither"] as const)(
  "keeps request-owned drink choices through partial writes: %s",
  async (available) => {
    const advance = pinClock();
    const generated = { ...generatedProofFixture(3), inferredContext: inferNightContext("Clapham tonight, wine with friends").context };
    fetchMock.mockImplementation(async (input) => new Response(JSON.stringify(
      String(input).includes("/api/plans/generate") ? generated : [],
    ), { status: 200, headers: { "content-type": "application/json" } }));
    await generateFromDescription("Clapham tonight, wine with friends");
    await editInput("#plan-name", "Captain");
    await openTune();
    const session = available === "intake" || available === "neither" ? blockStorageWrites("sessionStorage") : sessionStorage;
    const local = available === "session" || available === "neither" ? blockStorageWrites("localStorage") : localStorage;
    advance(1000);
    await editTuneControl("zero-proof", "zero-proof");
    expect(document.querySelector<HTMLSelectElement>("#plan-context-zero-proof")?.value).toBe("zero-proof");
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    advance(2000);
    await editInput("#plan-title", "Our alcohol-free evening");
    const sessionInputs = readPlanDraftEnvelope(session)?.draft.explicitNightContext;
    const intakeInputs = readPlanIntakeDraftWithMetadata(local)?.explicitNightContext;
    if (available === "both" || available === "session") expect(sessionInputs).toMatchObject({ zeroProof: true, drinkCategory: null });
    if (available === "both" || available === "intake") expect(intakeInputs).toMatchObject({ zeroProof: true, drinkCategory: null });
    if (available === "neither") expect(document.body.textContent).toContain("could not be saved");
    for (let reload = 0; reload < 2; reload += 1) {
      advance(3000 + reload * 1000);
      await remountComposer();
      await openTune();
      expect(document.querySelector<HTMLSelectElement>("#plan-context-zero-proof")?.value).toBe(available === "neither" ? "wine" : "zero-proof");
      if (available !== "neither") expect(document.querySelector<HTMLButtonElement>(".planComposer__submit")?.getAttribute("aria-disabled")).toBe("true");
    }
    await sortAgainFromTune();
    expect(reconciledGenerationContext()).toMatchObject({ zeroProof: available !== "neither", drinkCategory: available === "neither" ? "wine" : null });
  },
);

it.each(["session", "intake"] as const)("does not inherit losing explicit choices when %s owns an empty map", async (winner) => {
  const advance = pinClock();
  await generateFromDescription("Clapham tonight");
  await openTune();
  advance(1000);
  await editTuneControl("zero-proof", "zero-proof");
  const session = readPlanDraftEnvelope(sessionStorage)!;
  const intake = readPlanIntakeDraftWithMetadata()!;
  advance(2000);
  if (winner === "session") {
    writePlanDraftEnvelope({ ...session.draft, explicitNightContext: {} }, "manual", sessionStorage, T0 + 2000);
    blockStorageWrites("localStorage");
  } else {
    writePlanIntakeDraft(intake.draft, localStorage, T0 + 2000, null, {});
    blockStorageWrites("sessionStorage");
  }
  for (let reload = 0; reload < 2; reload += 1) {
    await remountComposer();
    await openTune();
    expect(document.querySelector<HTMLSelectElement>("#plan-context-zero-proof")?.value).toBe("any");
  }
  await sortAgainFromTune();
  expect(reconciledGenerationContext()).toMatchObject({ zeroProof: false, drinkCategory: null });
});

it("keeps conflicting request maps UNKNOWN instead of borrowing route inputs", async () => {
  const advance = pinClock();
  await generateFromDescription("Clapham tonight");
  await openTune();
  advance(1000);
  await editTuneControl("zero-proof", "zero-proof");
  const legacy = JSON.parse(sessionStorage.getItem("pubmaxx:plan-draft:v1")!);
  legacy.explicitNightContext = {};
  sessionStorage.setItem("pubmaxx:plan-draft:v1", JSON.stringify(legacy));
  blockStorageWrites("sessionStorage");
  blockStorageWrites("localStorage");
  await remountComposer();
  await openTune();
  expect(document.querySelector<HTMLSelectElement>("#plan-context-zero-proof")?.value).toBe("any");
  expect(document.querySelector<HTMLButtonElement>(".planComposer__submit")?.getAttribute("aria-disabled")).toBe("true");
  await sortAgainFromTune();
  expect(reconciledGenerationContext()).toMatchObject({ zeroProof: false });
});


it.each(["v1-only", "v2-only"] as const)("preserves a readable explicit empty-map candidate across untouched conflicting %s reloads", async (format) => {
  const advance = pinClock();
  await generateProofRoute(3);
  await openTune();
  advance(1000);
  await editTuneControl("budget", "value");
  await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  await settle();
  const survivingKey = format === "v1-only" ? "pubmaxx:plan-draft:v1" : "pubmax:plan-draft:v2";
  rejectSessionRecordWrites([format === "v1-only" ? "pubmax:plan-draft:v2" : "pubmaxx:plan-draft:v1"]);
  rejectRouteWrites([PLAN_INTAKE_STORAGE_KEY, PLAN_ROUTE_DRAFT_KEY, PLAN_ROUTE_DRAFT_V2_KEY]);
  sessionStorage.setItem(ASK_PLAN_DRAFT_STORAGE_KEY, JSON.stringify({ query: "Clapham tonight, a treat night" }));
  advance(2000);
  await remountComposer();
  const saved = sessionStorage.getItem(survivingKey)!;
  const savedIntake = localStorage.getItem(PLAN_INTAKE_STORAGE_KEY);
  const savedOther = sessionStorage.getItem(format === "v1-only" ? "pubmax:plan-draft:v2" : "pubmaxx:plan-draft:v1");
  const envelope = JSON.parse(saved);
  const request = envelope.draft ?? envelope;
  expect(request).toMatchObject({ conciergeQuery: "Clapham tonight, a treat night", explicitNightContext: {}, routeReference: null });
  expect(Object.hasOwn(request, "explicitNightContext")).toBe(true);
  for (let turn = 3; turn <= 4; turn += 1) {
    advance(turn * 1000);
    await remountComposer();
    const remaining = JSON.parse(sessionStorage.getItem(survivingKey)!);
    expect.soft(sessionStorage.getItem(survivingKey), "An untouched ambiguous reload must preserve its readable input candidate and writer date").toBe(saved);
    const current = remaining.draft ?? remaining;
    expect.soft(Object.hasOwn(current, "explicitNightContext"), "Known empty input metadata must not become absence through a copy").toBe(true);
    expect.soft(current.explicitNightContext).toEqual({});
    expect(localStorage.getItem(PLAN_INTAKE_STORAGE_KEY)).toBe(savedIntake);
    expect(sessionStorage.getItem(format === "v1-only" ? "pubmax:plan-draft:v2" : "pubmaxx:plan-draft:v1")).toBe(savedOther);
  }
});


function seedCorrelatedLegacyWizardRequest(): string {
  const base = skipRemainingPlanIntake(createPlanIntakeDraft());
  const intake = { ...base, skippedSteps: [], answers: {
    ...base.answers, area: "clapham" as const, timeWindow: "evening" as const,
    exactStartIso: "2026-11-03T19:00:00.000Z", groupSize: 6,
    stopCount: 3 as const, stopCountSource: "picker" as const,
    budget: "value" as const, budgetLimitPence: 3500, accessibilityNeeds: ["step-free" as const],
  } };
  expect(writePlanIntakeDraft(intake, localStorage, T0, null)).toBe(true);
  const stops = [
    { key: 1, venueId: "venue-a", venueName: "Pub A" },
    { key: 2, venueId: "venue-b", venueName: "Pub B" },
    { key: 3, venueId: "venue-c", venueName: "Pub C" },
  ];
  writePlanDraftEnvelope({ title: "Legacy night", creatorName: "Captain", startTime: START, conciergeQuery: "", stops,
    requestedStopCount: 3, requestedStopCountSource: "picker", routeReference: null,
  }, "manual", sessionStorage, T0);
  const context = { ...inferNightContext("Clapham tonight").context, stopCount: 3, groupSize: 6,
    budget: "value", budgetLimitPence: 3500, accessibility: ["step-free"], zeroProof: true, drinkCategory: null };
  localStorage.setItem(PLAN_ROUTE_DRAFT_KEY, JSON.stringify({
    savedAt: new Date(T0).toISOString(), stops: stops.map((stop) => ({ ...stop, alternatives: [] })),
    nightContext: context, explicitNightContext: { zeroProof: true, drinkCategory: null },
    routeNight: { nightArea: "clapham", daypart: "evening" }, routeRevision: 1,
    routeStale: true, groundingProof: null, createOperationKey: null, planAnchor: null,
  }));
  const intakeRecord = localStorage.getItem(PLAN_INTAKE_STORAGE_KEY);
  return intakeRecord!;
}

async function expectLegacyWizardGenerationInputs(): Promise<void> {
  await sortAgainFromTune();
  const post = fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/plans/generate")).at(-1)!;
  const request = JSON.parse(String(post[1]?.body));
  const reconciled = reconciledGenerationContext();
  expect.soft(request.intake).toMatchObject({ groupSize: 6, accessibilityNeeds: ["step-free"],
    area: { kind: "night-patch", id: "clapham" },
    timeWindow: { id: "evening", exactStartIso: "2026-11-03T19:00:00.000Z" },
    budget: { tier: "value", limitPence: 3500 },
  });
  expect(reconciled).toMatchObject({ groupSize: 6, accessibility: ["step-free"], budget: "value", budgetLimitPence: 3500, zeroProof: true });
}

it("preserves correlated legacy wizard answers when only Session receives the migrated map", async () => {
  const advance = pinClock();
  const intakeRecord = seedCorrelatedLegacyWizardRequest();
  expect(readPlanDraftEnvelope(sessionStorage)?.draft.explicitNightContext).toBeUndefined();
  expect(readPlanIntakeDraftWithMetadata(localStorage)?.explicitNightContext).toBeUndefined();
  blockStorageWrites("localStorage");
  await mountComposer();
  await openTune();
  expect(document.querySelector<HTMLInputElement>("#plan-context-people")?.value).toBe("6");
  advance(1000);
  await remountComposer();
  await openTune();
  expect(document.querySelector<HTMLInputElement>("#plan-context-people")?.value).toBe("6");
  expect(localStorage.getItem(PLAN_INTAKE_STORAGE_KEY)).toBe(intakeRecord);
  await expectLegacyWizardGenerationInputs();
});


it.each(["title", "name"] as const)("preserves every legacy wizard input after a real cosmetic %s edit with local writes blocked", async (field) => {
  const advance = pinClock();
  const intakeRecord = seedCorrelatedLegacyWizardRequest();
  blockStorageWrites("localStorage");
  await mountComposer();
  advance(1000);
  await editInput(field === "title" ? "#plan-title" : "#plan-name", field === "title" ? "Our next night" : "Alex");
  expect(readPlanDraftEnvelope(sessionStorage)?.savedAt).toBe("2026-11-03T12:00:01.000Z");
  advance(2000);
  await remountComposer();
  await openTune();
  expect.soft(document.querySelector<HTMLInputElement>("#plan-context-people")?.value).toBe("6");
  expect(localStorage.getItem(PLAN_INTAKE_STORAGE_KEY)).toBe(intakeRecord);
  await expectLegacyWizardGenerationInputs();
});


it.each([false, true])("preserves Session-only wizard step state and inputs, reopened: %s", async (reopened) => {
  const advance = pinClock();
  seedCorrelatedLegacyWizardRequest();
  const intake = readPlanIntakeDraftWithMetadata(localStorage)!.draft;
  const requestIntake = reopened ? reopenPlanIntakeStep(intake, "group-size") : intake;
  const draft = readPlanDraftEnvelope(sessionStorage)!.draft;
  expect(writePlanDraftEnvelope({ ...draft, requestIntake,
    explicitNightContext: { zeroProof: true, drinkCategory: null },
  }, "manual", sessionStorage, T0)).toMatchObject({ v1: true, v2: true });
  const before = readPlanDraftEnvelope(sessionStorage)!;
  expect(before.draft.requestIntake?.answers.groupSize).toBe(6);
  localStorage.removeItem(PLAN_INTAKE_STORAGE_KEY);
  blockStorageWrites("localStorage");
  for (let turn = 0; turn <= 1; turn += 1) {
    advance(turn * 1000);
    if (turn === 0) await mountComposer();
    else await remountComposer();
    const stored = readPlanDraftEnvelope(sessionStorage)!;
    expect.soft(stored.draft.requestIntake, "The saved input must retain its own valid step state and answers").toEqual(before.draft.requestIntake);
    expect.soft(stored.savedAt, "Restoring the same input is not a new edit").toBe(before.savedAt);
  }
  await openTune();
  expect.soft(document.querySelector<HTMLInputElement>("#plan-context-people")?.value).toBe("6");
  await expectLegacyWizardGenerationInputs();
});


it.each(["v1", "v2"].flatMap((format) => ["title", "name"].map((field) => ({ format, field }))))(
  "restores a genuine $field edit and wizard inputs from only readable $format",
  async ({ format, field }) => {
    const advance = pinClock();
    seedCorrelatedLegacyWizardRequest();
    blockStorageWrites("localStorage");
    const survivingKey = format === "v1" ? "pubmaxx:plan-draft:v1" : "pubmax:plan-draft:v2";
    const blockedKey = format === "v1" ? "pubmax:plan-draft:v2" : "pubmaxx:plan-draft:v1";
    rejectSessionRecordWrites([blockedKey]);
    await mountComposer();
    advance(1000);
    const value = field === "title" ? "Our next night" : "Alex";
    await editInput(field === "title" ? "#plan-title" : "#plan-name", value);
    const written = JSON.parse(sessionStorage.getItem(survivingKey)!);
    const storedDraft = written.draft ?? written;
    expect(storedDraft.requestIntake.answers.groupSize).toBe(6);
    expect(storedDraft[field === "title" ? "title" : "creatorName"]).toBe(value);
    sessionStorage.removeItem(blockedKey);
    localStorage.removeItem(PLAN_INTAKE_STORAGE_KEY);
    advance(2000);
    await remountComposer();
    const remaining = readPlanDraftEnvelope(sessionStorage)!;
    if (format === "v1") {
      expect(remaining.legacy).toBe(true);
      expect(remaining.savedAt).toBeNull();
    }
    await attemptRouteSave();
    await openTune();
    expect.soft(document.querySelector<HTMLInputElement>("#plan-context-people")?.value).toBe("6");
    await expectLegacyWizardGenerationInputs();
  },
);


function seedReadableBlankHostRequest(): void {
  seedCorrelatedLegacyWizardRequest();
  const intake = readPlanIntakeDraftWithMetadata(localStorage)!.draft;
  const context = { ...inferNightContext("Clapham tonight").context, stopCount: 3, groupSize: 6,
    budget: "value" as const, budgetLimitPence: 3500, accessibility: ["step-free"], zeroProof: false, drinkCategory: null };
  const generated = { ...generatedProofFixture(3), inferredContext: context };
  expect(transferGeneratedRouteToDraft(generated, localStorage, "plan-generated", T0)).toBe(true);
  const reference = { savedAt: new Date(T0).toISOString(), operationKey: generated.operationKey };
  const draft = readPlanDraftEnvelope(sessionStorage)!.draft;
  expect(writePlanDraftEnvelope({ ...draft, creatorName: "", requestIntake: intake, explicitNightContext: {}, routeReference: reference },
    "manual", sessionStorage, T0)).toMatchObject({ v1: true, v2: true });
  expect(writePlanIntakeDraft(intake, localStorage, T0, reference, {})).toBe(true);
}

it("keeps a newer intake written during a passive clock lookup", async () => {
  const advance = pinClock();
  authSeedFixture.identityResolved = false;
  seedReadableBlankHostRequest();
  await mountComposer();
  const local = localStorage;
  const original = readPlanIntakeDraftWithMetadata(local)!;
  const expired = JSON.stringify({ ...JSON.parse(local.getItem(PLAN_INTAKE_STORAGE_KEY)!),
    savedAt: "2026-11-01T12:00:00.000Z", expiresAt: "2026-11-02T12:00:00.000Z" });
  const replacement = { ...original.draft, answers: { ...original.draft.answers, stopCount: 5 as const } };
  let interleavedBytes: string | null = null;
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => {
      if (key === PLAN_INTAKE_STORAGE_KEY && interleavedBytes === null) {
        expect(writePlanIntakeDraft(replacement, local, T0 + 1000)).toBe(true);
        interleavedBytes = local.getItem(key);
        return expired;
      }
      return local.getItem(key);
    },
    setItem: local.setItem.bind(local), removeItem: local.removeItem.bind(local), clear: local.clear.bind(local),
    key: local.key.bind(local), get length() { return local.length; },
  } satisfies Storage);
  advance(2000);
  seedAutomaticName("account-full-name");
  authSeedFixture.identityResolved = true;
  await act(async () => { root!.render(createElement(PlanComposer)); });
  await settle();
  expect(document.querySelector<HTMLInputElement>("#plan-name")?.value).toBe("Sam");
  expect(interleavedBytes).not.toBeNull();
  expect(local.getItem(PLAN_INTAKE_STORAGE_KEY)).toBe(interleavedBytes);
  expect(readPlanIntakeDraftWithMetadata(local)).toMatchObject({
    savedAt: "2026-11-03T12:00:01.000Z", draft: { answers: { stopCount: 5 } },
  });
});

it.each(["account-full-name", "remembered-host"] as const)(
  "keeps the partial description warning through late $source and a successful retry",
  async (source) => {
    const advance = pinClock();
    authSeedFixture.identityResolved = false;
    seedReadableBlankHostRequest();
    const query = "Quiet in Clapham tonight";
    const draft = readPlanDraftEnvelope(sessionStorage)!.draft;
    expect(writePlanDraftEnvelope({ ...draft, conciergeQuery: query }, "manual", sessionStorage, T0))
      .toMatchObject({ v1: true, v2: true });
    const oldSession = sessionStorage.getItem(PLAN_DRAFT_V2_KEY);
    const writableSession = blockStorageWrites("sessionStorage");
    await mountComposer();
    await openTune();
    expect(document.querySelector<HTMLInputElement>("#plan-name")?.value).toBe("");
    expect(document.querySelector<HTMLInputElement>("#plan-concierge-query")?.value).toBe(query);

    advance(1000);
    await editTuneControl("stops", "5");
    expect(readPlanIntakeDraftWithMetadata(localStorage)?.draft.answers).toMatchObject({ stopCount: 5, stopCountSource: "picker" });
    const warning = "Your description could not be saved";
    expect(document.body.textContent).toContain(warning);

    advance(2000);
    seedAutomaticName(source);
    authSeedFixture.identityResolved = true;
    await act(async () => { root!.render(createElement(PlanComposer)); });
    await settle();
    expect(document.querySelector<HTMLInputElement>("#plan-name")?.value).toBe("Sam");
    expect(document.querySelector<HTMLInputElement>("#plan-concierge-query")?.value).toBe(query);
    expect(document.body.textContent).toContain(warning);
    expect(sessionStorage.getItem(PLAN_DRAFT_V2_KEY)).toBe(oldSession);
    expect(readPlanIntakeDraftWithMetadata(localStorage)?.savedAt).toBe("2026-11-03T12:00:01.000Z");

    vi.stubGlobal("sessionStorage", writableSession);
    advance(3000);
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    await settle();
    await editInput("#plan-title", "Our next night");
    expect(readPlanDraftEnvelope(sessionStorage)).toMatchObject({
      savedAt: "2026-11-03T12:00:03.000Z",
      draft: { title: "Our next night", creatorName: "", conciergeQuery: query,
        requestedStopCount: 5, requestedStopCountSource: "picker" },
    });
    expect(document.body.textContent).not.toContain("could not be saved");
    advance(4000);
    await remountComposer();
    if (!document.querySelector("#plan-context-stops")) await openTune();
    expect(document.querySelector<HTMLSelectElement>("#plan-context-stops")?.value).toBe("5");
    expect(document.querySelector<HTMLInputElement>("#plan-concierge-query")?.value).toBe(query);
    expect(document.body.textContent).not.toContain("could not be saved");
  },
);

it.each(["account", "remembered"].flatMap((seed) => ["title", "description"].flatMap((field) => [false, true].map((sessionFails) => ({ seed, field, sessionFails })))))(
  "retains request save truth after $seed name adoption for $field, Session writes fail: $sessionFails",
  async ({ seed, field, sessionFails }) => {
    const advance = pinClock();
    authSeedFixture.identityResolved = false;
    seedReadableBlankHostRequest();
    if (seed === "account") authSeedFixture.user = { id: "private-test-account", user_metadata: { full_name: "Sam" } };
    else rememberPlanHostName(localStorage, "Sam");
    blockStorageWrites("localStorage");
    if (sessionFails) blockStorageWrites("sessionStorage");
    await mountComposer();
    expect(document.querySelector<HTMLInputElement>("#plan-name")?.value).toBe("");
    expect(document.body.textContent).not.toContain("could not be saved");
    if (field === "description") await openTune();
    advance(1000);
    await editInput(field === "title" ? "#plan-title" : "#plan-concierge-query", field === "title" ? "Our next night" : "Quiet in Clapham tonight");
    if (sessionFails) expect(document.body.textContent).toContain("could not be saved");
    else {
      expect(document.body.textContent).not.toContain("could not be saved");
      expect(readPlanDraftEnvelope(sessionStorage)?.savedAt).toBe("2026-11-03T12:00:01.000Z");
    }
    advance(2000);
    authSeedFixture.identityResolved = true;
    await act(async () => { root!.render(createElement(PlanComposer)); });
    await settle();
    expect(document.querySelector<HTMLInputElement>("#plan-name")?.value).toBe("Sam");
    const saved = readPlanDraftEnvelope(sessionStorage)!;
    if (sessionFails) {
      expect(document.body.textContent, "The real edit is still unsaved after automatic name adoption").toContain("could not be saved");
      expect(saved.draft[field === "title" ? "title" : "conciergeQuery"]).not.toBe(field === "title" ? "Our next night" : "Quiet in Clapham tonight");
    } else {
      expect(document.body.textContent).not.toContain("could not be saved");
      expect(saved.savedAt, "An automatic name is not a new edit and cannot refresh or backdate the saved request").toBe("2026-11-03T12:00:01.000Z");
    }
  },
);

it.each(["account", "remembered"].flatMap((seed) => ["title", "description"].map((field) => ({ seed, field }))))(
  "clears a genuine save failure after a later persisted $field edit with $seed name adoption",
  async ({ seed, field }) => {
    const advance = pinClock();
    authSeedFixture.identityResolved = false;
    seedReadableBlankHostRequest();
    if (seed === "account") authSeedFixture.user = { id: "private-test-account", user_metadata: { full_name: "Sam" } };
    else rememberPlanHostName(localStorage, "Sam");
    blockStorageWrites("localStorage");
    const writableSession = blockStorageWrites("sessionStorage");
    await mountComposer();
    if (field === "description") await openTune();
    advance(1000);
    const selector = field === "title" ? "#plan-title" : "#plan-concierge-query";
    await editInput(selector, field === "title" ? "Our next night" : "Quiet in Clapham tonight");
    expect(document.body.textContent).toContain("could not be saved");
    advance(2000);
    authSeedFixture.identityResolved = true;
    await act(async () => { root!.render(createElement(PlanComposer)); });
    await settle();
    expect(document.querySelector<HTMLInputElement>("#plan-name")?.value).toBe("Sam");
    vi.stubGlobal("sessionStorage", writableSession);
    advance(3000);
    const finalValue = field === "title" ? "Our Friday night" : "Quiet in Clapham after work";
    await editInput(selector, finalValue);
    expect(readPlanDraftEnvelope(sessionStorage)?.draft[field === "title" ? "title" : "conciergeQuery"]).toBe(finalValue);
    expect(readPlanDraftEnvelope(sessionStorage)?.savedAt).toBe("2026-11-03T12:00:03.000Z");
    expect(document.body.textContent).not.toContain("could not be saved");
    await remountComposer();
    if (field === "description") await openTune();
    expect(document.querySelector<HTMLInputElement>(selector)?.value).toBe(finalValue);
    expect(document.body.textContent).not.toContain("could not be saved");
  },
);

it.each([false, true])("retains Session-only wizard progress without a route, reopened: %s", async (reopened) => {
  pinClock();
  seedCorrelatedLegacyWizardRequest();
  const intake = readPlanIntakeDraftWithMetadata()!.draft;
  const requestIntake = reopened ? reopenPlanIntakeStep(intake, "group-size") : intake;
  const draft = readPlanDraftEnvelope(sessionStorage)!.draft;
  expect(writePlanDraftEnvelope({ ...draft, stops: [{ key: 1, venueId: "", venueName: "" }], requestIntake }, "manual", sessionStorage, T0))
    .toMatchObject({ v1: true, v2: true });
  localStorage.clear();
  blockStorageWrites("localStorage");
  await mountComposer();
  for (let turn = 0; turn < 2; turn += 1) {
    await remountComposer();
    expect(readPlanDraftEnvelope(sessionStorage)?.draft.requestIntake).toEqual(requestIntake);
    expect(readPlanDraftEnvelope(sessionStorage)?.savedAt).toBe("2026-11-03T12:00:00.000Z");
    expect(document.querySelector<HTMLInputElement>("#plan-describe-first-query")).toBeNull();
  }
});

it.each(["account", "remembered"].flatMap((seed) => ["title", "description"].map((field) => ({ seed, field }))))(
  "keeps a saved $field edit readable after blocked automatic $seed name persistence",
  async ({ seed, field }) => {
    const advance = pinClock();
    authSeedFixture.identityResolved = false;
    seedReadableBlankHostRequest();
    if (seed === "account") authSeedFixture.user = { id: "private-test-account", user_metadata: { full_name: "Sam" } };
    else rememberPlanHostName(localStorage, "Sam");
    blockStorageWrites("localStorage");
    await mountComposer();
    if (field === "description") await openTune();
    advance(1000);
    await editInput(field === "title" ? "#plan-title" : "#plan-concierge-query", field === "title" ? "Our next night" : "Quiet in Clapham tonight");
    expect(readPlanDraftEnvelope(sessionStorage)?.savedAt).toBe("2026-11-03T12:00:01.000Z");
    blockStorageWrites("sessionStorage");
    advance(2000);
    authSeedFixture.identityResolved = true;
    await act(async () => { root!.render(createElement(PlanComposer)); });
    await settle();
    expect(document.querySelector<HTMLInputElement>("#plan-name")?.value).toBe("Sam");
    expect(document.body.textContent).not.toContain("could not be saved");
    expect(readPlanDraftEnvelope(sessionStorage)?.savedAt).toBe("2026-11-03T12:00:01.000Z");
    await remountComposer();
    if (field === "description") await openTune();
    expect(document.querySelector<HTMLInputElement>(field === "title" ? "#plan-title" : "#plan-concierge-query")?.value)
      .toBe(field === "title" ? "Our next night" : "Quiet in Clapham tonight");
  },
);

it.each(([3, 5] as const).flatMap((stopCount) => (["none", "title", "description"] as const).map((field) => ({ stopCount, field }))))(
  "retains accepted generation after an actual request edit round trip: $field / $stopCount stops",
  async ({ field, stopCount }) => {
    const advance = pinClock();
    seedReadableBlankHostRequest();
    const base = readPlanDraftEnvelope(sessionStorage)!;
    const context = { ...inferNightContext("Clapham tonight").context, stopCount, groupSize: 6,
      budget: "value" as const, budgetLimitPence: 3500, accessibility: ["step-free"], zeroProof: false, drinkCategory: null };
    const original = { ...generatedProofFixture(3), inferredContext: context,
      stops: [...generatedProofFixture(3).stops, ...(stopCount === 5 ? [
        { venueId: "venue-d", venueName: "Pub D" }, { venueId: "venue-e", venueName: "Pub E" },
      ] : [])] };
    const requestIntake = { ...base.draft.requestIntake!, answers: { ...base.draft.requestIntake!.answers, stopCount } };
    expect(transferGeneratedRouteToDraft(original, localStorage, "plan-generated", T0)).toBe(true);
    expect(writePlanDraftEnvelope({ ...base.draft, creatorName: "Captain", requestedStopCount: stopCount,
      requestedStopCountSource: "picker", requestIntake,
      stops: original.stops.map((stop, index) => ({ key: index + 1, ...stop })),
    }, "manual", sessionStorage, T0)).toMatchObject({ v1: true, v2: true });
    expect(writePlanIntakeDraft(requestIntake, localStorage, T0, base.draft.routeReference, {})).toBe(true);
    const initial = readPlanDraftEnvelope(sessionStorage)!;
    const replacement = { ...original,
      operationKey: "request-round-trip-generation", groundingProof: generatedProofFixture(3).groundingProof.replace("test-only-signature", "round-trip-private-signature") };
    fetchMock.mockImplementation(async (input) => new Response(JSON.stringify(
      String(input).includes("/api/plans/generate") ? replacement : [],
    ), { status: 200, headers: { "content-type": "application/json" } }));
    await mountComposer();
    if (field === "title") {
      advance(1000);
      await editInput("#plan-title", "Our next night");
      advance(2000);
      await editInput("#plan-title", initial.draft.title);
    }
    await openTune();
    if (field === "description") {
      advance(1000);
      await editInput("#plan-concierge-query", "Quiet in Clapham tonight");
      advance(2000);
      await editInput("#plan-concierge-query", initial.draft.conciergeQuery);
    }
    advance(3000);
    await sortAgainFromTune();
    const accepted = JSON.parse(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)!);
    const saved = readPlanDraftEnvelope(sessionStorage)!;
    expect(accepted).toMatchObject({ savedAt: "2026-11-03T12:00:03.000Z", createOperationKey: replacement.operationKey, groundingProof: replacement.groundingProof });
    expect(saved.draft.routeReference).toEqual({ savedAt: accepted.savedAt, operationKey: replacement.operationKey });
    expect.soft(Date.parse(saved.savedAt!), "A request binding cannot predate its newly accepted generation").toBeGreaterThanOrEqual(Date.parse(accepted.savedAt));
    expect(readPlanIntakeDraftWithMetadata()?.savedAt).toBe(saved.savedAt);
    advance(4000);
    await remountComposer();
    expect(document.querySelectorAll(".planStop__name")).toHaveLength(stopCount);
    expect.soft(document.querySelector<HTMLInputElement>("#plan-title")?.value, "Accepting a new generation must preserve the owning request title").toBe(initial.draft.title);
    expect.soft(document.querySelector<HTMLInputElement>("#plan-name")?.value, "Accepting a new generation must preserve its request host").toBe("Captain");
    expect.soft(readPlanDraftEnvelope(sessionStorage)?.draft.requestIntake, "Reload must retain the actual inputs that own the accepted generation").toEqual(initial.draft.requestIntake);
    expect((await saveRoute()).groundingProof).toBe(replacement.groundingProof);
    await openTune();
    expect(document.querySelector<HTMLSelectElement>("#plan-context-stops")?.value).toBe(String(stopCount));
    advance(5000);
    await sortAgainFromTune();
    expect(reconciledGenerationContext().stopCount, "The real parser/reconciler must receive the same requested count after accepted-route recovery").toBe(stopCount);
  },
);

it.each(automaticNameSources.flatMap((source) => [false, true].map((blocked) => ({ source, blocked }))))(
  "reports an explicit return to automatic $source name when writes are blocked: $blocked",
  async ({ source, blocked }) => {
    const advance = pinClock();
    seedReadableBlankHostRequest();
    seedAutomaticName(source);
    await mountComposer();
    expect(document.querySelector<HTMLInputElement>("#plan-name")?.value).toBe("Sam");
    advance(1000);
    await editInput("#plan-name", "Bob");
    expect(readPlanDraftEnvelope(sessionStorage)?.draft.creatorName).toBe("Bob");
    expect(document.body.textContent).not.toContain("could not be saved");
    if (blocked) {
      blockStorageWrites("localStorage");
      blockStorageWrites("sessionStorage");
    }
    advance(2000);
    await editInput("#plan-name", "Sam");
    expect(document.querySelector<HTMLInputElement>("#plan-name")?.value).toBe("Sam");
    const saved = readPlanDraftEnvelope(sessionStorage)!;
    expect(saved.draft.creatorName).toBe(blocked ? "Bob" : "Sam");
    expect.soft(document.body.textContent?.includes("could not be saved"), "An explicit name choice must warn exactly when readable records cannot restore it").toBe(blocked);
    advance(3000);
    await remountComposer();
    expect(document.querySelector<HTMLInputElement>("#plan-name")?.value).toBe(blocked ? "Bob" : "Sam");
    expect(document.body.textContent).not.toContain("could not be saved");
  },
);

const SOHO_REQUEST = "Quiet in Soho for 4 today at 19:00";
const REQUEST_FIELDS = "#plan-describe-first-query, #plan-concierge-query";

function action(label: string): HTMLButtonElement {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((candidate) => candidate.textContent?.trim() === label);
  expect(button, label).toBeDefined();
  return button!;
}

function expectRequestField(selector: string, value: string, generationLabel: string): void {
  expect(document.querySelectorAll(REQUEST_FIELDS)).toHaveLength(1);
  expect(document.querySelector<HTMLInputElement>(selector)?.value).toBe(value);
  expect([...document.querySelectorAll("button")].filter((button) =>
    ["Plan it", "Make a plan", "Plan it again", "Regenerate route"].includes(button.textContent?.trim() ?? ""),
  ).map((button) => button.textContent?.trim())).toEqual([generationLabel]);
  expect(document.querySelector("[data-result]")).toBeNull();
  expect(document.querySelector(".planComposer__routeStale")).toBeNull();
}

it("keeps a typed description and two selected stops with the original expiry after reload", async () => {
  const advance = pinClock();
  await mountComposer();
  await editInput("#plan-describe-first-query", SOHO_REQUEST);
  expect(readPlanDraftEnvelope(sessionStorage)?.draft).toMatchObject({ conciergeQuery: SOHO_REQUEST, stops: [] });
  advance(1000);
  await act(async () => action("2").click());
  await settle();
  const before = readPlanDraftEnvelope(sessionStorage)!;
  const raw = sessionStorage.getItem(PLAN_DRAFT_V2_KEY);
  const intake = localStorage.getItem(PLAN_INTAKE_STORAGE_KEY);
  expect(before.draft).toMatchObject({ requestedStopCount: 2, requestedStopCountSource: "picker" });
  expect(document.body.textContent).not.toContain("could not be saved");

  advance(5000);
  await remountComposer();
  expectRequestField("#plan-describe-first-query", SOHO_REQUEST, "Plan it");
  expect(action("2").getAttribute("aria-pressed")).toBe("true");
  expect(readPlanDraftEnvelope(sessionStorage)).toEqual(before);
  expect(sessionStorage.getItem(PLAN_DRAFT_V2_KEY)).toBe(raw);
  expect(localStorage.getItem(PLAN_INTAKE_STORAGE_KEY)).toBe(intake);
  expect(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)).toBeNull();
  expect(localStorage.getItem(PLAN_ROUTE_DRAFT_V2_KEY)).toBeNull();
});

it("does not interpret a saved remembered-area seed as a wizard choice", async () => {
  pinClock();
  const area = { kind: "patch", id: "soho" } as const;
  writeRememberedArea(area);
  const seeded = createPlanIntakeDraft(area);
  expect(writePlanIntakeDraft(seeded, localStorage, T0)).toBe(true);
  await mountComposer();
  expectRequestField("#plan-describe-first-query", "", "Plan it");
  expect(readPlanDraftEnvelope(sessionStorage)).toBeNull();
  expect(readPlanIntakeDraftWithMetadata(localStorage)?.draft).toEqual(seeded);
});

it("remembers an explicit wizard opening over the same area seed", async () => {
  const advance = pinClock();
  const area = { kind: "patch", id: "soho" } as const;
  writeRememberedArea(area);
  expect(writePlanIntakeDraft(createPlanIntakeDraft(area), localStorage, T0)).toBe(true);
  await mountComposer();
  await editInput("#plan-describe-first-query", SOHO_REQUEST);
  advance(1000);
  await act(async () => action("Step by step").click());
  await settle();
  expect(readPlanDraftEnvelope(sessionStorage)?.draft.entryMode).toBe("wizard");
  advance(2000);
  await remountComposer();
  expect(document.querySelector(REQUEST_FIELDS)).toBeNull();
  expect(document.querySelector(".planIntake__count")?.textContent).toBe("Step 2 of 5");
  await act(async () => action("Describe instead").click());
  await settle();
  expectRequestField("#plan-concierge-query", SOHO_REQUEST, "Make a plan");
});

it.each(["account-handle", "remembered-host"] as const)("keeps an automatic %s out of a request and does not warn for a locally saved count", async (source) => {
  pinClock();
  seedAutomaticName(source);
  blockStorageWrites("sessionStorage");
  await mountComposer();
  await chooseFiveStops();
  expect(readPlanIntakeDraftWithMetadata(localStorage)?.draft.answers.stopCount).toBe(5);
  expect(readPlanDraftEnvelope(sessionStorage)).toBeNull();
  expect(document.body.textContent).not.toContain("could not be saved");
});

it.each(["account-handle", "remembered-host"] as const)("does not own an automatic %s name in a typed request", async (source) => {
  pinClock();
  seedAutomaticName(source);
  await mountComposer();
  await editInput("#plan-describe-first-query", SOHO_REQUEST);
  expect(readPlanDraftEnvelope(sessionStorage)?.draft).toMatchObject({ creatorName: "", conciergeQuery: SOHO_REQUEST });
  expect(sessionStorage.getItem(PLAN_DRAFT_KEY)).not.toContain("Sam");
  expect(sessionStorage.getItem(PLAN_DRAFT_V2_KEY)).not.toContain("Sam");
});

it("does not carry an automatic host name to the next account when the request is reopened", async () => {
  pinClock();
  seedAutomaticName("account-handle");
  await mountComposer();
  await editInput("#plan-describe-first-query", SOHO_REQUEST);
  authSeedFixture.user = { id: "other-test-account" };
  authSeedFixture.handle = "Alex";
  await remountComposer();
  await act(async () => action("Step by step").click());
  await settle();
  await act(async () => action("Describe instead").click());
  await settle();
  expect(document.querySelector<HTMLInputElement>("#plan-name")?.value).toBe("Alex");
  expect(document.querySelector<HTMLInputElement>("#plan-concierge-query")?.value).toBe(SOHO_REQUEST);
  expect(readPlanDraftEnvelope(sessionStorage)?.draft.creatorName).toBe("");
});

const CLEAR_REQUEST = { title: "Night", creatorName: "", startTime: START, conciergeQuery: "", stops: [], routeReference: null };

it.each([PLAN_DRAFT_KEY, PLAN_DRAFT_V2_KEY])("preserves both route records after a clear with %s blocked", async (blockedKey) => {
  const advance = pinClock();
  seedTuneRoute("plan-generated");
  const routeV1 = localStorage.getItem(PLAN_ROUTE_DRAFT_KEY);
  const routeV2 = localStorage.getItem(PLAN_ROUTE_DRAFT_V2_KEY);
  const old = { ...CLEAR_REQUEST, conciergeQuery: "Old route", stops: [{ key: 1, venueId: "venue-a", venueName: "Pub A" }],
    routeReference: { savedAt: new Date(T0).toISOString(), operationKey: "handoff-operation" } };
  expect(writePlanDraftEnvelope(old, "manual", sessionStorage, T0)).toMatchObject({ v1: true, v2: true });
  rejectSessionRecordWrites([blockedKey]);
  advance(1000);
  expect(writePlanDraftEnvelope(CLEAR_REQUEST, "manual", sessionStorage, T0 + 1000)).toMatchObject({
    v1: blockedKey !== PLAN_DRAFT_KEY, v2: blockedKey !== PLAN_DRAFT_V2_KEY,
  });
  const sessionV1 = sessionStorage.getItem(PLAN_DRAFT_KEY);
  const sessionV2 = sessionStorage.getItem(PLAN_DRAFT_V2_KEY);
  advance(2000);
  await mountComposer();
  expectRequestField("#plan-describe-first-query", "", "Plan it");
  expect(document.body.textContent).not.toContain("Pub A");
  expect(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)).toBe(routeV1);
  expect(localStorage.getItem(PLAN_ROUTE_DRAFT_V2_KEY)).toBe(routeV2);
  expect(sessionStorage.getItem(PLAN_DRAFT_KEY)).toBe(sessionV1);
  expect(sessionStorage.getItem(PLAN_DRAFT_V2_KEY)).toBe(sessionV2);
});

it("allows only a later Manchester acceptance when the hidden route copies really conflict", async () => {
  const advance = pinClock();
  seedTuneRoute("plan-generated");
  const legacy = JSON.parse(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)!);
  delete legacy.savedAt;
  const routeV1 = JSON.stringify(legacy);
  const accepted = { source: "near", cityId: "manchester", acceptedVenueId: "venue-mcr-1lwo5lo",
    acceptedArea: null, startsAt: null, displayEvidence: { kind: "directory", observedAt: null },
  } as const;
  expect(writePlanningIntent(accepted, { storage: sessionStorage, now: T0 })).not.toBeNull();
  advance(1000);
  expect(transferGeneratedRouteToDraft({ ...generatedProofFixture(3), operationKey: "conflicting-operation" },
    localStorage, "plan-generated", T0 + 1000)).toBe(true);
  localStorage.setItem(PLAN_ROUTE_DRAFT_KEY, routeV1);
  const routeV2 = localStorage.getItem(PLAN_ROUTE_DRAFT_V2_KEY);
  expect(reconcilePlanRouteDrafts(routeV2, routeV1, T0 + 1000)).toMatchObject({ conflicting: true, ambiguous: true });
  rejectSessionRecordWrites([PLAN_DRAFT_V2_KEY]);
  expect(writePlanDraftEnvelope(CLEAR_REQUEST, "manual", sessionStorage, T0 + 1000)).toMatchObject({ v1: true, v2: false });

  await mountComposer();
  expectRequestField("#plan-describe-first-query", "", "Plan it");
  expect(document.querySelector("[aria-label='Accepted plan context']")).toBeNull();

  advance(2000);
  expect(writePlanningIntent(accepted, { storage: sessionStorage, now: T0 + 2000 })).not.toBeNull();
  await remountComposer();
  expectRequestField("#plan-concierge-query", "", "Make a plan");
  expect(document.querySelector("[aria-label='Accepted plan context']")).not.toBeNull();
  expect(fetchMock.mock.calls.some(([input]) => String(input) === "/data/cities/manchester/venues_slim.json")).toBe(true);
  expect(document.body.textContent).not.toContain("Pub A");
  expect(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)).toBe(routeV1);
  expect(localStorage.getItem(PLAN_ROUTE_DRAFT_V2_KEY)).toBe(routeV2);
});

it("keeps an untouched revocation and can then generate a new route", async () => {
  const advance = pinClock();
  seedTuneRoute("plan-generated");
  const routeV1 = localStorage.getItem(PLAN_ROUTE_DRAFT_KEY);
  advance(1000);
  expect(writePlanDraftEnvelope(CLEAR_REQUEST, "manual", sessionStorage, T0 + 1000)).toMatchObject({ v1: true, v2: true });
  advance(2000);
  await mountComposer();
  expectRequestField("#plan-describe-first-query", "", "Plan it");
  expect(readPlanDraftEnvelope(sessionStorage)).toMatchObject({
    savedAt: new Date(T0 + 1000).toISOString(), draft: { routeReference: null },
  });
  expect(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)).toBe(routeV1);

  await editInput("#plan-describe-first-query", "One pub in Clapham tonight");
  expect(readPlanDraftEnvelope(sessionStorage)?.draft.routeReference).toBeNull();
  expect(localStorage.getItem(PLAN_ROUTE_DRAFT_KEY)).toBe(routeV1);
  advance(3000);
  fetchMock.mockImplementation(async (input) => new Response(JSON.stringify(
    String(input).includes("/api/plans/generate") ? generatedProofFixture() : [],
  ), { status: 200, headers: { "content-type": "application/json" } }));
  await act(async () => action("Plan it").click());
  await settle();
  expect(document.querySelector("[data-result='true']")).not.toBeNull();
  expect(readPlanDraftEnvelope(sessionStorage)?.draft.routeReference).toMatchObject({
    savedAt: new Date(T0 + 3000).toISOString(), operationKey: "proof-operation",
  });
  advance(4000);
  await remountComposer();
  expect(document.querySelector("[data-result='true']")).not.toBeNull();
  expect(document.body.textContent).toContain("Pub A");
});

it("restores a newly generated route when session writes leave the older request in place", async () => {
  const advance = pinClock();
  await mountComposer();
  advance(1000);
  const query = "One pub in Clapham tonight";
  await editInput("#plan-describe-first-query", query);
  const request = readPlanDraftEnvelope(sessionStorage);
  expect(request).toMatchObject({
    savedAt: new Date(T0 + 1000).toISOString(), draft: { conciergeQuery: query, stops: [] },
  });
  const sessionV1 = sessionStorage.getItem(PLAN_DRAFT_KEY);
  const sessionV2 = sessionStorage.getItem(PLAN_DRAFT_V2_KEY);
  blockStorageWrites("sessionStorage");

  const generated = generatedProofFixture();
  fetchMock.mockImplementation(async (input) => new Response(JSON.stringify(
    String(input).includes("/api/plans/generate") ? generated : [],
  ), { status: 200, headers: { "content-type": "application/json" } }));
  advance(2000);
  await act(async () => action("Plan it").click());
  await settle();
  expect(document.querySelector("[data-result='true']")).not.toBeNull();
  const savedAt = new Date(T0 + 2000).toISOString();
  expect(readPlanRouteDraftEnvelope(localStorage)).toMatchObject({
    savedAt, value: { operationKey: generated.operationKey, groundingProof: generated.groundingProof },
  });
  expect(readPlanIntakeDraftWithMetadata(localStorage)).toMatchObject({
    savedAt, routeReference: { savedAt, operationKey: generated.operationKey },
  });
  expect(readPlanDraftEnvelope(sessionStorage)).toEqual(request);

  advance(3000);
  await remountComposer();
  expect(document.querySelector("[data-result='true']")).not.toBeNull();
  expect(document.querySelector(".planStop__name")?.textContent).toBe("Pub A");
  expect(document.querySelector(".planComposer__routeStale")).toBeNull();
  expect(sessionStorage.getItem(PLAN_DRAFT_KEY)).toBe(sessionV1);
  expect(sessionStorage.getItem(PLAN_DRAFT_V2_KEY)).toBe(sessionV2);
  await editInput("#plan-name", "Captain");
  expect(await saveRoute()).toMatchObject({ groundingProof: generated.groundingProof });
});
