// @vitest-environment jsdom

import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PLAN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACCOUNT_A = { id: "11111111-1111-4111-8111-111111111111", token: "token-a" };
const ACCOUNT_B = { id: "22222222-2222-4222-8222-222222222222", token: "token-b" };

const planSession = vi.hoisted(() => ({ role: "host" as "host" | "guest" | null }));
const auth = vi.hoisted(() => ({
  account: null as { id: string; token: string } | null,
  identityResolved: true,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/authServer", () => ({
  verifyCallerAuth: async (request: Request) => {
    const bearer = request.headers.get("authorization");
    const account = [ACCOUNT_A, ACCOUNT_B].find(candidate => bearer === `Bearer ${candidate.token}`);
    return account
      ? { status: "verified", identity: { id: account.id, email: null, createdAt: null } }
      : { status: "invalid" };
  },
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: auth.account ? { id: auth.account.id } : null,
    session: auth.account
      ? { access_token: auth.account.token, user: { id: auth.account.id } }
      : null,
    identityResolved: auth.identityResolved,
    loading: false,
    getCurrentUserId: () => auth.account?.id ?? null,
  }),
}));
vi.mock("@/lib/planSessionCapability", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/planSessionCapability")>()),
  readPlanCapabilitySnapshot: () => (planSession.role ? `|1|${planSession.role}` : "|0|"),
}));

import ActivePlanMarker from "@/components/plan/ActivePlanMarker";
import PlanNightReceipt from "@/components/plan/PlanNightReceipt";
import { POST as createPlan } from "@/app/api/plans/route";
import { GET as readPlan } from "@/app/api/plans/[id]/route";
import { PUT as claimPlan } from "@/app/api/plans/[id]/session/route";
import { planMemberCookieName } from "@/lib/planMemberCapability";
import { setProviderIdentity } from "@/lib/authProviderRevision";
import { __resetMemoryPlans, planStore } from "@/lib/planStore";


