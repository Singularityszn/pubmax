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
import { createPlanIntakeDraft, PLAN_INTAKE_STORAGE_KEY, readPlanIntakeDraftWithMetadata, reopenPlanIntakeStep, skipRemainingPlanIntake, writePlanIntakeDraft } from "@/lib/planIntake";
import { readPlanDraftEnvelope, writePlanDraftEnvelope } from "@/lib/planDraft";
import { PLAN_ROUTE_DRAFT_KEY, PLAN_ROUTE_DRAFT_V2_KEY } from "@/lib/planRouteDraft";
import { inferNightContext } from "@/lib/nightPlanning";

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
