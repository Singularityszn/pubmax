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
    push: () => undefined,
    replace: () => undefined,
    prefetch: () => Promise.resolve(),
  }),
}));

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

const ACCOUNT_A = { id: "11111111-1111-4111-8111-111111111111" };
const ACCOUNT_B = { id: "22222222-2222-4222-8222-222222222222" };
const A_REQUEST = "A private outing in Soho";
const QUERY = "#plan-describe-first-query";

let root: Root | null = null;
let host: HTMLElement | null = null;

beforeEach(() => {
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
  return document.querySelector<HTMLInputElement>(QUERY)?.value;
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

describe("a mounted Plan composer at the live-account boundary (#2539)", () => {
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
});
