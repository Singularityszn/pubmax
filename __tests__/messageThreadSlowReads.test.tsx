// @vitest-environment jsdom

// A THREAD READ SLOWER THAN THE POLL STILL LANDS. An upstream 503 that the SDK
// retries keeps the thread read in flight for longer than the five-second
// fallback poll, and each poll used to supersede the read before it, so no
// answer ever landed and a cold load sat on the loading line for as long as the
// outage lasted. A COLD FAILURE IS READ FROM THE TOP: the page used to be pinned
// to its foot before any thread was drawn, which pushed the retry panel above a
// phone's fold. The oracle here is what a reader sees, never the component's
// internals: the retry panel, the bubble, and where the page was scrolled.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const viewer = vi.hoisted(() => ({
  current: { user: { id: "account-a" } as { id: string } | null, handle: "alice" as string | null, accountRevision: 1 },
}));
const transport = vi.hoisted(() => ({
  reads: [] as Array<{ url: string; resolve: (response: Response) => void; reject: (error: Error) => void }>,
}));
const realtime = vi.hoisted(() => ({ poll: null as (() => void) | null }));

vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => viewer.current }));
vi.mock("@/components/auth/useViewerSession", () => ({
  useViewerSession: () => ({ phase: "signed-in", signedIn: true, signedOut: false, unresolved: false }),
}));
vi.mock("@/components/auth/SignInButton", () => ({ default: () => null }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children?: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));
vi.mock("@/lib/messagesRealtime", () => ({
  subscribeToMessages: (_id: string, _signal: () => void, options?: { poll?: () => void }) => {
    realtime.poll = options?.poll ?? null;
    return () => {
      realtime.poll = null;
    };
  },
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/useDismissOnEscape", () => ({ useDismissOnEscape: vi.fn() }));
vi.mock("@/lib/useFocusTrap", () => ({ useFocusTrap: vi.fn() }));
vi.mock("@/components/profile/ProfileImageCropper", () => ({ default: () => null }));
vi.mock("@/components/messages/MessageAvatar", () => ({ default: () => null }));
vi.mock("@/components/messages/MessagePhoto", () => ({ default: () => null }));
vi.mock("@/components/messages/MessageVenueCard", () => ({ default: () => null }));
vi.mock("@/lib/keyboardInset", () => ({ useKeyboardInset: () => 0 }));
vi.mock("@/lib/authedFetch", () => ({
  authedActionFetch: (input: string) =>
    new Promise<Response>((resolve, reject) => {
      transport.reads.push({ url: String(input), resolve, reject });
    }),
}));

import MessageThread from "@/components/messages/MessageThread";

let host: HTMLDivElement;
let root: Root;
let scrollTo: ReturnType<typeof vi.fn>;

function thread(body: string, conversationId = "conversation-a"): Response {
  return Response.json({
    messages: [
      {
        id: `message-${body}`,
        conversationId,
        senderHandle: "bridget",
        body,
        createdAt: "2026-10-04T12:00:00.000Z",
        read: true,
        flagged: false,
      },
    ],
  });
}

function outage(): Response {
  return Response.json(
    { error: "Messages are unavailable right now.", code: "UNAVAILABLE", retryable: true },
    { status: 503 },
  );
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function render(conversationId = "conversation-a"): Promise<void> {
  await act(async () => {
    root.render(createElement(MessageThread, { conversationId }));
  });
  await settle();
}

/** Answer one pending read: the oldest by default, or one picked by its URL. */
async function answer(response: Response | Error, urlPart?: string): Promise<void> {
  const index = transport.reads.findIndex((read) => !urlPart || read.url.includes(urlPart));
  const [read] = transport.reads.splice(index, 1);
  if (!read) throw new Error(`No pending read${urlPart ? ` for ${urlPart}` : ""}`);
  await act(async () => {
    if (response instanceof Error) read.reject(response);
    else read.resolve(response);
  });
  await settle();
}

async function answerLatest(response: Response): Promise<void> {
  const read = transport.reads.pop();
  if (!read) throw new Error("No pending read");
  await act(async () => read.resolve(response));
  await settle();
}

async function poll(): Promise<void> {
  await act(async () => {
    realtime.poll?.();
  });
  await settle();
}

function retryPanel(): HTMLElement | null {
  return host.querySelector<HTMLElement>(".threadFailure");
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  viewer.current = { user: { id: "account-a" }, handle: "alice", accountRevision: 1 };
  transport.reads = [];
  realtime.poll = null;
  window.localStorage.setItem("pubmax_handle", "alice");
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  });
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: () => {} });
  // A phone page taller than its viewport, so a scroll to the foot is a real move.
  Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, get: () => 976 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
  scrollTo = vi.fn();
  Object.defineProperty(window, "scrollTo", { configurable: true, value: scrollTo });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  delete (document.documentElement as { scrollHeight?: number }).scrollHeight;
});

