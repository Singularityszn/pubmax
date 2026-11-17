// @vitest-environment jsdom

import { act, createElement } from "react";
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

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: auth.account ? { id: auth.account.id } : null,
    session: auth.account
      ? { access_token: auth.account.token, user: { id: auth.account.id } }
      : null,
    identityResolved: auth.identityResolved,
    loading: false,
  }),
}));
vi.mock("@/lib/planSessionCapability", () => ({
  parsePlanCapabilitySnapshot: () => ({ token: "", collaborationAuthorized: true, role: planSession.role }),
  planCapabilityEvent: (id: string) => `pubmax:plan-capability:${id}`,
  readPlanCapabilitySnapshot: () => (planSession.role ? `|1|${planSession.role}` : "|0|"),
}));

import PlanNightReceipt from "@/components/plan/PlanNightReceipt";

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
let root: Root;
let container: HTMLDivElement;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
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
  for (let turn = 0; turn < 5; turn += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
  calls = [];
  receiptAnswer = ownerOnly;
  planSession.role = "host";
  auth.account = ACCOUNT_A;
  auth.identityResolved = true;
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const call = { url, bearer: new Headers(init.headers).get("authorization"), signal: init.signal ?? undefined };
    calls.push(call);
    if (url === `/api/plans/${PLAN_ID}`) return Promise.resolve(json(COMPLETED_PLAN));
    if (url === `/api/plans/${PLAN_ID}?view=receipt`) return receiptAnswer(call);
    return Promise.resolve(json({}, 404));
  }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("the private Night Receipt on the Plan page", () => {
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
    await show();
    expect(receiptOnScreen()).not.toBeNull();

    receiptAnswer = answer;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await settle();

    expect(receiptReads()).toHaveLength(2);
    expect(receiptOnScreen()).toBeNull();
  });

  it("checks again when the app comes back into view", async () => {
    await show();
    receiptAnswer = async () => refused();

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
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