(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const RECEIPT = {
  title: "Receipt night",
  plannedFor: null,
  stops: [{ position: 0, venueName: "The First Pub", price: null }],
  ending: "get_home",
  paid: "not_recorded",
};

// The capability-gated Plan read answers whoever holds the host cookie, so it
// knows nothing about which account is signed in on the device.
const COMPLETED_PLAN = {
  plan: { id: PLAN_ID, title: "Receipt night", startTime: "2026-11-14T19:00:00.000Z", createdAt: "2026-11-10T12:00:00.000Z", status: "completed" },
  stops: [{ venueId: "venue-a", venueName: "The First Pub", position: 0 }],
  crew: [{ id: "m-host", name: "Sam Host", status: "here", joinedAt: "2026-11-10T12:00:00.000Z", updatedAt: "2026-11-14T19:05:00.000Z" }],
  actions: [],
  ending: "get_home",
};

type Call = { url: string; bearer: string | null; signal: AbortSignal | undefined };
type Answer = (call: Call) => Promise<Response>;

let calls: Call[];
let receiptAnswer: Answer;
let claimAnswer: Answer;
let root: Root;
let container: HTMLDivElement;
let bodyRead: Promise<unknown>;

const json = (body: unknown, status = 200) => {
  const response = new Response(JSON.stringify(body), { status });
  const decode = response.json.bind(response);
  response.json = () => {
    const consumed = decode();
    bodyRead = consumed;
    return consumed;
  };
  return response;
};
const refused = () => json({ error: "That receipt is private.", code: "PLAN_RECEIPT_FORBIDDEN", retryable: false }, 403);
const ownerOnly: Answer = async ({ bearer }) => (bearer === `Bearer ${ACCOUNT_A.token}` ? json({ receipt: RECEIPT }) : refused());

function receiptOnScreen() {
  return container.querySelector("[data-testid='plan-night-receipt']");
}

function receiptReads() {
  return calls.filter((call) => call.url === `/api/plans/${PLAN_ID}?view=receipt`);
}

async function show() {
  await act(async () => {
    root.render(createElement(PlanNightReceipt, { planId: PLAN_ID }));
  });
  await settle();
}

async function settle() {
  await act(async () => { await bodyRead; });
}

beforeEach(() => {
  setProviderIdentity("clerk", null);
  setProviderIdentity("supabase", null);
  calls = [];
  bodyRead = Promise.resolve();
  receiptAnswer = ownerOnly;
  claimAnswer = async () => refused();
  planSession.role = "host";
  auth.account = ACCOUNT_A;
  auth.identityResolved = true;
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const call = { url, bearer: new Headers(init.headers).get("authorization"), signal: init.signal ?? undefined };
    calls.push(call);
    if (url === `/api/plans/${PLAN_ID}`) return Promise.resolve(json(COMPLETED_PLAN));
    if (url === `/api/plans/${PLAN_ID}?view=receipt`) return receiptAnswer(call);
    if (url === `/api/plans/${PLAN_ID}/session`) return claimAnswer(call);
    return Promise.resolve(json({}, 404));
  }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  setProviderIdentity("clerk", null);
  setProviderIdentity("supabase", null);
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the private Night Receipt on the Plan page", () => {
  it("ends a stalled read and lets the owner retry", async () => {
    vi.useFakeTimers();
    receiptAnswer = ({ signal }) => new Promise<Response>((_resolve, reject) => {
      signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    });
    await show();
    await act(async () => { await vi.advanceTimersByTimeAsync(8_000); });
    expect(receiptReads()[0]?.signal?.aborted).toBe(true);
    const retry = container.querySelector<HTMLButtonElement>("button");
    expect(retry).not.toBeNull();
    receiptAnswer = ownerOnly;
    await act(async () => { retry!.click(); });
    await settle();
    expect(receiptOnScreen()).not.toBeNull();
  });

  it.each(["ready", "refused"])("restores focus after a %s retry activated without focusing its button", async (answer) => {
    const main = document.createElement("main");
    const heading = document.createElement("h1");
    heading.textContent = "The Plan";
    main.append(heading);document.body.append(main);
    try {
      receiptAnswer = async () => json({ retryable: true }, 503);
      await show();
      expect(document.activeElement).toBe(document.body);
      const retry = container.querySelector<HTMLButtonElement>("button")!;
      receiptAnswer = answer === "ready" ? ownerOnly : async () => refused();
      await act(async () => { retry.click(); });
      await settle();
      expect(document.activeElement).toBe(answer === "ready" ? receiptOnScreen()?.querySelector("h2") : heading);
    } finally { main.remove(); }
  });

  it("does not carry a failed retry focus request into automatic recovery", async () => {
    vi.useFakeTimers();
    receiptAnswer = async () => json({ retryable: true }, 503);
    await show();
    const retry = container.querySelector<HTMLButtonElement>("button")!;
    await act(async () => { retry.click(); });
    await settle();
    expect(document.activeElement).toBe(document.body);
    receiptAnswer = ownerOnly;
    await act(async () => { window.dispatchEvent(new Event("online")); await vi.advanceTimersByTimeAsync(150); });
    await settle();
    expect(receiptOnScreen()).not.toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  it("settles a cancelled read when another provider rotates, then permits recovery", async () => {
    let answer!: (response: Response) => void;
    receiptAnswer = () => new Promise<Response>(resolve => { answer = resolve; });
    await show();
    await act(async () => { setProviderIdentity("clerk", "late-clerk-account"); });
    await settle();
    const retry = container.querySelector<HTMLButtonElement>("button");
    expect(retry).not.toBeNull();
    receiptAnswer = ownerOnly;
    await act(async () => { retry!.click(); });
    await settle();
    expect(receiptOnScreen()).not.toBeNull();
    await act(async () => { answer(json({ receipt: RECEIPT })); });
    expect(receiptOnScreen()).not.toBeNull();
  });

  it("moves keyboard focus from a successful retry to the receipt heading", async () => {
    vi.useFakeTimers();
    await show();
    receiptAnswer = async () => json({ retryable: true }, 503);
    await act(async () => { window.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(150); });
    await settle();
    const retry = container.querySelector<HTMLButtonElement>("button")!;
    retry.focus();
    receiptAnswer = ownerOnly;
    await act(async () => { retry.click(); });
    await settle();
    expect(document.activeElement).toBe(receiptOnScreen()?.querySelector("h2"));
  });

  it("returns keyboard focus to the Plan heading when a retry loses access", async () => {
    vi.useFakeTimers();
    const main = document.createElement("main");
    const heading = document.createElement("h1");
    heading.textContent = "The Plan";
    main.append(heading);document.body.append(main);
    try {
      await show();
      receiptAnswer = async () => json({ retryable: true }, 503);
      await act(async () => { window.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(150); });
      await settle();
      const retry = container.querySelector<HTMLButtonElement>("button")!;
      retry.focus();
      receiptAnswer = async () => refused();
      await act(async () => { retry.click(); });
      await settle();
      expect(receiptOnScreen()).toBeNull();
      expect(document.activeElement).toBe(heading);
    } finally { main.remove(); }
  });

  it("updates the mounted live region when a shown receipt becomes unavailable", async () => {
    vi.useFakeTimers();
    await show();
    const live = container.querySelector('[role="status"]');
    expect(live).not.toBeNull();
    receiptAnswer = async () => json({ retryable: true }, 503);
    await act(async () => { window.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(150); });
    await settle();
    expect(container.querySelector('[role="status"]')).toBe(live);
    expect(live?.textContent).toContain("couldn't load");
  });

  it("reads the real completed Plan after its real host account claim finishes", async () => {
    __resetMemoryPlans();
    const created = await createPlan(new Request("http://localhost/api/plans", {
      method: "POST",
      headers: { "idempotency-key": `receipt-claim-${crypto.randomUUID()}` },
      body: JSON.stringify({ title: "Claimed receipt night", creatorName: "Fixture host",
        startTime: new Date(Date.now() + 3_600_000).toISOString(),
        stops: [{ venueId: "venue-7tarkc" }, { venueId: "venue-122cuu1" }],
      }),
    }));
    expect(created.status).toBe(201);
    const host = await created.json() as { plan: { plan: { id: string } }; memberToken: string };
    const id = host.plan.plan.id;
    for (const status of ["ready", "active", "completed"] as const) {
      expect((await planStore().update(id, host.memberToken, { status })).ok).toBe(true);
    }
    let finishClaim!: () => void;
    let firstRead!: () => void;
    let ownedRead!: () => void;
    const heldClaim = new Promise<void>(resolve => { finishClaim = resolve; });
    const initialReceipt = new Promise<void>(resolve => { firstRead = resolve; });
    const ownerReceipt = new Promise<void>(resolve => { ownedRead = resolve; });
    const statuses: number[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      const headers = new Headers(init.headers);
      headers.set("cookie", `${planMemberCookieName(id)}=${encodeURIComponent(host.memberToken)}`);
      const request = new Request(`http://localhost${url}`, { ...init, headers });
      const context = { params: Promise.resolve({ id }) };
      if (url === `/api/plans/${id}/session`) {
        await heldClaim;
        return claimPlan(request, context);
      }
      if (url !== `/api/plans/${id}?view=receipt`) throw new Error(`Unexpected fixture request: ${url}`);
      const response = await readPlan(request, context);
      statuses.push(response.status);
      const decode = response.json.bind(response);
      response.json = () => (bodyRead = decode());
      if (response.status === 403) firstRead();
      if (response.status === 200) ownedRead();
      return response;
    }));
    await act(async () => {
      root.render(createElement(Fragment, null,
        createElement(ActivePlanMarker, { id, startTime: "2026-11-14T19:00:00.000Z" }),
        createElement(PlanNightReceipt, { planId: id }),
      ));
    });
    await act(async () => { await initialReceipt; });
    expect(receiptOnScreen()).toBeNull();
    await act(async () => { finishClaim(); });
    await act(async () => { await ownerReceipt; });
    await settle();
    expect(receiptOnScreen()?.textContent).toContain("Claimed receipt night");
    expect(statuses).toEqual([403, 200]);
  });

  it("does not repeat a refused receipt read after a failed account claim", async () => {
    receiptAnswer = async () => refused();
    await act(async () => {
      root.render(createElement(Fragment, null,
        createElement(ActivePlanMarker, { id: PLAN_ID, startTime: "2026-11-14T19:00:00.000Z" }),
        createElement(PlanNightReceipt, { planId: PLAN_ID }),
      ));
    });
    await settle();
    expect(receiptOnScreen()).toBeNull();
    expect(receiptReads()).toHaveLength(1);
  });

  it("reads once for an already-bound host, including after its token refreshes", async () => {
    claimAnswer = async () => json({ claimed: false, role: "host" });
    receiptAnswer = async () => json({ receipt: RECEIPT });
    const mountedPlan = () => createElement(Fragment, null,
      createElement(ActivePlanMarker, { id: PLAN_ID, startTime: "2026-11-14T19:00:00.000Z" }),
      createElement(PlanNightReceipt, { planId: PLAN_ID }),
    );
    await act(async () => { root.render(mountedPlan()); });
    await settle();
    expect(receiptOnScreen()).not.toBeNull();
    expect(receiptReads()).toHaveLength(1);

    auth.account = { ...ACCOUNT_A, token: "refreshed-token-a" };
    await act(async () => { root.render(mountedPlan()); });
    await settle();
    expect(receiptOnScreen()).not.toBeNull();
    expect(receiptReads()).toHaveLength(2);
  });

  it.each([
    ["a server outage", async () => json({ retryable: true }, 503)],
    ["a network failure", async () => { throw new TypeError("Failed to fetch"); }],
  ] as Array<[string, Answer]>)("offers a retry after %s without keeping private receipt data", async (_label, failure) => {
    vi.useFakeTimers();
    await show();
    receiptAnswer = failure;
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await act(async () => { await vi.advanceTimersByTimeAsync(150); });
    await settle();
    expect(receiptOnScreen()).toBeNull();
    const retry = container.querySelector<HTMLButtonElement>("button");
    expect(retry).not.toBeNull();
    receiptAnswer = ownerOnly;
    await act(async () => { retry!.click(); });
    await settle();
    expect(receiptReads()).toHaveLength(3);
    expect(receiptOnScreen()).not.toBeNull();
  });

  it("restores an unavailable receipt when the network returns without a focus change", async () => {
    vi.useFakeTimers();
    await show();
    receiptAnswer = async () => json({ retryable: true }, 503);
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await act(async () => { await vi.advanceTimersByTimeAsync(150); });
    await settle();
    expect(receiptOnScreen()).toBeNull();
    receiptAnswer = ownerOnly;
    await act(async () => { window.dispatchEvent(new Event("online")); });
    await act(async () => { await vi.advanceTimersByTimeAsync(150); });
    await settle();
    expect(receiptReads()).toHaveLength(3);
    expect(receiptOnScreen()).not.toBeNull();
  });

  it("recovers an exhausted transient host claim when the app returns", async () => {
    vi.useFakeTimers();
    let bound = false;
    let available = false;
    claimAnswer = async () => {
      if (!available) return json({ retryable: true }, 503);
      bound = true;
      return json({ claimed: true });
    };
    receiptAnswer = async () => bound ? json({ receipt: RECEIPT }) : refused();
    await act(async () => {
      root.render(createElement(Fragment, null,
        createElement(ActivePlanMarker, { id: PLAN_ID, startTime: "2026-11-14T19:00:00.000Z" }),
        createElement(PlanNightReceipt, { planId: PLAN_ID }),
      ));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(1_250); });
    expect(receiptOnScreen()).toBeNull();
    available = true;
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await act(async () => { await vi.advanceTimersByTimeAsync(150); });
    await settle();
    expect(receiptOnScreen()).not.toBeNull();
  });

  it("checks once when visibility and focus both report the same return", async () => {
    vi.useFakeTimers();
    await show();
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await settle();
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await settle();
    await act(async () => { await vi.advanceTimersByTimeAsync(150); });
    await settle();
    expect(receiptReads()).toHaveLength(2);
    expect(receiptOnScreen()).not.toBeNull();
  });

  it("does not retry a definite account-claim refusal on resume", async () => {
    vi.useFakeTimers();
    receiptAnswer = async () => refused();
    await act(async () => {
      root.render(createElement(Fragment, null,
        createElement(ActivePlanMarker, { id: PLAN_ID, startTime: "2026-11-14T19:00:00.000Z" }),
        createElement(PlanNightReceipt, { planId: PLAN_ID }),
      ));
    });
    await settle();
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(150);
    });
    await settle();
    expect(calls.filter(call => call.url === `/api/plans/${PLAN_ID}/session`)).toHaveLength(1);
    expect(receiptOnScreen()).toBeNull();
  });

  it("shows the bound host account its receipt from the account-bound read", async () => {
    await show();

    expect(receiptOnScreen()?.textContent).toContain("Your night receipt");
    expect(receiptReads()).toEqual([
      expect.objectContaining({ bearer: `Bearer ${ACCOUNT_A.token}` }),
    ]);
  });

  it("drops the receipt when account B signs in on the device that holds account A's host cookie", async () => {
    await show();
    expect(receiptOnScreen()).not.toBeNull();

    auth.account = ACCOUNT_B;
    await act(async () => {
      root.render(createElement(PlanNightReceipt, { planId: PLAN_ID }));
    });
    expect(receiptOnScreen()).toBeNull();
    await settle();

    expect(receiptOnScreen()).toBeNull();
    expect(receiptReads().at(-1)?.bearer).toBe(`Bearer ${ACCOUNT_B.token}`);
  });

  it("shows a signed-out reader who holds the host cookie no receipt", async () => {
    auth.account = null;
    await show();

    expect(receiptOnScreen()).toBeNull();
  });

  it("shows a guest no receipt", async () => {
    planSession.role = "guest";
    await show();

    expect(receiptOnScreen()).toBeNull();
  });

  it("shows no receipt when the server cannot bind the host seat to this account", async () => {
    receiptAnswer = async () => refused();
    await show();

    expect(receiptOnScreen()).toBeNull();
  });

  it.each([
    ["a refusal", async () => refused()],
    ["an unavailable check", async () => json({ error: "Plan data is temporarily unavailable.", code: "PLAN_RECEIPT_UNAVAILABLE", retryable: true }, 503)],
    ["an unreadable answer", async () => new Response("<html>", { status: 200 })],
    ["a failed request", async () => { throw new TypeError("Failed to fetch"); }],
  ] as Array<[string, Answer]>)("clears a shown receipt when the check on return to the app meets %s", async (_label, answer) => {
    vi.useFakeTimers();
    await show();
    expect(receiptOnScreen()).not.toBeNull();

    receiptAnswer = answer;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(150); });
    await settle();

    expect(receiptReads()).toHaveLength(2);
    expect(receiptOnScreen()).toBeNull();
  });

  it.each([
    ["an invalid planned date", { ...RECEIPT, plannedFor: "not-a-date" }],
    ["a missing pub name", { ...RECEIPT, stops: [{ position: 0, price: null }] }],
    ["a missing price amount", { ...RECEIPT, stops: [{ position: 0, venueName: "The First Pub", price: {
      drink: "White wine", source: "community", reportedAt: "2026-11-14T19:00:00.000Z",
    } }] }],
    ["an invalid price date", { ...RECEIPT, stops: [{ position: 0, venueName: "The First Pub", price: {
      drink: "White wine", pence: 550, source: "community", reportedAt: "not-a-date",
    } }] }],
  ])("does not show a well-formed response containing %s", async (_label, receipt) => {
    receiptAnswer = async () => json({ receipt });
    await show();
    expect(receiptOnScreen()).toBeNull();
  });

  it("checks again when the app comes back into view", async () => {
    vi.useFakeTimers();
    await show();
    receiptAnswer = async () => refused();

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(150); });
    await settle();

    expect(receiptReads()).toHaveLength(2);
    expect(receiptOnScreen()).toBeNull();
  });

  it("aborts a read the departed account started and never shows its late answer", async () => {
    let finishLate: (response: Response) => void = () => {};
    receiptAnswer = ({ signal }) => new Promise<Response>((resolve) => {
      finishLate = resolve;
      void signal;
    });
    await show();
    const departed = receiptReads()[0];

    receiptAnswer = async () => refused();
    auth.account = ACCOUNT_B;
    await act(async () => {
      root.render(createElement(PlanNightReceipt, { planId: PLAN_ID }));
    });
    await settle();
    expect(departed?.signal?.aborted).toBe(true);

    finishLate(json({ receipt: RECEIPT }));
    await settle();
    expect(receiptOnScreen()).toBeNull();
  });
});