it("lands a cold read that outlasts the poll, and the reader recovers through it", async () => {
  await render();
  expect(transport.reads).toHaveLength(1);
  // The poll fires while the first read is still waiting on upstream retries.
  await poll();
  expect(transport.reads).toHaveLength(2);

  await answer(outage());
  expect(retryPanel()?.textContent).toContain("Try again");
  expect(host.textContent).not.toContain("With you in a sec.");

  // The outage clears: the next read to land draws the thread.
  await answer(thread("Meet at seven"));
  expect(retryPanel()).toBeNull();
  expect(host.textContent).toContain("Meet at seven");
});

it("keeps landing reads through an outage longer than several polls", async () => {
  await render();
  await poll();
  await answer(outage());
  await poll();
  await answer(outage());
  await poll();
  expect(retryPanel()).not.toBeNull();

  await answer(outage());
  await answer(thread("Back again"));
  expect(host.textContent).toContain("Back again");
  expect(retryPanel()).toBeNull();
});

it("drops an older read that answers after a newer one has landed", async () => {
  await render();
  await poll();
  await poll();
  await answerLatest(thread("Newest"));
  // The two older reads answer late: one with stale rows, one with a failure.
  await answer(thread("Stale"));
  await answer(outage());
  expect(host.textContent).toContain("Newest");
  expect(host.textContent).not.toContain("Stale");
  expect(retryPanel()).toBeNull();
});

it("keeps a loaded thread when a slow failing poll lands", async () => {
  await render();
  await answer(thread("Meet at seven"));
  await poll();
  await poll();
  await answer(outage());
  expect(host.textContent).toContain("Meet at seven");
  expect(retryPanel()).toBeNull();
});

it("never draws a delayed read from the previous account", async () => {
  await render();
  await poll();
  viewer.current = { user: { id: "account-b" }, handle: "bob", accountRevision: 2 };
  window.localStorage.setItem("pubmax_handle", "bob");
  await render();

  // Both of account A's reads answer late; neither may reach account B's screen.
  await answer(thread("Account A private note"), "handle=alice");
  await answer(outage(), "handle=alice");
  expect(host.textContent).not.toContain("Account A private note");
  expect(retryPanel()).toBeNull();
  expect(host.textContent).toContain("With you in a sec.");

  await answer(thread("Account B note"), "handle=bob");
  expect(host.textContent).toContain("Account B note");
  expect(host.textContent).not.toContain("Account A private note");
});

it("never draws a delayed read from the previous conversation, even on the way back", async () => {
  await render("conversation-a");
  await poll();
  await render("conversation-b");
  await render("conversation-a");

  // Every read sent before the switch answers first. None of them may land.
  await answer(thread("Old A"), "conversation-a");
  await answer(outage(), "conversation-a");
  await answer(thread("B content", "conversation-b"), "conversation-b");
  expect(host.textContent).toContain("With you in a sec.");
  expect(retryPanel()).toBeNull();

  await answer(thread("Fresh A"), "conversation-a");
  expect(host.textContent).toContain("Fresh A");
  expect(host.textContent).not.toContain("Old A");
  expect(host.textContent).not.toContain("B content");
});

it("leaves a cold failure at the top of the page, and still scrolls a loaded thread to its newest", async () => {
  await render();
  await answer(outage());
  expect(retryPanel()).not.toBeNull();
  expect(scrollTo).not.toHaveBeenCalled();

  const retry = host.querySelector<HTMLButtonElement>(".threadRetryBtn");
  expect(retry?.textContent).toBe("Try again");
  await act(async () => retry?.click());
  await settle();
  expect(scrollTo).not.toHaveBeenCalled();
  await answer(thread("Meet at seven"));
  expect(host.textContent).toContain("Meet at seven");
  expect(scrollTo).toHaveBeenLastCalledWith({ top: 976 });
});
