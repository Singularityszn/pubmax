// @vitest-environment jsdom

// Q2 reproduction source. Does the pub-stop count a reader picks reach the
// generate request? Every case mounts the real PlanComposer, with the real
// describe-first form, guide, stop-count picker, seed guards, count inference,
// hydration and request builder. Only auth, navigation, telemetry,
// geolocation and the network are stubbed. The generate POST is captured and
// answered here with a 503, so no server answer can stand in for what the
// client sent. A missing mount, control, request or callback is a
// prerequisite failure, not a count finding.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) =>
    createElement("a", { href: String(href), className }, children),
}));

vi.mock("next/navigation", () => {
  const router = {
    back: () => undefined,
    forward: () => undefined,
    refresh: () => undefined,
    push: () => undefined,
    replace: () => undefined,
    prefetch: () => Promise.resolve(),
  };
  return {
    usePathname: () => "/plan",
    useRouter: () => router,
    useSearchParams: () => new URLSearchParams(),
  };
});

// An anonymous viewer whose identity has settled.
vi.mock("@/components/auth/AuthProvider", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/components/auth/AuthProvider")>();
  return {
    ...original,
    useAuth: () => ({ ...original.useAuth(), user: null, session: null, loading: false, identityResolved: true }),
  };
});

vi.mock("@/lib/analytics", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/analytics")>();
  return {
    ...original,
    trackEvent: () => undefined,
    trackMeaningfulCoreAction: () => undefined,
    laneSourceFromSearch: () => null,
  };
});

vi.mock("@/lib/analyticsErrorShown", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/analyticsErrorShown")>();
  return { ...original, trackErrorShown: () => undefined };
});

import PlanComposer, { planComposerVenueIndexPath } from "@/components/plan/PlanComposer";
import { NIGHT_PATCHES } from "@/lib/nightPatches";
import { PLAN_INTAKE_STORAGE_KEY } from "@/lib/planIntake";

const GENERATE_PATH = "/api/plans/generate";
const DIAGNOSTIC_STOP_BODY = JSON.stringify({ error: "Q2 diagnostic stop" });
const STOP_GROUP = "[role='group'][aria-label='Number of pub stops']";
const QUESTION = {
  area: "Where should the night happen?",
  timeWindow: "When are you heading out?",
  groupSize: "How many people?",
  budget: "What should the night cost?",
  accessibility: "Any access needs to protect?",
} as const;

type CapturedPost = { url: string; rawBody: string; body: unknown };
type PendingPosition = {
  success: PositionCallback;
  error: PositionErrorCallback | null | undefined;
  options: PositionOptions | undefined;
};
type GuideEvidence = {
  at: string;
  step: string | null;
  question: string | null;
  progress: string[];
  pressed: number[][];
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let originalHref = "";
let originalGeolocation: PropertyDescriptor | undefined;
let posts: CapturedPost[] = [];
let venueIndexReads = 0;
let unexpectedFetches: string[] = [];

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  originalHref = window.location.href;
  originalGeolocation = Object.getOwnPropertyDescriptor(window.navigator, "geolocation");
  posts = [];
  venueIndexReads = 0;
  unexpectedFetches = [];
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/plan");
  const venueIndexPath = planComposerVenueIndexPath();
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    const url = requestUrl(input);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (url === venueIndexPath && method === "GET") {
      // The empty fixture: the venue index is a static read, never a route.
      venueIndexReads += 1;
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url === GENERATE_PATH && method === "POST") {
      const rawBody = typeof init?.body === "string" ? init.body : "";
      let body: unknown = null;
      try {
        body = JSON.parse(rawBody);
      } catch {
        body = null;
      }
      posts.push({ url, rawBody, body });
      // Never forwarded. A local stop, so no server answer can mask the request.
      return new Response(DIAGNOSTIC_STOP_BODY, { status: 503, headers: { "content-type": "application/json" } });
    }
    unexpectedFetches.push(`${method} ${url}`);
    throw new TypeError(`Q2 harness refused an unexpected fetch: ${method} ${url}`);
  }));
});

afterEach(async () => {
  if (root) {
    const current = root;
    await act(async () => { current.unmount(); });
  }
  root = null;
  host?.remove();
  host = null;
  if (originalGeolocation) Object.defineProperty(window.navigator, "geolocation", originalGeolocation);
  else Reflect.deleteProperty(window.navigator, "geolocation");
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", originalHref);
  vi.unstubAllGlobals();
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let turn = 0; turn < 6; turn += 1) await Promise.resolve();
    await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    for (let turn = 0; turn < 6; turn += 1) await Promise.resolve();
  });
}