// AuthProvider publishes the Supabase account to the shared provider seam
// before its children render. ClerkAuthRevision publishes Clerk later, which
// aborts every action bound to the shared account signal.
describe("a provider interruption while the same account stays signed in", () => {
  const held: Answer = ({ signal }) => new Promise<Response>((_resolve, reject) => {
    signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  });
  const claims = () => calls.filter((call) => call.url === `/api/plans/${PLAN_ID}/session`);
  const statusText = () => container.querySelector('[role="status"]')?.textContent ?? "";
  const mountBoth = async () => {
    await act(async () => {
      root.render(createElement(Fragment, null,
        createElement(ActivePlanMarker, { id: PLAN_ID, startTime: "2026-11-14T19:00:00.000Z" }),
        createElement(PlanNightReceipt, { planId: PLAN_ID }),
      ));
    });
    await settle();
  };

  beforeEach(() => { setProviderIdentity("supabase", ACCOUNT_A.id); });

  it("reads the receipt again with a fresh lifetime instead of reporting an outage", async () => {
    receiptAnswer = held;
    await show();
    receiptAnswer = ownerOnly;
    await act(async () => { setProviderIdentity("clerk", "clerk-account"); });
    await settle();
    expect(receiptReads()).toHaveLength(2);
    expect(receiptReads()[0]?.signal?.aborted).toBe(true);
    expect(receiptReads()[1]?.signal?.aborted).toBe(false);
    expect(container.querySelector("button")).toBeNull();
    expect(statusText()).toBe("");
    expect(receiptOnScreen()).not.toBeNull();
  });

  it("bounds the fresh read by its own receipt deadline", async () => {
    vi.useFakeTimers();
    receiptAnswer = held;
    await show();
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    await act(async () => { setProviderIdentity("clerk", "clerk-account"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(7_999); });
    expect(receiptReads()).toHaveLength(2);
    expect(container.querySelector("button")).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(receiptReads()[1]?.signal?.aborted).toBe(true);
    expect(receiptReads()).toHaveLength(2);
    expect(container.querySelector("button")?.textContent).toBe("Try again");
  });

  it.each([
    ["another account", ACCOUNT_B.id],
    ["sign-out", null],
  ])("never reads again for the departed account after %s", async (_name, next) => {
    let late!: (response: Response) => void;
    receiptAnswer = () => new Promise<Response>((resolve) => { late = resolve; });
    await show();
    await act(async () => { setProviderIdentity("supabase", next); });
    await settle();
    expect(receiptReads()).toHaveLength(1);
    expect(receiptReads()[0]?.signal?.aborted).toBe(true);
    await act(async () => { late(json({ receipt: RECEIPT })); });
    await settle();
    expect(receiptOnScreen()).toBeNull();
    expect(receiptReads()).toHaveLength(1);
  });

  it("claims the host seat again and then shows the receipt", async () => {
    let bound = false;
    claimAnswer = held;
    receiptAnswer = async () => (bound ? json({ receipt: RECEIPT }) : refused());
    await mountBoth();
    expect(claims()).toHaveLength(1);
    expect(receiptOnScreen()).toBeNull();
    claimAnswer = async () => { bound = true; return json({ claimed: true }); };
    await act(async () => { setProviderIdentity("clerk", "clerk-account"); });
    await settle();
    expect(claims()).toHaveLength(2);
    expect(claims()[0]?.signal?.aborted).toBe(true);
    expect(claims()[1]?.signal?.aborted).toBe(false);
    expect(receiptOnScreen()).not.toBeNull();
  });

  it("does not claim again for the departed account", async () => {
    claimAnswer = held;
    receiptAnswer = async () => refused();
    await mountBoth();
    await act(async () => { setProviderIdentity("supabase", ACCOUNT_B.id); });
    await settle();
    expect(claims()).toHaveLength(1);
    expect(claims()[0]?.signal?.aborted).toBe(true);
  });

  it("sends no second claim or read when the claim and receipt already finished", async () => {
    claimAnswer = async () => json({ claimed: false, role: "host" });
    await mountBoth();
    expect(receiptOnScreen()).not.toBeNull();
    await act(async () => { setProviderIdentity("clerk", "clerk-account"); });
    await settle();
    expect(claims()).toHaveLength(1);
    expect(receiptReads()).toHaveLength(1);
    expect(receiptOnScreen()).not.toBeNull();
  });
});
