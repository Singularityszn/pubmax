// @vitest-environment jsdom

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

// Issue #2539: the account boundary clears the stored Plan drafts, but a /plan
// that stays mounted across the switch still held account A's request in React
// state, showed it to B, and wrote it back to storage on B's next edit.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    push: navigation.push,
    replace: () => undefined,
    prefetch: () => Promise.resolve(),
  }),
}));

const navigation = vi.hoisted(() => ({ push: vi.fn() }));

const authFixture = vi.hoisted(() => ({
  user: null as { id: string; user_metadata?: Record<string, unknown> } | null,
  handle: null as string | null,
  identityResolved: true,
}));
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ ...authFixture, session: null, loading: false }),
}));

vi.mock("@/components/plan/PlanCultureOpener", () => ({ default: () => null }));
vi.mock("@/components/wanted/WantedPlanChips", () => ({ default: () => null }));
vi.mock("@/components/plan/PlanRouteMiniMap", () => ({ default: () => null }));
vi.mock("@/lib/analytics", () => ({ trackEvent: () => undefined, trackMeaningfulCoreAction: () => undefined, laneSourceFromSearch: () => null }));

import PlanComposer from "@/components/plan/PlanComposer";
import {
  bindDeviceAccountOwner,
  clearDeviceAccountSessionArtifacts,
  releaseDeviceAccountOwner,
} from "@/lib/deviceAccountIdentity";
import { PLAN_DRAFT_V2_KEY } from "@/lib/planDraft";
import { PLAN_INTAKE_STORAGE_KEY, createPlanIntakeDraft, readPlanIntakeDraft, readPlanIntakeDraftWithMetadata, skipRemainingPlanIntake, writePlanIntakeDraft } from "@/lib/planIntake";
import { PLAN_HOST_NAME_KEY } from "@/lib/planHostName";
import { inferNightContext } from "@/lib/nightPlanning";
import { setProviderIdentity } from "@/lib/authProviderRevision";

const ACCOUNT_A = { id: "11111111-1111-4111-8111-111111111111" };
const ACCOUNT_B = { id: "22222222-2222-4222-8222-222222222222" };
const A_REQUEST = "A private outing in Soho";
const QUERY = "#plan-describe-first-query";
const GENERATED = {
  grounded: true,
  groundingProof: `${btoa(JSON.stringify({ v: 2, expiresAt: Date.UTC(2100, 0, 1) }))}.test-signature`,
  operationKey: "account-a-create",
  stops: [
    { venueId: "venue-a", venueName: "Pub A" },
    { venueId: "venue-b", venueName: "Pub B" },
    { venueId: "venue-c", venueName: "Pub C" },
  ],
  inferredContext: inferNightContext("Three pubs in Soho").context,
};

let root: Root | null = null;
let host: HTMLElement | null = null;

beforeEach(() => {
  setProviderIdentity("supabase", null);
  navigation.push.mockClear();
  authFixture.user = null;
  authFixture.handle = null;
  authFixture.identityResolved = true;
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => new Response("[]", {
    status: 200,
    headers: { "content-type": "application/json" },
  })));
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
    await vi.waitFor(() => expect(document.querySelector(".planStops__placeholder")).toBeNull());
  }
}