async function press(target: HTMLElement): Promise<void> {
  await act(async () => { target.click(); });
  await settle();
}

async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}

async function mountComposer(): Promise<void> {
  host = document.createElement("div");
  document.body.append(host);
  await act(async () => {
    root = createRoot(host!);
    root.render(createElement(PlanComposer));
  });
  await settle();
}

function buttons(scope: ParentNode = document): HTMLButtonElement[] {
  return [...scope.querySelectorAll<HTMLButtonElement>("button")];
}

function buttonByText(text: string, scope: ParentNode = document): HTMLButtonElement | null {
  return buttons(scope).find((button) => button.textContent?.trim() === text) ?? null;
}

function prerequisite<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`Prerequisite failure: ${what} is missing.`);
  return value;
}

/** A fresh /plan with nothing to recover: no draft, no ask and no count in the address. */
function expectFreshPlanState(): void {
  expect(window.location.pathname).toBe("/plan");
  expect(window.location.search).toBe("");
  expect(window.localStorage.length).toBe(0);
  expect(window.sessionStorage.length).toBe(0);
}

/** The live describe field, never the read-only placeholder a server paint would show. */
async function waitForLiveDescribeField(): Promise<HTMLInputElement> {
  await vi.waitFor(() => {
    const field = document.querySelector<HTMLInputElement>("#plan-describe-first-query");
    if (!field) throw new Error("Prerequisite failure: the describe field has not mounted.");
    if (field.readOnly) throw new Error("Prerequisite failure: the describe field is still read-only.");
    const planIt = buttonByText("Plan it");
    if (!planIt || planIt.hasAttribute("aria-disabled")) throw new Error("Prerequisite failure: Plan it is not live.");
    const stepByStep = buttonByText("Step by step");
    if (!stepByStep || stepByStep.hasAttribute("aria-disabled")) throw new Error("Prerequisite failure: Step by step is not live.");
  }, { timeout: 4000 });
  return document.querySelector<HTMLInputElement>("#plan-describe-first-query")!;
}

function stopCountGroups(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(STOP_GROUP)];
}

/** The pressed count in every visible pub-stop picker, one list per picker. */
function pressedStopCounts(): number[][] {
  return stopCountGroups().map((group) => buttons(group)
    .filter((button) => button.getAttribute("aria-pressed") === "true")
    .map((button) => Number(button.textContent?.trim())));
}

function onlyStopCountChoice(count: number): HTMLButtonElement {
  const groups = stopCountGroups();
  if (groups.length !== 1) {
    throw new Error(`Prerequisite failure: expected one pub stop picker, found ${groups.length}.`);
  }
  return prerequisite(buttonByText(String(count), groups[0]!), `the pub stop choice ${count}`);
}

function currentQuestion(): string | null {
  return document.querySelector("section.planIntake #plan-intake-title")?.textContent?.trim() ?? null;
}

function guideEvidence(at: string): GuideEvidence {
  const section = document.querySelector("section.planIntake");
  const complete = section?.classList.contains("planIntake--complete") ?? false;
  return {
    at,
    step: section?.querySelector(".planIntake__count")?.textContent?.trim() ?? (complete ? "complete" : null),
    question: currentQuestion(),
    progress: section
      ? [...section.querySelectorAll(".sheetStepProgress__segment")].map((segment) =>
        `${segment.querySelector(".sheetStepProgress__label")?.textContent?.trim() ?? ""}=${segment.getAttribute("data-state") ?? ""}`)
      : [],
    pressed: pressedStopCounts(),
  };
}

async function waitForQuestion(question: string): Promise<void> {
  await vi.waitFor(() => {
    const now = currentQuestion();
    if (now !== question) throw new Error(`Prerequisite failure: the guide is not on '${question}' (now '${now ?? "none"}').`);
  }, { timeout: 4000 });
}

function choiceInGroup(groupLabel: string, label: string): HTMLButtonElement {
  const group = prerequisite(
    document.querySelector<HTMLElement>(`section.planIntake [role='group'][aria-label='${groupLabel}']`),
    `the '${groupLabel}' group`,
  );
  const choice = buttons(group).find((button) =>
    (button.querySelector("strong")?.textContent ?? button.textContent ?? "").trim() === label);
  return prerequisite(choice, `the '${label}' choice in '${groupLabel}'`);
}

