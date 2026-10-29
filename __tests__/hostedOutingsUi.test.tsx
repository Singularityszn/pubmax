// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const boundary = vi.hoisted(() => ({
  user: { id: "account-a" } as { id: string } | null,
  signedIn: true,
  read: vi.fn(),
  write: vi.fn(),
}));
vi.mock("@/components/auth/authContext", () => ({ useAuth: () => ({ user: boundary.user }) }));
vi.mock("@/components/auth/useViewerSession", () => ({ useViewerSession: () => ({ signedIn: boundary.signedIn, signedOut: !boundary.signedIn, unresolved: false }) }));
vi.mock("@/lib/authedFetch", () => ({ authedFetch: boundary.read, signedInActionFetch: boundary.write }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }) }));
vi.mock("next/link", () => ({
  useLinkStatus: () => ({ pending: false }),
  default: ({ href, children, ...props }: { href: string; children?: ReactNode; prefetch?: boolean }) => {
    const domProps = { ...props }; delete domProps.prefetch;
    return createElement("a", { href, ...domProps }, children);
  },
}));
import HostedOutingsClient from "@/app/hosted-outings/HostedOutingsClient";
const outing = {
  id: "70000000-0000-4000-8000-000000000001", title: "Real listed outing", venueId: "venue-fixture", venueName: "Listed public pub",
  startsAt: "2099-01-01T18:00:00Z", capacity: 6, status: "open", revision: 1,
  venueConfirmed: true, moderatorActive: true, moderatorName: "Named host", enrollmentEnabled: false, signupAllowed: false, confirmationAllowed: false,
  operator: false, moderator: false, attendance: null, candidates: [], blockedPairs: [], reports: [], ownReport: null,
  feedback: null, group: [], announcement: "", groupExplanation: null, groupBudgetPence: null, feedbackSummary: null,
};
let host: HTMLDivElement;
let root: Root;
const response = (event: Record<string, unknown>) => Response.json({ outings: [event], staff: false, moderationOwners: [] });
const button = (text: string) => Array.from(host.querySelectorAll("button")).find((node) => node.textContent === text);
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  boundary.user = { id: "account-a" };
  boundary.signedIn = true;
  boundary.read.mockReset(); boundary.write.mockReset();
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
async function render() { await act(async () => { root.render(createElement(HostedOutingsClient)); }); }
async function open() { await act(async () => button("View outing")?.click()); }

it("keeps the signup form absent while enrollment is held", async () => {
  boundary.read.mockImplementation(async () => response(outing));
  await render(); await open();
  expect(host.textContent).toContain("Signups are closed until the venue and hosting team are ready.");
  expect(button("Join waiting list")).toBeUndefined();
  expect(boundary.write).not.toHaveBeenCalled();
});

it("shows waiting status only after the API stores the signup", async () => {
  boundary.read.mockImplementation(async () => response({ ...outing, enrollmentEnabled: true, signupAllowed: true }));
  boundary.write.mockResolvedValue(response({ ...outing, enrollmentEnabled: true, signupAllowed: true, attendance: { state: "waiting", pace: "easy", budgetPence: 2000 } }));
  await render(); await open();
  const form = button("Join waiting list")?.closest("form");
  expect(form).not.toBeNull();
  await act(async () => { form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  expect(host.textContent).toContain("You are on the waiting list.");
  expect(host.textContent).not.toContain("Confirm my place");
  expect(JSON.parse(String(boundary.write.mock.calls[0]?.[1]?.body))).toEqual({ action: "join", revision: 1, pace: "easy", budgetPence: 2000 });
});

it("hides the previous account's private outing data while the next account loads", async () => {
  boundary.read.mockImplementation(async () => response({ ...outing, attendance: { state: "cancelled", pace: "easy", budgetPence: 2000 }, ownReport: { body: "Account A private report", status: "open" } }));
  await render(); await open();
  expect(host.querySelector("textarea")?.value).toBe("Account A private report");
  boundary.user = { id: "account-b" };
  boundary.read.mockImplementation(() => new Promise(() => undefined));
  await render();
  expect(host.querySelector("textarea")).toBeNull();
  expect(host.textContent).not.toContain("Your place: cancelled");
});


it("hides new signup when the outing operator is inactive", async () => {
  boundary.read.mockImplementation(async () => response({ ...outing, enrollmentEnabled: true, signupAllowed: false, confirmationAllowed: true }));
  await render(); await open();
  expect(button("Join waiting list")).toBeUndefined();
  expect(boundary.write).not.toHaveBeenCalled();
});

it("keeps an already-approved confirmation available with an active moderator after operator departure", async () => {
  boundary.read.mockImplementation(async () => response({ ...outing, enrollmentEnabled: true, signupAllowed: false, confirmationAllowed: true,
    attendance: { state: "approved", pace: "easy", budgetPence: 2000 },
  }));
  await render(); await open();
  expect(button("Join waiting list")).toBeUndefined();
  expect(button("Confirm my place")?.disabled).toBe(false);
});


it("ends a stalled read and lets the person retry", async () => {
  vi.useFakeTimers();
  boundary.read.mockImplementation((_input: RequestInfo | URL, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
  }));
  await render();
  expect(button("Loading outings")?.disabled).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(31_000); });
  const retry = button("Try again");
  expect(retry?.disabled).toBe(false);
  boundary.read.mockResolvedValue(response(outing));
  await act(async () => retry?.click());
  expect(host.textContent).toContain("Real listed outing");
});


