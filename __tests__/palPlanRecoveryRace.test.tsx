// @vitest-environment jsdom

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/link", () => ({ default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => createElement("a", { href, className }, children) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/plan", useRouter: () => ({ push: () => undefined, replace: () => undefined }) }));
// Keep the real auth reader. Only the provider's application bootstrap is absent.
vi.mock("@/components/auth/AuthProvider", async () => ({ useAuth: (await import("@/components/auth/authContext")).useAuth }));
// WebGL and external telemetry do not participate in request or route custody.
vi.mock("@/components/plan/PlanRouteMiniMap", () => ({ default: () => null }));
vi.mock("@/lib/analytics", () => ({ trackEvent: () => undefined, trackMeaningfulCoreAction: () => undefined, laneSourceFromSearch: () => null }));

import PlanComposer, { planComposerVenueIndexPath } from "@/components/plan/PlanComposer";
import { AuthContext, useAuth } from "@/components/auth/authContext";
import { ASK_PLAN_DRAFT_STORAGE_KEY } from "@/lib/ask/types";
import { inferNightContext } from "@/lib/nightPlanning";
import { readPlanDraftEnvelope } from "@/lib/planDraft";
import { readPlanIntakeDraft } from "@/lib/planIntake";
import { PLAN_ROUTE_DRAFT_KEY, PLAN_ROUTE_DRAFT_V2_KEY, readPlanRouteDraftEnvelope } from "@/lib/planRouteDraft";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const originalAsk = "Plan three pubs in Soho tonight";
const nextAsk = "Plan three pubs in Clapham tomorrow";
const drafted = ["pal-a", "pal-b", "pal-c"];
const nextDrafted = ["next-a", "next-b", "next-c"];
const finalPubs = ["plain-a", "plain-b", "plain-c"];
type Attempt = { body: Record<string, unknown>; resolve: (response: Response) => void };
let attempts: Attempt[];
let creations: Array<Record<string, unknown>>;
let root: Root | null = null;
let host: HTMLDivElement | null = null;

function SignedOutComposer() {
  const signedOut = useAuth();
  return <AuthContext.Provider value={{ ...signedOut, identityResolved: true }}><PlanComposer /></AuthContext.Provider>;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function route(ids: string[], operationKey: string, ask = originalAsk, outcome = "route") {
  return json({
    outcome, anchored: outcome === "anchor-only" || ids[0] === drafted[0] || ids[0] === nextDrafted[0],
    anchorVenueId: ids[0], anchorSource: "pal",
    stops: ids.map((venueId) => ({ venueId, venueName: `Pub ${venueId}` })),
    inferredContext: { ...inferNightContext(ask).context, stopCount: 3 },
    groundingProof: `${btoa(JSON.stringify({ v: 1, expiresAt: Date.now() + 3_600_000 }))}.test-signature`,
    operationKey, routeRevision: 1,
  });
}

beforeAll(async () => {
  await Promise.all([
    import("@/components/plan/PlanStopList"), import("@/components/plan/PlanTuneSheet"),
    import("@/components/plan/PlanResultProvenance"), import("@/components/plan/PlanBudgetLedger"),
    import("@/components/plan/PlanDryRoundLedger"),
  ]);
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-04T12:00:00Z"));
  sessionStorage.clear(); localStorage.clear();
  window.history.replaceState({}, "", "/plan");
  attempts = []; creations = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>((input, init) => {
    const url = String(input);
    if (url === "/api/plans/generate") {
      return new Promise<Response>((resolve) => attempts.push({ body: JSON.parse(String(init?.body)), resolve }));
    }
    if (url === "/api/plans") {
      creations.push(JSON.parse(String(init?.body)));
      return Promise.resolve(json({ error: "The test does not create a plan." }, 503));
    }
    if (url === planComposerVenueIndexPath()) {
      return Promise.resolve(json([...drafted, ...nextDrafted, ...finalPubs, "first-alt", "second-alt"].map((id) => ({ id, name: `Pub ${id}`, kind: "pub", lat: 51.514, lng: -0.132 }))));
    }
    return Promise.reject(new Error(`Unexpected HTTP boundary: ${url}`));
  }));
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null; host?.remove(); host = null;
  vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers();
  sessionStorage.clear(); localStorage.clear(); window.history.replaceState({}, "", "/plan");
});