async function continueGuide(): Promise<void> {
  const next = prerequisite(
    document.querySelector<HTMLButtonElement>("section.planIntake .planIntake__continue"),
    "the guide Continue action",
  );
  if (next.disabled) throw new Error("Prerequisite failure: Continue is disabled after the step was answered.");
  await press(next);
}

/**
 * Every step after the area, answered by hand: the Evening preset at its next
 * real London occurrence, a group of two, a standard budget and access
 * skipped. The pub-stop picker is never touched here.
 */
async function finishGuideFromTimeWindow(record: (at: string) => void): Promise<Record<string, unknown>> {
  await waitForQuestion(QUESTION.timeWindow);
  await press(choiceInGroup("Choose a time window", "Evening"));
  const exactFirstPint = document.querySelector<HTMLInputElement>("#plan-intake-exact-time")?.value ?? null;
  const stored = storedIntake();
  const exactStartIso = typeof stored?.exactStartIso === "string" ? stored.exactStartIso : null;
  const timeWindow = {
    preset: "evening",
    exactFirstPint,
    exactStartIso,
    exactStartIsFuture: exactStartIso === null ? null : Date.parse(exactStartIso) > Date.now(),
  };
  record("time-window answered");
  await continueGuide();

  await waitForQuestion(QUESTION.groupSize);
  await press(choiceInGroup("Quick group sizes", "2"));
  record("group-size answered");
  await continueGuide();

  await waitForQuestion(QUESTION.budget);
  await press(choiceInGroup("Choose a budget", "Standard"));
  record("budget answered");
  await continueGuide();

  await waitForQuestion(QUESTION.accessibility);
  await press(prerequisite(
    document.querySelector<HTMLButtonElement>("section.planIntake .planIntake__skip"),
    "the guide Skip for now action",
  ));
  await vi.waitFor(() => {
    if (!document.querySelector("section.planIntake--complete")) throw new Error("Prerequisite failure: the guide has not completed.");
    if (!buttonByText("Make a plan")) throw new Error("Prerequisite failure: Make a plan has not mounted.");
  }, { timeout: 4000 });
  record("guide complete");
  return timeWindow;
}

/** A geolocation whose callbacks wait until the test delivers one. */
function installPendingGeolocation(): PendingPosition[] {
  const calls: PendingPosition[] = [];
  const geolocation = {
    getCurrentPosition(success: PositionCallback, error?: PositionErrorCallback | null, options?: PositionOptions): void {
      calls.push({ success, error, options });
    },
    watchPosition(): number {
      return 0;
    },
    clearWatch(): void {
      return undefined;
    },
  };
  Object.defineProperty(window.navigator, "geolocation", {
    configurable: true,
    enumerable: true,
    writable: false,
    value: geolocation,
  });
  return calls;
}

