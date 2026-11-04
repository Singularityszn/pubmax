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

vi.mock("@/components/plan/PlanCultureOpener", () => ({ default: () => null }));
vi.mock("@/components/wanted/WantedPlanChips", () => ({ default: () => null }));
vi.mock("@/components/plan/PlanRouteMiniMap", () => ({ default: () => null }));
vi.mock("@/lib/analytics", () => ({ trackEvent: () => undefined, trackMeaningfulCoreAction: () => undefined, laneSourceFromSearch: () => null }));
import PlanComposer from "@/components/plan/PlanComposer";
import { createPlanIntakeDraft, nextLondonOccurrenceIso, PLAN_INTAKE_STORAGE_KEY, readPlanIntakeDraftWithMetadata, reopenPlanIntakeStep, skipRemainingPlanIntake, writePlanIntakeDraft } from "@/lib/planIntake";
import { readPlanDraftEnvelope, writePlanDraftEnvelope } from "@/lib/planDraft";
import { PLAN_ROUTE_DRAFT_KEY, PLAN_ROUTE_DRAFT_V2_KEY } from "@/lib/planRouteDraft";
import { inferNightContext } from "@/lib/nightPlanning";
import { transferGeneratedRouteToDraft } from "@/lib/mapRouteTransfer";
import { parsePlanGenerationIntake } from "@/lib/planGenerationIntake";
import { reconcilePlanContext } from "@/lib/planGenerationContext";
import { ASK_PLAN_DRAFT_STORAGE_KEY } from "@/lib/ask/types";

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
    if (localBlocked) {
      expect(readPlanIntakeDraftWithMetadata(local)).toBeNull();
      expect(document.body.textContent).toContain("Your changes could not be saved on this device");
    } else {
      expect(readPlanIntakeDraftWithMetadata(local)).toMatchObject({
        savedAt: "2026-11-03T12:00:00.000Z", draft: { answers: { stopCount: 5 } },
      });
    }
    await editInput("#plan-concierge-query", "Clapham tonight");
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
    expect(document.body.textContent).toContain("route details, checks and starting pub could not be saved");
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