it("ends a stalled join without claiming success or sending a duplicate, then recovers the stored state", async () => {
  boundary.read.mockImplementation(async () => response({ ...outing, enrollmentEnabled: true, signupAllowed: true,
    attendance: { state: "cancelled", pace: "easy", budgetPence: 2000 },
  }));
  await render(); await open();
  vi.useFakeTimers();
  boundary.write.mockImplementation((_input: RequestInfo | URL, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
  }));
  const form = button("Join waiting list")?.closest("form");
  await act(async () => { form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  expect(button("Join waiting list")?.disabled).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(31_000); });
  expect(button("Join waiting list")?.disabled).toBe(false);
  expect(host.textContent).toContain("Your place: cancelled");
  expect(host.textContent).not.toContain("Your place: waiting");
  expect(host.textContent).not.toContain("Saved.");
  expect(boundary.write).toHaveBeenCalledTimes(1);
  boundary.read.mockImplementation(async () => response({ ...outing, enrollmentEnabled: true,
    attendance: { state: "waiting", pace: "easy", budgetPence: 2000 },
  }));
  await act(async () => button("All outings")?.click());
  expect(host.textContent).toContain("Your place: waiting");
  expect(boundary.write).toHaveBeenCalledTimes(1);
});


it("ends a stalled response body and lets the person retry", async () => {
  vi.useFakeTimers();
  boundary.read.mockImplementation(async (_input: RequestInfo | URL, init: RequestInit) => ({
    ok: true,
    json: () => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }),
  }));
  await render();
  await act(async () => { await vi.advanceTimersByTimeAsync(31_000); });
  const retry = button("Try again");
  expect(retry?.disabled).toBe(false);
  boundary.read.mockResolvedValue(response(outing));
  await act(async () => retry?.click());
  expect(host.textContent).toContain("Real listed outing");
});


it("clears busy and private outing data when the person signs out during a pending read", async () => {
  boundary.read.mockImplementation(async () => response({ ...outing,
    attendance: { state: "confirmed", pace: "easy", budgetPence: 2000 },
    ownReport: { body: "Private report before sign-out", status: "open" },
  }));
  await render(); await open();
  expect(host.querySelector("textarea")?.value).toBe("Private report before sign-out");
  vi.useFakeTimers();
  boundary.read.mockImplementation((_input: RequestInfo | URL, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
  }));
  await act(async () => button("All outings")?.click());
  expect(host.querySelector("main")?.getAttribute("aria-busy")).toBe("true");
  boundary.user = null;
  boundary.signedIn = false;
  await render();
  expect(host.querySelector("main")?.getAttribute("aria-busy")).toBe("false");
  expect(host.querySelector("textarea")).toBeNull();
  expect(host.textContent).not.toContain("Private report before sign-out");
  expect(host.textContent).not.toContain("Your place: confirmed");
  expect(host.querySelector('a[href^="/login"]')).not.toBeNull();
});