function seed(ask = originalAsk, ids = drafted) {
  sessionStorage.setItem(ASK_PLAN_DRAFT_STORAGE_KEY, JSON.stringify({ query: ask, stopIds: ids, stopNames: ids.map((id) => `Pub ${id}`), origin: "pal" }));
  window.history.replaceState({}, "", `/plan?query=${encodeURIComponent(ask)}`);
}

async function mount() {
  host = document.createElement("div"); document.body.append(host);
  await act(async () => { root = createRoot(host!); root.render(<SignedOutComposer />); });
}

async function unmount() {
  await act(async () => root!.unmount()); root = null; host?.remove(); host = null;
}

async function waitForAttempts(count: number) {
  await vi.waitFor(() => expect(attempts).toHaveLength(count));
}

async function answer(index: number, response: Response) {
  await act(async () => { attempts[index]!.resolve(response); });
}

async function waitForPubs(ids: string[]) {
  await vi.waitFor(async () => {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect([...document.querySelectorAll(".planStop__name")].map((node) => node.textContent)).toEqual(ids.map((id) => `Pub ${id}`));
  });
}

async function enter(id: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(id);
  expect(input).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input!.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function openTune() {
  const button = [...document.querySelectorAll("button")].find((node) => node.textContent?.trim() === "Tune details");
  if (button) await act(async () => button.click());
  await vi.waitFor(() => expect(document.querySelector("#plan-concierge-query")).not.toBeNull());
}

async function fillLockFields() {
  await enter("#plan-name", "Captain");
  await enter("#plan-title", "Our pub night");
  await enter("#plan-time", "2026-11-05T18:00");
}

async function pressLock() {
  const button = document.querySelector<HTMLButtonElement>(".planComposer__submit");
  expect(button?.disabled).toBe(false);
  await act(async () => button!.click());
}

it("stamps route authority only after the final accepted Pal attempt", async () => {
  seed(); await mount(); await waitForAttempts(1);
  expect(attempts[0]!.body.anchor).toMatchObject({ venueIds: drafted });
  await answer(0, route([drafted[0]!], "rejected-all", originalAsk, "anchor-only"));
  await waitForAttempts(2);
  expect(attempts[1]!.body.anchor).toMatchObject({ venueId: drafted[0] });
  expect(attempts[1]!.body.anchor).not.toHaveProperty("venueIds");
  expect(readPlanDraftEnvelope(sessionStorage)?.draft.routeReference ?? null).toBeNull();
  expect(readPlanRouteDraftEnvelope(localStorage)?.value.operationKey ?? null).toBeNull();
  vi.setSystemTime(new Date("2026-11-04T12:00:10Z"));
  await answer(1, json({ error: "The held pub cannot make this route.", operationKey: "rejected-first" }, 503));
  await waitForAttempts(3);
  expect(attempts[2]!.body).not.toHaveProperty("anchor");
  expect(readPlanDraftEnvelope(sessionStorage)?.draft.routeReference ?? null).toBeNull();
  expect(readPlanRouteDraftEnvelope(localStorage)?.value.operationKey ?? null).toBeNull();
  expect(document.querySelectorAll(".planStop__name")).toHaveLength(0);
  vi.setSystemTime(new Date("2026-11-04T12:00:20Z"));
  await answer(2, route(finalPubs, "accepted-final")); await waitForPubs(finalPubs);
  const storedRoute = readPlanRouteDraftEnvelope(localStorage);
  expect(storedRoute?.value).toMatchObject({ operationKey: "accepted-final", routeStale: false });
  expect(storedRoute?.savedAt).toBe("2026-11-04T12:00:20.000Z");
  expect(readPlanDraftEnvelope(sessionStorage)?.draft.routeReference).toEqual({ savedAt: storedRoute!.savedAt, operationKey: "accepted-final" });
});

it("reloads the current Pal request after partial route writes leave an old preview behind", async () => {
  seed(); await mount(); await waitForAttempts(1);
  await answer(0, route(drafted, "old-soho-route")); await waitForPubs(drafted);
  const storage = localStorage;
  const oldRoute = storage.getItem(PLAN_ROUTE_DRAFT_V2_KEY);
  expect(readPlanRouteDraftEnvelope(storage)?.value.operationKey).toBe("old-soho-route");
  await unmount();
  vi.stubGlobal("localStorage", {
    getItem: storage.getItem.bind(storage),
    setItem: (key: string, value: string) => {
      if ([PLAN_ROUTE_DRAFT_KEY, PLAN_ROUTE_DRAFT_V2_KEY].includes(key)) throw new DOMException("Storage is full", "QuotaExceededError");
      storage.setItem(key, value);
    },
    removeItem: storage.removeItem.bind(storage), clear: storage.clear.bind(storage),
    key: storage.key.bind(storage), get length() { return storage.length; },
  } satisfies Storage);
  vi.setSystemTime(new Date("2026-11-04T12:01:00Z"));
  seed(nextAsk, nextDrafted); await mount(); await waitForAttempts(2);
  await answer(1, route([nextDrafted[0]!], "rejected-next-all", nextAsk, "anchor-only"));
  await waitForAttempts(3);
  const accepted = [nextDrafted[0]!, "first-alt", "second-alt"];
  await answer(2, route(accepted, "new-clapham-route", nextAsk)); await waitForPubs(accepted);
  expect(readPlanDraftEnvelope(sessionStorage)?.draft.conciergeQuery).toBe(nextAsk);
  expect(readPlanDraftEnvelope(sessionStorage)?.draft.routeReference ?? null).toBeNull();
  expect(storage.getItem(PLAN_ROUTE_DRAFT_V2_KEY)).toBe(oldRoute);
  await unmount(); window.history.replaceState({}, "", "/plan"); await mount(); await waitForPubs(accepted);
  expect(attempts).toHaveLength(3);
  await openTune();
  expect(document.querySelector<HTMLInputElement>("#plan-concierge-query")?.value).toBe(nextAsk);
  expect(document.querySelector<HTMLSelectElement>("#plan-context-stops")?.value).toBe("3");
  expect(readPlanIntakeDraft()?.answers.stopCountSource).not.toBe("picker");
  expect(document.body.textContent).toContain("Opening and travel checks are unavailable for this restored draft.");
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Close Tune details"]')!.click());
  await fillLockFields(); await pressLock();
  expect(creations).toHaveLength(0);
  expect(document.querySelector("#plan-lock-hint")?.textContent).toBe("Refresh the route before locking it in.");
  expect(readPlanDraftEnvelope(sessionStorage)?.draft.conciergeQuery).toBe(nextAsk);
});

it("does not accept an old Pal reply after the user edits the visible request during a later attempt", async () => {
  seed(); await mount(); await waitForAttempts(1);
  await answer(0, route([drafted[0]!], "rejected-all", originalAsk, "anchor-only"));
  await waitForAttempts(2);
  await fillLockFields();
  await enter("#plan-concierge-query", nextAsk);
  expect(document.querySelector<HTMLInputElement>("#plan-concierge-query")?.value).toBe(nextAsk);
  await answer(1, route([drafted[0]!, "first-alt", "second-alt"], "obsolete-soho-reply"));
  await vi.waitFor(() => expect(document.querySelector<HTMLButtonElement>(".planComposer__submit")?.disabled).toBe(false));
  expect(readPlanDraftEnvelope(sessionStorage)?.draft.conciergeQuery).toBe(nextAsk);
  expect.soft(readPlanDraftEnvelope(sessionStorage)?.draft.routeReference ?? null).toBeNull();
  expect.soft(readPlanRouteDraftEnvelope(localStorage)?.value.operationKey ?? null).not.toBe("obsolete-soho-reply");
  await pressLock();
  expect(creations).toHaveLength(0);
});