/** The auth context changed: every consumer re-renders with the new account. */
async function rerender(): Promise<void> {
  await act(async () => { root!.render(createElement(PlanComposer)); });
  await settle();
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

function queryValue(): string | undefined {
  return document.querySelector<HTMLInputElement>(`${QUERY}, #plan-concierge-query`)?.value;
}

function storedRequest(): string | null {
  const raw = sessionStorage.getItem(PLAN_DRAFT_V2_KEY);
  return raw ? (JSON.parse(raw) as { draft: { conciergeQuery: string } }).draft.conciergeQuery : null;
}

/** A types a private request into the mounted form, and it is saved. */
async function accountADrafts(): Promise<void> {
  authFixture.user = ACCOUNT_A;
  bindDeviceAccountOwner(ACCOUNT_A.id, localStorage, sessionStorage);
  await mountComposer();
  await editInput(QUERY, A_REQUEST);
  await vi.waitFor(() => expect(storedRequest()).toBe(A_REQUEST));
}

describe("mounted Plan wizard area ownership", () => {
  it.each([
    { query: "Cheap pints in Piccadilly for 3", focus: "piccadilly" },
    { query: "Cheap pints in Piccadilly and Soho for 3", focus: null },
  ])("keeps $query geography after fresh-tab recovery and refresh", async ({ query, focus }) => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => Response.json(
      String(input).includes("/api/plans/generate")
        ? { ...GENERATED, inferredContext: inferNightContext(query).context }
        : [],
    ));
    vi.stubGlobal("fetch", fetchMock);
    await mountComposer();
    await editInput(QUERY, query);
    await act(async () => {
      [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Plan it")!.click();
    });
    await vi.waitFor(() => expect(document.querySelectorAll(".planStop")).toHaveLength(3));
    await vi.waitFor(() => expect(readPlanIntakeDraftWithMetadata()?.explicitNightContext).toMatchObject({
      nightArea: "piccadilly-soho", areaFocus: focus,
    }));
    await act(async () => { root!.unmount(); });
    root = null;
    host!.remove();
    sessionStorage.clear();
    await mountComposer();
    expect(queryValue() ?? "").toBe("");
    // The restored route opens in its result view, so the refresh lives in Tune details.
    await act(async () => { document.querySelector<HTMLButtonElement>(".planResult__tune")!.click(); });
    await vi.waitFor(() => expect(document.querySelector(".planComposer__resort")).not.toBeNull());
    await act(async () => { document.querySelector<HTMLButtonElement>(".planComposer__resort")!.click(); });
    await vi.waitFor(() => expect(fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/plans/generate"))).toHaveLength(2));
    for (const [, init] of fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/plans/generate"))) {
      expect(JSON.parse(String(init?.body)).context).toMatchObject({ nightArea: "piccadilly-soho", areaFocus: focus });
    }
  });

  it.each([
    { choice: "Soho", nightArea: "piccadilly-soho", areaFocus: "soho" },
    { choice: "Camden", nightArea: "camden", areaFocus: null },
    { choice: null, nightArea: "piccadilly-soho", areaFocus: null },
  ])("replaces a whole-area Tune choice only after selecting $choice in the wizard", async ({ choice, nightArea, areaFocus }) => {
    writePlanIntakeDraft(skipRemainingPlanIntake(createPlanIntakeDraft({ kind: "patch", id: "soho" })));
    const fetchMock = vi.fn<typeof fetch>(async (input) => Response.json(
      String(input).includes("/api/plans/generate") ? GENERATED : [],
    ));
    vi.stubGlobal("fetch", fetchMock);
    await mountComposer();

    for (const area of ["camden", "piccadilly-soho"]) {
      await act(async () => {
        const select = document.querySelector<HTMLSelectElement>("#plan-context-area")!;
        expect(select).not.toBeNull();
        select.value = area;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }
    await act(async () => { document.querySelector<HTMLButtonElement>(".planIntake__tune")!.click(); });
    if (choice) {
      await act(async () => {
        const button = [...document.querySelectorAll<HTMLButtonElement>('[aria-label="Choose an area"] button')]
          .find((candidate) => candidate.textContent?.trim() === choice);
        expect(button).toBeDefined();
        button!.click();
      });
    }
    await act(async () => { document.querySelector<HTMLButtonElement>(".planIntake__continue")!.click(); });
    await act(async () => { document.querySelector<HTMLButtonElement>(".planComposer__conciergeInput button")!.click(); });
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/plans/generate"))).toBe(true));
    const generation = fetchMock.mock.calls.find(([input]) => String(input).includes("/api/plans/generate"))!;
    const body = JSON.parse(String(generation[1]?.body));
    expect(body.query ?? "").toBe("");
    expect(body.context).toMatchObject({ nightArea, areaFocus });
  });
});

describe("a newer area choice wins over a waiting Plan response", () => {
  const generateCalls = (fetchMock: ReturnType<typeof vi.fn<typeof fetch>>) =>
    fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/plans/generate"));

  async function chooseWholeAreaInTune() {
    for (const area of ["camden", "piccadilly-soho"]) {
      await act(async () => {
        const select = document.querySelector<HTMLSelectElement>("#plan-context-area")!;
        select.value = area;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }
  }

  async function chooseSohoInWizard() {
    await act(async () => { document.querySelector<HTMLButtonElement>(".planIntake__tune")!.click(); });
    await act(async () => {
      [...document.querySelectorAll<HTMLButtonElement>('[aria-label="Choose an area"] button')]
        .find((candidate) => candidate.textContent?.trim() === "Soho")!.click();
    });
    await act(async () => { document.querySelector<HTMLButtonElement>(".planIntake__continue")!.click(); });
  }

  async function planAgain() {
    await act(async () => { document.querySelector<HTMLButtonElement>(".planResult__tune")!.click(); });
    await vi.waitFor(() => expect(document.querySelector(".planComposer__resort")).not.toBeNull());
    await act(async () => { document.querySelector<HTMLButtonElement>(".planComposer__resort")!.click(); });
  }

  it.each([
    { sent: "the whole area", answeredFocus: null, newer: "a wizard Soho pick", expectedFocus: "soho" },
    { sent: "Soho", answeredFocus: "soho", newer: "a whole-area Tune pick", expectedFocus: null },
  ])("keeps $newer when a response for $sent arrives later", async ({ answeredFocus, newer, expectedFocus }) => {
    writePlanIntakeDraft(skipRemainingPlanIntake(createPlanIntakeDraft({ kind: "patch", id: "soho" })));
    let release: () => void = () => {};
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (!String(input).includes("/api/plans/generate")) return Response.json([]);
      if (generateCalls(fetchMock).length === 1) await waiting;
      return Response.json({ ...GENERATED, inferredContext: { ...GENERATED.inferredContext, nightArea: "piccadilly-soho", areaFocus: answeredFocus } });
    });
    vi.stubGlobal("fetch", fetchMock);
    await mountComposer();
    if (answeredFocus === null) await chooseWholeAreaInTune();
    else await chooseSohoInWizard();
    await act(async () => { document.querySelector<HTMLButtonElement>(".planComposer__conciergeInput button")!.click(); });
    await vi.waitFor(() => expect(generateCalls(fetchMock)).toHaveLength(1));
    expect(JSON.parse(String(generateCalls(fetchMock)[0]![1]?.body)).context).toMatchObject({ areaFocus: answeredFocus });

    // The reader picks again while the request waits.
    if (newer === "a wizard Soho pick") await chooseSohoInWizard();
    else await chooseWholeAreaInTune();
    await act(async () => { release(); await waiting; });
    await vi.waitFor(() => expect(document.querySelectorAll(".planStop")).toHaveLength(3));
    await vi.waitFor(() => expect(document.body.textContent).toContain("This route needs a refresh"));

    await planAgain();
    await vi.waitFor(() => expect(generateCalls(fetchMock)).toHaveLength(2));
    expect(JSON.parse(String(generateCalls(fetchMock)[1]![1]?.body)).context).toMatchObject({
      nightArea: "piccadilly-soho", areaFocus: expectedFocus,
    });
  });
});

describe("a mounted Plan composer at the live-account boundary (#2539)", () => {
  it.each([
    ["Plan it", "account"],
    ["Plan it", "form"],
    ["Lock it in", "account"],
    ["Lock it in", "form"],
  ] as const)("starts %s without AbortSignal.any and cancels when the %s changes", async (action, boundary) => {
    const anyDescriptor = Object.getOwnPropertyDescriptor(AbortSignal, "any");
    Object.defineProperty(AbortSignal, "any", { configurable: true, value: undefined });
    try {
      let finish!: (response: Response) => void;
      const pending = new Promise<Response>((resolve) => { finish = resolve; });
      let requestSignal: AbortSignal | null | undefined;
      const created = {
        created: true, grounded: true, memberToken: "plan-capability",
        plan: { plan: { id: "cancelled-plan", status: "draft" }, stops: GENERATED.stops },
      };
      const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
        if (String(input).includes("/api/plans/generate")) {
          if (action === "Lock it in") return Response.json(GENERATED);
          requestSignal = init?.signal;
          return pending;
        }
        if (String(input) === "/api/plans" && init?.method === "POST") {
          requestSignal = init.signal;
          return pending;
        }
        return Response.json([]);
      });
      vi.stubGlobal("fetch", fetchMock);
      await mountComposer();
      await editInput(QUERY, "Three pubs in Soho");
      await act(async () => { [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Plan it")!.click(); });
      if (action === "Lock it in") {
        await vi.waitFor(() => expect(document.querySelectorAll(".planStop")).toHaveLength(3));
        await editInput("#plan-name", "Original host");
        await act(async () => { document.querySelector<HTMLButtonElement>(".planComposer__submit")!.click(); });
      }
      await vi.waitFor(() => expect(requestSignal).toBeInstanceOf(AbortSignal));
      expect(requestSignal?.aborted).toBe(false);

      await act(async () => {
        if (boundary === "account") setProviderIdentity("supabase", ACCOUNT_B.id);
        else {
          root!.unmount();
          root = null;
        }
      });
      expect(requestSignal?.aborted).toBe(true);
      await act(async () => { finish(Response.json(action === "Plan it" ? GENERATED : created)); });
      await settle();

      expect(navigation.push).not.toHaveBeenCalled();
      expect(localStorage.getItem(PLAN_HOST_NAME_KEY)).toBeNull();
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
      if (action === "Plan it") expect(document.querySelectorAll(".planStop")).toHaveLength(0);
    } finally {
      if (anyDescriptor) Object.defineProperty(AbortSignal, "any", anyDescriptor);
      else Reflect.deleteProperty(AbortSignal, "any");
    }
  });

  it("releases generation controls after sign-in cancels a signed-out request", async () => {
    let finish!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { finish = resolve; });
    let generationCount = 0;
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      if (String(input).includes("/api/plans/generate")) {
        generationCount += 1;
        return generationCount === 1 ? pending : Response.json(GENERATED);
      }
      return Response.json([]);
    }));
    await mountComposer();
    const form = document.querySelector("form.planComposer");
    await editInput(QUERY, "Three pubs in Soho");
    await act(async () => { [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Plan it")!.click(); });
    await vi.waitFor(() => expect(generationCount).toBe(1));
    expect(document.querySelector(".planComposer__concierge")?.getAttribute("aria-busy")).toBe("true");

    setProviderIdentity("supabase", ACCOUNT_B.id);
    bindDeviceAccountOwner(ACCOUNT_B.id, localStorage, sessionStorage);
    authFixture.user = ACCOUNT_B;
    await rerender();
    expect(document.querySelector("form.planComposer")).toBe(form);
    await act(async () => { finish(Response.json(GENERATED)); });
    await settle();

    expect(document.querySelectorAll(".planStop")).toHaveLength(0);
    expect(document.querySelector(".planComposer__concierge")?.getAttribute("aria-busy")).toBe("false");
    const generate = document.querySelector<HTMLButtonElement>(".planComposer__concierge button")!;
    expect(generate.disabled).toBe(false);
    expect(generate.getAttribute("aria-disabled")).not.toBe("true");
    await act(async () => { generate.click(); });
    await vi.waitFor(() => expect(document.querySelectorAll(".planStop")).toHaveLength(3));
    expect(generationCount).toBe(2);
  });

  it.each(["hashing", "creation", "metadata"] as const)("releases Lock it in after sign-in cancels %s", async (stage) => {
    let finish!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { finish = resolve; });
    let finishHash!: (hash: ArrayBuffer) => void;
    const pendingHash = new Promise<ArrayBuffer>((resolve) => { finishHash = resolve; });
    const digest = vi.fn(async () => new ArrayBuffer(32));
    if (stage === "hashing") digest.mockImplementationOnce(() => pendingHash);
    vi.stubGlobal("crypto", { subtle: { digest }, randomUUID: () => "plan-test-operation" });
    const created = {
      created: true, grounded: true, memberToken: "plan-capability",
      plan: { plan: { id: "signed-out-plan", status: "draft" }, stops: GENERATED.stops },
    };
    let createCount = 0;
    let metadataCount = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input).includes("/api/plans/generate")) return Response.json({ ...GENERATED, operationKey: null });
      if (String(input) === "/api/plans" && init?.method === "POST") {
        createCount += 1;
        return stage === "creation" && createCount === 1 ? pending : Response.json(created);
      }
      if (init?.method === "PATCH") {
        metadataCount += 1;
        return stage === "metadata" && metadataCount === 1 ? pending : Response.json({});
      }
      return Response.json([]);
    });
    vi.stubGlobal("fetch", fetchMock);
    await mountComposer();
    await editInput(QUERY, "Three pubs in Soho");
    await act(async () => { [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Plan it")!.click(); });
    await vi.waitFor(() => expect(document.querySelectorAll(".planStop")).toHaveLength(3));
    await editInput("#plan-name", "Signed-out host");
    const form = document.querySelector("form.planComposer")!;
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await vi.waitFor(() => expect(stage === "hashing" ? digest.mock.calls.length : stage === "creation" ? createCount : metadataCount).toBe(1));
    expect(document.querySelector<HTMLButtonElement>(".planComposer__submit")?.disabled).toBe(true);

    setProviderIdentity("supabase", ACCOUNT_B.id);
    bindDeviceAccountOwner(ACCOUNT_B.id, localStorage, sessionStorage);
    authFixture.user = ACCOUNT_B;
    await rerender();
    expect(document.querySelector("form.planComposer")).toBe(form);
    await act(async () => {
      if (stage === "hashing") finishHash(new ArrayBuffer(32));
      else finish(stage === "creation" ? Response.json(created) : Response.json({}));
    });
    await settle();

    expect(navigation.push).not.toHaveBeenCalled();
    expect(localStorage.getItem(PLAN_HOST_NAME_KEY)).toBeNull();
    if (stage === "hashing") {
      expect(createCount).toBe(0);
      expect(sessionStorage.getItem("pubmaxx:plan-mutation:v1:create")).toBeNull();
    }
    const lock = document.querySelector<HTMLButtonElement>(".planComposer__submit")!;
    expect(lock.disabled).toBe(false);
    expect(lock.textContent).toBe("Lock it in");
    await act(async () => { lock.click(); });
    await vi.waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/plan/signed-out-plan#share"));
    expect(localStorage.getItem(PLAN_HOST_NAME_KEY)).toBe("Signed-out host");
  });

  it("does not recover retained route and accessibility inputs after provider sign-out then B sign-in", async () => {
    authFixture.user = ACCOUNT_A;
    bindDeviceAccountOwner(ACCOUNT_A.id, localStorage, sessionStorage);
    const intake = skipRemainingPlanIntake(createPlanIntakeDraft());
    writePlanIntakeDraft({
      ...intake,
      skippedSteps: intake.skippedSteps.filter((step) => step !== "accessibility"),
      answers: { ...intake.answers, accessibilityNeeds: ["step-free"] },
    });
    expect(readPlanIntakeDraft()?.answers.accessibilityNeeds).toEqual(["step-free"]);
    localStorage.setItem("pubmaxx:plan-route-draft:v1", JSON.stringify({ stops: GENERATED.stops }));
    await mountComposer();
    expect(document.querySelectorAll(".planStop")).toHaveLength(3);
    expect(readPlanIntakeDraft()?.answers.accessibilityNeeds).toEqual(["step-free"]);

    clearDeviceAccountSessionArtifacts(sessionStorage);
    authFixture.user = null;
    await rerender();
    expect(document.querySelectorAll(".planStop")).toHaveLength(0);
    expect(queryValue()).toBe("");

    bindDeviceAccountOwner(ACCOUNT_B.id, localStorage, sessionStorage);
    authFixture.user = ACCOUNT_B;
    await rerender();
    await editInput(QUERY, "B's own request");
    await vi.waitFor(() => expect(storedRequest()).toBe("B's own request"));
    expect(document.querySelectorAll(".planStop")).toHaveLength(0);
    expect(readPlanIntakeDraft()?.answers.accessibilityNeeds ?? []).toEqual([]);
  });

  it.each(["query", "describe", "occasion"])("does not replay the %s URL handoff after an account switch", async (parameter) => {
    authFixture.user = ACCOUNT_A;
    bindDeviceAccountOwner(ACCOUNT_A.id, localStorage, sessionStorage);
    const value = parameter === "occasion" ? "quiet" : parameter === "describe" ? "Quiet in Clapham for 4, not pricey" : A_REQUEST;
    window.history.replaceState({}, "", `/plan?${parameter}=${encodeURIComponent(value)}&from=pal#request`);
    await mountComposer();
    expect(queryValue()).toBe(parameter === "query" ? A_REQUEST : "Quiet in Clapham for 4, not pricey");
    const fetchMock = vi.mocked(fetch);
    const generations = () => fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/plans/generate")).length;
    const beforeSwitch = generations();
    if (parameter === "query") expect(beforeSwitch).toBe(1);

    clearDeviceAccountSessionArtifacts(sessionStorage);
    bindDeviceAccountOwner(ACCOUNT_B.id, localStorage, sessionStorage);
    authFixture.user = ACCOUNT_B;
    await rerender();

    expect(queryValue()).toBe("");
    expect(generations()).toBe(beforeSwitch);
    expect(storedRequest()).toBeNull();
    expect(new URLSearchParams(window.location.search).has(parameter)).toBe(false);
    expect(new URLSearchParams(window.location.search).get("from")).toBe("pal");
    expect(window.location.hash).toBe("#request");
    await act(async () => { root!.unmount(); });
    root = null;
    host?.remove();
    await mountComposer();
    expect(queryValue()).toBe("");
    expect(generations()).toBe(beforeSwitch);
  });

  it.each([
    ["creation", true],
    ["metadata", true],
    ["active account", true],
    ["creation", false],
    ["metadata", false],
  ] as const)("preserves draft ownership through %s completion with form replacement %s", async (stage, replaceForm) => {
    authFixture.user = ACCOUNT_A;
    setProviderIdentity("supabase", ACCOUNT_A.id);
    bindDeviceAccountOwner(ACCOUNT_A.id, localStorage, sessionStorage);
    let finish!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { finish = resolve; });
    const created = {
      created: true, grounded: true, memberToken: "account-a-capability",
      plan: { plan: { id: "account-a-plan", status: "draft" }, stops: GENERATED.stops },
    };
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input).includes("/api/plans/generate")) return Response.json(GENERATED);
      if (String(input) === "/api/plans" && init?.method === "POST") {
        return stage === "creation" ? pending : Response.json(created);
      }
      if (String(input) === "/api/plans/account-a-plan" && init?.method === "PATCH") {
        return stage === "metadata" ? pending : Response.json({});
      }
      return Response.json([]);
    });
    vi.stubGlobal("fetch", fetchMock);
    await mountComposer();
    await editInput(QUERY, "Three pubs in Soho");
    await act(async () => { [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Plan it")!.click(); });
    await settle();
    await vi.waitFor(() => expect(document.querySelectorAll(".planStop")).toHaveLength(3));
    await editInput("#plan-name", "Account A host");
    await act(async () => { document.querySelector("form.planComposer")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([input, init]) =>
      stage === "creation" ? String(input) === "/api/plans" && init?.method === "POST" : init?.method === "PATCH",
    )).toBe(true));

    if (stage === "active account") {
      await settle();
      expect(navigation.push).toHaveBeenCalledWith("/plan/account-a-plan#share");
      expect(localStorage.getItem(PLAN_HOST_NAME_KEY)).toBe("Account A host");
      expect(sessionStorage.getItem(PLAN_DRAFT_V2_KEY)).toBeNull();
      expect(localStorage.getItem("pubmax:plan-intake:v1")).toBeNull();
      return;
    }

    if (!replaceForm) setProviderIdentity("supabase", ACCOUNT_B.id);
    clearDeviceAccountSessionArtifacts(sessionStorage);
    bindDeviceAccountOwner(ACCOUNT_B.id, localStorage, sessionStorage);
    authFixture.user = ACCOUNT_B;
    if (replaceForm) {
      await rerender();
      await editInput(QUERY, "B's own request");
    } else {
      sessionStorage.setItem(PLAN_DRAFT_V2_KEY, JSON.stringify({ draft: { conciergeQuery: "B's own request" } }));
      writePlanIntakeDraft(createPlanIntakeDraft());
    }
    await vi.waitFor(() => expect(storedRequest()).toBe("B's own request"));
    const bDraft = sessionStorage.getItem(PLAN_DRAFT_V2_KEY);
    const bIntake = localStorage.getItem("pubmax:plan-intake:v1");
    await act(async () => { finish(stage === "creation" ? Response.json(created) : Response.json({})); });
    await settle();

    expect(sessionStorage.getItem(PLAN_DRAFT_V2_KEY)).toBe(bDraft);
    expect(localStorage.getItem("pubmax:plan-intake:v1")).toBe(bIntake);
    expect(localStorage.getItem(PLAN_HOST_NAME_KEY)).toBeNull();
    if (replaceForm) expect(queryValue()).toBe("B's own request");
    expect(navigation.push).not.toHaveBeenCalled();
    if (stage === "creation") expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
  });

  it.each([true, false])("discards A's generation after the switch with form replacement %s", async (replaceForm) => {
    authFixture.user = ACCOUNT_A;
    setProviderIdentity("supabase", ACCOUNT_A.id);
    bindDeviceAccountOwner(ACCOUNT_A.id, localStorage, sessionStorage);
    let finish!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { finish = resolve; });
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) =>
      String(input).includes("/api/plans/generate") ? pending : Response.json([]),
    ));
    await mountComposer();
    await editInput(QUERY, "Three pubs in Soho");
    await act(async () => { [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Plan it")!.click(); });
    if (!replaceForm) setProviderIdentity("supabase", ACCOUNT_B.id);
    clearDeviceAccountSessionArtifacts(sessionStorage);
    bindDeviceAccountOwner(ACCOUNT_B.id, localStorage, sessionStorage);
    authFixture.user = ACCOUNT_B;
    if (replaceForm) {
      await rerender();
      await editInput(QUERY, "B's own request");
    } else {
      sessionStorage.setItem(PLAN_DRAFT_V2_KEY, JSON.stringify({ draft: { conciergeQuery: "B's own request" } }));
    }
    await vi.waitFor(() => expect(storedRequest()).toBe("B's own request"));
    await act(async () => { finish(Response.json(GENERATED)); });
    await settle();
    expect(document.querySelectorAll(".planStop")).toHaveLength(0);
    expect(storedRequest()).toBe("B's own request");
    expect(localStorage.getItem("pubmaxx:plan-route-draft:v1")).toBeNull();
  });

  it("drops account A's request when account B takes over the open /plan", async () => {
    await accountADrafts();

    // AuthProvider's boundary: clear this tab's set, bind the device to B,
    // then publish B's session to every consumer.
    clearDeviceAccountSessionArtifacts(sessionStorage);
    bindDeviceAccountOwner(ACCOUNT_B.id, localStorage, sessionStorage);
    authFixture.user = ACCOUNT_B;
    await rerender();

    expect(queryValue()).toBe("");
    expect(storedRequest()).toBeNull();

    // B's own edit saves B's words and nothing of A's.
    await editInput(QUERY, "Two pubs near Borough");
    await vi.waitFor(() => expect(storedRequest()).toBe("Two pubs near Borough"));
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(A_REQUEST);
    expect(JSON.stringify({ ...localStorage })).not.toContain(A_REQUEST);
  });

  it("drops account A's request when A signs out with /plan open", async () => {
    await accountADrafts();

    releaseDeviceAccountOwner(localStorage, sessionStorage);
    authFixture.user = null;
    await rerender();

    expect(queryValue()).toBe("");
    expect(storedRequest()).toBeNull();
  });

  it("keeps the request through a re-render that stays on account A", async () => {
    await accountADrafts();

    authFixture.handle = "account_a";
    await rerender();

    expect(queryValue()).toBe(A_REQUEST);
    expect(storedRequest()).toBe(A_REQUEST);
  });

  it("keeps a signed-out request when that person signs in", async () => {
    await mountComposer();
    await editInput(QUERY, A_REQUEST);
    await vi.waitFor(() => expect(storedRequest()).toBe(A_REQUEST));

    authFixture.user = ACCOUNT_A;
    await rerender();

    expect(queryValue()).toBe(A_REQUEST);
  });

  it("preserves a newer intake after sign-in clears the anonymous request", async () => {
    await mountComposer();
    await editInput(QUERY, A_REQUEST);
    bindDeviceAccountOwner(ACCOUNT_A.id, localStorage, sessionStorage);
    const intake = skipRemainingPlanIntake(createPlanIntakeDraft());
    writePlanIntakeDraft({ ...intake, answers: { ...intake.answers, groupSize: 7 } });
    const replacement = localStorage.getItem(PLAN_INTAKE_STORAGE_KEY);

    authFixture.user = ACCOUNT_A;
    await rerender();
    await editInput(QUERY, "Older anonymous edit");

    expect(localStorage.getItem(PLAN_INTAKE_STORAGE_KEY)).toBe(replacement);
    expect(storedRequest()).toBeNull();
    expect(document.body.textContent).toContain("Your plan details could not be saved on this device");
  });
});