it.each([
  { status: 401, code: "SOCIAL_SIGN_IN_REQUIRED" },
  { status: 403, code: "SOCIAL_ACCOUNT_SUSPENDED" },
  { status: 403, code: "SOCIAL_ADULT_VERIFICATION_REQUIRED" },
])("clears private outing data after access is refused: $code", async ({ status, code }) => {
  boundary.read.mockImplementation(async () => response({ ...outing,
    attendance: { state: "confirmed", pace: "easy", budgetPence: 2000 },
    ownReport: { body: "Private report before access refusal", status: "open" },
  }));
  await render(); await open();
  expect(host.querySelector("textarea")?.value).toBe("Private report before access refusal");
  boundary.read.mockResolvedValue(Response.json({ error: "This account cannot access Social.", code, retryable: false }, { status }));
  await act(async () => button("All outings")?.click());
  expect(host.querySelector("textarea")).toBeNull();
  expect(host.textContent).not.toContain("Private report before access refusal");
  expect(host.textContent).not.toContain("Your place: confirmed");
  expect(button("Try again")).toBeUndefined();
  expect(button("Join waiting list")).toBeUndefined();
  if (status === 401) expect(host.querySelector('a[href^="/login"]')).not.toBeNull();
  else expect(host.querySelector('a[href="/social"]')).not.toBeNull();
  expect(boundary.write).not.toHaveBeenCalled();
});

it("uses the existing Social recovery path for an adult-access refusal without offering a local assertion", async () => {
  boundary.read.mockResolvedValue(Response.json({ error: "Adult verification is needed for Social.", code: "SOCIAL_ADULT_VERIFICATION_REQUIRED", retryable: false }, { status: 403 }));
  await render();
  expect(button("Try again")).toBeUndefined();
  expect(host.querySelector('a[href="/social"]')).not.toBeNull();
  expect(host.textContent).not.toContain("I am 18 or over");
  expect(boundary.write).not.toHaveBeenCalled();
});


it("clears private data from denial headers before the body arrives and keeps useful error text", async () => {
  boundary.read.mockImplementation(async () => response({ ...outing,
    attendance: { state: "confirmed", pace: "easy", budgetPence: 2000 },
    ownReport: { body: "Private report before denied headers", status: "open" },
  }));
  await render(); await open();
  let body: ReadableStreamDefaultController<Uint8Array> | undefined;
  const stream = new ReadableStream<Uint8Array>({ start(controller) { body = controller; } });
  boundary.read.mockResolvedValue(new Response(stream, { status: 403, headers: { "content-type": "application/json" } }));
  await act(async () => button("All outings")?.click());
  try {
    expect(host.querySelector("textarea")).toBeNull();
    expect(host.textContent).not.toContain("Private report before denied headers");
    expect(host.querySelector("main")?.getAttribute("aria-busy")).toBe("false");
    expect(host.querySelector('a[href="/social"]')?.textContent).toBe("Check Social access");
  } finally {
    await act(async () => {
      body?.enqueue(new TextEncoder().encode(JSON.stringify({ error: "Social access is suspended.", code: "SOCIAL_ACCOUNT_SUSPENDED", retryable: false })));
      body?.close();
    });
  }
  expect(host.textContent).toContain("Social access is suspended.");
  expect(button("Try again")).toBeUndefined();
});

it("clears private data from sign-in refusal headers even when the body is malformed", async () => {
  boundary.read.mockImplementation(async () => response({ ...outing,
    attendance: { state: "confirmed", pace: "easy", budgetPence: 2000 },
    ownReport: { body: "Private report before malformed denial", status: "open" },
  }));
  await render(); await open();
  boundary.read.mockResolvedValue(new Response("{", { status: 401, headers: { "content-type": "application/json" } }));
  await act(async () => button("All outings")?.click());
  expect(host.querySelector("textarea")).toBeNull();
  expect(host.textContent).not.toContain("Private report before malformed denial");
  expect(host.querySelector('a[href^="/login"]')?.textContent).toBe("Sign in again");
  expect(button("Try again")).toBeUndefined();
});


it.each(["approved", "confirmed"])("reports the stored state when a retried join returns %s", async (state) => {
  boundary.read.mockImplementation(async () => response({ ...outing, enrollmentEnabled: true, signupAllowed: true,
    attendance: { state: "cancelled", pace: "easy", budgetPence: 2000 },
  }));
  boundary.write.mockResolvedValue(response({ ...outing, enrollmentEnabled: true, signupAllowed: false, confirmationAllowed: true,
    attendance: { state, pace: "easy", budgetPence: 2000 },
  }));
  await render(); await open();
  const form = button("Join waiting list")?.closest("form");
  await act(async () => { form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  expect(host.textContent).toContain(`Your place: ${state}`);
  expect(host.textContent).not.toContain("You are on the waiting list.");
  expect(host.textContent).toContain(state === "approved" ? "Your group is approved." : "Your place is already confirmed.");
  if (state === "approved") expect(button("Confirm my place")?.disabled).toBe(false);
  else expect(button("Confirm my place")).toBeUndefined();
});