function installNoGeolocation(): void {
  Object.defineProperty(window.navigator, "geolocation", {
    configurable: true,
    enumerable: true,
    writable: false,
    value: undefined,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value: unknown, key: string): boolean {
  return isRecord(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function ownValue(value: unknown, key: string): unknown {
  return isRecord(value) && Object.prototype.hasOwnProperty.call(value, key) ? value[key] : null;
}

/** The intake draft the composer persisted, read raw so nothing is rewritten. */
function storedIntake(): Record<string, unknown> | null {
  const raw = window.localStorage.getItem(PLAN_INTAKE_STORAGE_KEY);
  if (!raw) return null;
  try {
    const envelope: unknown = JSON.parse(raw);
    const draft = isRecord(envelope) && isRecord(envelope.draft) ? envelope.draft : null;
    const answers = draft && isRecord(draft.answers) ? draft.answers : null;
    return {
      currentStep: draft?.currentStep ?? null,
      settledSteps: draft?.settledSteps ?? null,
      skippedSteps: draft?.skippedSteps ?? null,
      completed: draft?.completed ?? null,
      area: answers?.area ?? null,
      hasStopCount: hasOwn(answers, "stopCount"),
      stopCount: ownValue(answers, "stopCount"),
      exactStartIso: answers?.exactStartIso ?? null,
    };
  } catch {
    return { unreadable: true };
  }
}

function requestCountFields(post: CapturedPost | undefined): Record<string, unknown> | null {
  if (!post) return null;
  const body = post.body;
  const intake = isRecord(body) ? body.intake : undefined;
  const context = isRecord(body) ? body.context : undefined;
  return {
    bodyParsed: isRecord(body),
    hasIntake: hasOwn(body, "intake"),
    intakeHasStopCount: hasOwn(intake, "stopCount"),
    intakeStopCount: ownValue(intake, "stopCount"),
    hasContext: hasOwn(body, "context"),
    contextHasStopCount: hasOwn(context, "stopCount"),
    contextStopCount: ownValue(context, "stopCount"),
    query: ownValue(body, "query"),
    intakeArea: ownValue(intake, "area"),
    intakeGroupSize: ownValue(intake, "groupSize"),
    intakeSkipped: ownValue(intake, "skipped"),
    contextNightArea: ownValue(context, "nightArea"),
    contextGroupSize: ownValue(context, "groupSize"),
  };
}

/** Whether the local 503 came back on screen. Evidence only, never a gate. */
async function waitForDiagnosticStop(): Promise<boolean> {
  try {
    await vi.waitFor(() => {
      if (!document.querySelector("#plan-composer-error")?.textContent?.includes("Q2 diagnostic stop")) {
        throw new Error("the diagnostic stop is not on screen yet");
      }
    }, { timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

function emitDiagnostic(record: Record<string, unknown>): void {
  console.info("Q2_DIAGNOSTIC", JSON.stringify(record));
}

describe("the requested pub-stop count on its way to the generate request", () => {
  it("direct control: an explicit five on the describe-first form reaches both count fields", async () => {
    expectFreshPlanState();
    const geolocationCalls = installPendingGeolocation();
    await mountComposer();
    const field = await waitForLiveDescribeField();
    expect(field.value).toBe("");
    const pressedOnArrival = pressedStopCounts();

    // Two people, not five pubs: the words carry no pub count of their own.
    await typeInto(field, "quiet in Camden for 2");
    const typed = prerequisite(document.querySelector<HTMLInputElement>("#plan-describe-first-query"), "the describe field after typing");
    expect(typed.value).toBe("quiet in Camden for 2");
    const pressedAfterTyping = pressedStopCounts();

    await press(onlyStopCountChoice(5));
    const pressedAfterSelect = pressedStopCounts();
    expect(pressedAfterSelect).toEqual([[5]]);

    await press(prerequisite(buttonByText("Plan it"), "the Plan it action"));
    const errorShown = await waitForDiagnosticStop();
    const request = requestCountFields(posts[0]);

    emitDiagnostic({
      case: "direct-control",
      pressed: { onArrival: pressedOnArrival, afterTyping: pressedAfterTyping, afterSelect: pressedAfterSelect, atEnd: pressedStopCounts() },
      guide: [],
      geolocation: { calls: geolocationCalls.length, delivered: false },
      generatePosts: posts.length,
      request,
      errorShown,
      venueIndexReads,
      unexpectedFetches,
    });

    expect(posts).toHaveLength(1);
    expect(request).not.toBeNull();
    expect(request?.intakeHasStopCount).toBe(true);
    expect(request?.intakeStopCount).toBe(5);
    expect(request?.contextHasStopCount).toBe(true);
    expect(request?.contextStopCount).toBe(5);
    expect(unexpectedFetches).toEqual([]);
  });

  it("guide transfer: a five chosen before Step by step reaches the guided request", async () => {
    expectFreshPlanState();
    installNoGeolocation();
    await mountComposer();
    const field = await waitForLiveDescribeField();
    expect(field.value).toBe("");
    const pressedOnArrival = pressedStopCounts();

    await press(onlyStopCountChoice(5));
    const pressedAfterSelect = pressedStopCounts();
    expect(pressedAfterSelect).toEqual([[5]]);

    await press(prerequisite(buttonByText("Step by step"), "the Step by step action"));
    await waitForQuestion(QUESTION.area);
    const guide: GuideEvidence[] = [];
    const record = (at: string): void => { guide.push(guideEvidence(at)); };
    record("entered guide");
    const pressedOnGuideEntry = pressedStopCounts();

    await press(choiceInGroup("Choose an area", "Camden"));
    record("area answered");
    await continueGuide();
    const timeWindow = await finishGuideFromTimeWindow(record);
    const pressedAfterCompletion = pressedStopCounts();

    const makePlan = prerequisite(buttonByText("Make a plan"), "the Make a plan action");
    expect(makePlan.disabled).toBe(false);
    await press(makePlan);
    const errorShown = await waitForDiagnosticStop();
    const request = requestCountFields(posts[0]);

    emitDiagnostic({
      case: "guide-transfer",
      pressed: {
        onArrival: pressedOnArrival,
        afterSelect: pressedAfterSelect,
        onGuideEntry: pressedOnGuideEntry,
        afterCompletion: pressedAfterCompletion,
      },
      guide,
      timeWindow,
      storedIntakeAtEnd: storedIntake(),
      geolocation: { available: false },
      generatePosts: posts.length,
      request,
      errorShown,
      venueIndexReads,
      unexpectedFetches,
    });

    expect(posts).toHaveLength(1);
    expect(request).not.toBeNull();
    expect.soft(pressedAfterCompletion).toEqual([[5]]);
    expect.soft(request?.intakeStopCount).toBe(5);
    expect.soft(request?.contextStopCount).toBe(5);
    expect(unexpectedFetches).toEqual([]);
  });

  it("delayed seed: a five chosen inside the guide survives a late location seed", async () => {
    expectFreshPlanState();
    const geolocationCalls = installPendingGeolocation();
    const camden = prerequisite(NIGHT_PATCHES.find((patch) => patch.id === "camden"), "the Camden night patch");
    await mountComposer();
    const field = await waitForLiveDescribeField();
    expect(field.value).toBe("");
    const callsOnDescribe = geolocationCalls.length;

    await press(prerequisite(buttonByText("Step by step"), "the Step by step action"));
    await waitForQuestion(QUESTION.area);
    const guide: GuideEvidence[] = [];
    const record = (at: string): void => { guide.push(guideEvidence(at)); };
    record("entered guide");
    const callsAfterEntry = geolocationCalls.length;

    await press(onlyStopCountChoice(5));
    record("five chosen in guide");
    const pressedBeforeCallback = pressedStopCounts();
    expect(pressedBeforeCallback).toEqual([[5]]);

    const callsBeforeDelivery = geolocationCalls.length;
    const pending = prerequisite(geolocationCalls[callsBeforeDelivery - 1], "a pending getCurrentPosition callback");
    const storedBeforeCallback = storedIntake();
    await act(async () => {
      pending.success({
        coords: {
          latitude: camden.lat,
          longitude: camden.lng,
          accuracy: 25,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
        },
        timestamp: Date.now(),
      } as unknown as GeolocationPosition);
    });
    await settle();
    record("after location callback");
    const questionAfterCallback = currentQuestion();
    const storedAfterCallback = storedIntake();
    const pressedAfterCallback = pressedStopCounts();

    // A guard that refused the seed leaves the area question open, so it is
    // answered by hand. A seed that landed has already moved the guide on.
    const seeded = questionAfterCallback !== QUESTION.area;
    if (!seeded) {
      await press(choiceInGroup("Choose an area", "Camden"));
      record("manual area answered");
      await continueGuide();
    }
    const timeWindow = await finishGuideFromTimeWindow(record);
    const pressedAfterCompletion = pressedStopCounts();

    const makePlan = prerequisite(buttonByText("Make a plan"), "the Make a plan action");
    expect(makePlan.disabled).toBe(false);
    await press(makePlan);
    const errorShown = await waitForDiagnosticStop();
    const request = requestCountFields(posts[0]);

    emitDiagnostic({
      case: "delayed-seed",
      pressed: {
        beforeCallback: pressedBeforeCallback,
        afterCallback: pressedAfterCallback,
        afterCompletion: pressedAfterCompletion,
      },
      guide,
      seed: {
        patch: { id: camden.id, lat: camden.lat, lng: camden.lng },
        questionAfterCallback,
        seeded,
        storedBeforeCallback,
        storedAfterCallback,
      },
      timeWindow,
      storedIntakeAtEnd: storedIntake(),
      geolocation: {
        callsOnDescribe,
        callsAfterEntry,
        callsBeforeDelivery,
        deliveredTo: callsBeforeDelivery - 1,
        callsAtEnd: geolocationCalls.length,
      },
      generatePosts: posts.length,
      request,
      errorShown,
      venueIndexReads,
      unexpectedFetches,
    });

    expect(posts).toHaveLength(1);
    expect(request).not.toBeNull();
    expect.soft(pressedAfterCompletion).toEqual([[5]]);
    expect.soft(request?.intakeStopCount).toBe(5);
    expect.soft(request?.contextStopCount).toBe(5);
    expect(unexpectedFetches).toEqual([]);
  });
});
