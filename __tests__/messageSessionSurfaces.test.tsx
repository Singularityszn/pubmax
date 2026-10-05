// @vitest-environment jsdom

import { act, createElement, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  current: {} as {
    user: { id: string } | null;
    handle: string | null;
    accountRevision: number;
  },
}));
const viewerState = vi.hoisted(() => ({
  current: {} as {
    phase: "unresolved" | "signed-in" | "signed-out";
    signedIn: boolean;
    signedOut: boolean;
    unresolved: boolean;
  },
}));
const routerState = vi.hoisted(() => ({ push: vi.fn() }));
const inboxEvents = vi.hoisted(() => ({
  signal: null as (() => void) | null,
  poll: null as (() => void) | null,
}));
const fetchState = vi.hoisted(() => ({
  pending: false,
  calls: 0,
  requests: [] as Array<{
    url: string;
    resolve: (response: Response) => void;
    reject: (error: Error) => void;
    signal?: AbortSignal;
  }>,
  response: null as (() => Response) | null,
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => authState.current,
}));
vi.mock("@/components/auth/useViewerSession", () => ({
  useViewerSession: () => viewerState.current,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => routerState,
}));
vi.mock("@/components/auth/SignInButton", () => ({
  default: () => createElement("button", { type: "button" }, "Continue with email"),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children?: ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));
vi.mock("@/lib/authedFetch", () => ({
  authedActionFetch: (input: string, init?: RequestInit) => {
    fetchState.calls += 1;
    if (fetchState.pending) {
      return new Promise<Response>((resolve, reject) => {
        fetchState.requests.push({ url: String(input), resolve, reject, signal: init?.signal ?? undefined });
      });
    }
    return Promise.resolve(
      fetchState.response?.() ?? Response.json({ conversations: [], messages: [] }),
    );
  },
}));
vi.mock("@/lib/messagesRealtime", () => ({
  subscribeToMessages: () => () => {},
  subscribeToInbox: (_handle: string, signal: () => void, options?: { poll?: () => void }) => {
    inboxEvents.signal = signal;
    inboxEvents.poll = options?.poll ?? null;
    return () => {
      inboxEvents.signal = null;
      inboxEvents.poll = null;
    };
  },
}));
vi.mock("@/components/messages/MessagesNewGroup", () => ({
  default: ({ open, onClose, onOpened }: {
    open?: boolean;
    onClose?: () => void;
    onOpened: (conversationId: string) => void;
  }) => open ? createElement("button", {
    type: "button",
    "data-testid": "complete-conversation-creation",
    onClick: () => {
      onClose?.();
      onOpened("group-hari-maisie");
    },
  }, "Complete conversation creation") : null,
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/useDismissOnEscape", () => ({ useDismissOnEscape: vi.fn() }));
vi.mock("@/lib/useFocusTrap", () => ({ useFocusTrap: vi.fn() }));
vi.mock("@/components/profile/ProfileImageCropper", () => ({ default: () => null }));

import MessagesInboxClient from "@/app/messages/MessagesInboxClient";
import MessageThread from "@/components/messages/MessageThread";
import { defined } from "@/__tests__/helpers/defined";

let host: HTMLDivElement;
let root: Root;

function signedOut(): void {
  authState.current = { user: null, handle: null, accountRevision: 0 };
  viewerState.current = {
    phase: "signed-out",
    signedIn: false,
    signedOut: true,
    unresolved: false,
  };
}

function signedIn(
  userId = "user-1",
  handle: string | null = "alice",
  accountRevision = 1,
): void {
  authState.current = { user: { id: userId }, handle, accountRevision };
  viewerState.current = {
    phase: "signed-in",
    signedIn: true,
    signedOut: false,
    unresolved: false,
  };
}

async function render(element: ReactElement): Promise<void> {
  await act(async () => {
    root.render(element);
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function completeCreation(): Promise<void> {
  const opener = host.querySelector<HTMLButtonElement>('button[aria-label="New message"]');
  expect(opener?.disabled).toBe(false);
  await act(async () => opener!.click());
  const created = host.querySelector<HTMLButtonElement>('[data-testid="complete-conversation-creation"]');
  expect(created).not.toBeNull();
  await act(async () => created!.click());
  expect(routerState.push).toHaveBeenLastCalledWith("/messages/group-hari-maisie");
}

async function releaseFetch(
  response?: Response | Error,
  urlPart?: string,
  latest = false,
): Promise<void> {
  const candidates = fetchState.requests
    .map((request, index) => ({ request, index }))
    .filter(({ request }) => !urlPart || request.url.includes(urlPart));
  const candidate = latest
    ? candidates[candidates.length - 1]
    : candidates[0];
  if (!candidate) return;
  fetchState.requests.splice(candidate.index, 1);
  if (fetchState.requests.length === 0) fetchState.pending = false;
  await act(async () => {
    if (response instanceof Error) candidate.request.reject(response);
    else candidate.request.resolve(response ?? Response.json({ conversations: [], messages: [] }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  signedOut();
  routerState.push.mockClear();
  fetchState.pending = false;
  fetchState.calls = 0;
  fetchState.requests = [];
  fetchState.response = null;
  inboxEvents.signal = null;
  inboxEvents.poll = null;
  window.matchMedia = (() => ({
    matches: false,
    media: "",
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  Element.prototype.scrollIntoView = () => {};
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  if (vi.isFakeTimers()) {
    vi.clearAllTimers();
    vi.useRealTimers();
  }
  while (fetchState.requests.length > 0) await releaseFetch();
  await act(async () => root.unmount());
  host.remove();
});

describe("message sign-in doors", () => {
  const createdGroup = {
    id: "group-hari-maisie",
    kind: "group",
    title: "Synthetic pub crew",
    memberHandles: ["alice", "hari", "maisie"],
    otherHandle: "hari",
    lastAt: "2026-10-01T19:00:00.000Z",
    lastFromMe: false,
    unread: 0,
  };

  it.each(["success", "http-failure", "network-failure"])("publishes slow %s reads despite recurring polls, focus and realtime", async (outcome) => {
    vi.useFakeTimers();
    signedIn();
    fetchState.pending = true;
    await render(createElement(MessagesInboxClient));
    expect(fetchState.calls).toBe(1);
    expect(inboxEvents.poll).not.toBeNull();
    expect(inboxEvents.signal).not.toBeNull();
    window.setInterval(() => inboxEvents.poll?.(), 15_000);
    const finishRead = (first: boolean) => {
      const request = fetchState.requests.shift()!;
      if (first && outcome === "network-failure") request.reject(new Error("network"));
      else request.resolve(first && outcome === "http-failure"
        ? new Response("unavailable", { status: 503 })
        : Response.json({ conversations: [{ ...createdGroup, title: first ? createdGroup.title : "Updated pub crew" }] }));
    };
    window.setTimeout(() => finishRead(true), 16_000);
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      inboxEvents.signal!();
    });
    expect(fetchState.calls).toBe(1);
    expect(fetchState.requests).toHaveLength(1);
    expect(host.textContent).toContain("With you in a sec.");
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(fetchState.requests).toHaveLength(0);
    expect(host.textContent).not.toContain("With you in a sec.");
    if (outcome === "success") expect(host.textContent).toContain(createdGroup.title);
    else expect(host.querySelector('[role="alert"]')?.textContent).toContain("Couldn’t load your conversations.");

    await act(async () => { await vi.advanceTimersByTimeAsync(14_000); });
    expect(fetchState.calls).toBe(2);
    expect(fetchState.requests).toHaveLength(1);
    window.setTimeout(() => finishRead(false), 16_000);
    if (outcome !== "success") {
      const retry = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Try again")!;
      retry.focus();
      await act(async () => { retry.click(); retry.click(); });
      expect(retry.disabled).toBe(false);
      expect(retry.getAttribute("aria-busy")).toBe("true");
      expect(document.activeElement).toBe(retry);
      expect(host.querySelector('[role="alert"]')).not.toBeNull();
    }
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(fetchState.calls).toBe(2);
    expect(fetchState.requests).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(host.textContent).toContain("Updated pub crew");
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.textContent).not.toContain("With you in a sec.");
    expect(host.textContent).not.toContain("Trying again");
  });

  it.each(["empty", "unauthorized", "unavailable", "thrown"])("keeps fresh group after stale initial %s response", async (stale) => {
    signedIn();
    fetchState.pending = true;
    await render(createElement(MessagesInboxClient, { activeConversationId: createdGroup.id }));
    expect(fetchState.requests).toHaveLength(1);
    expect(host.textContent).toContain("With you in a sec.");
    await completeCreation();
    expect(fetchState.requests).toHaveLength(2);
    await releaseFetch(Response.json({ conversations: [createdGroup] }), undefined, true);
    const link = () => host.querySelector(`a[href="/messages/${createdGroup.id}"]`);
    expect(link()?.textContent).toContain(createdGroup.title);
    expect(link()?.getAttribute("aria-current")).toBe("page");
    const oldResponse = stale === "thrown" ? new Error("network") : stale === "empty"
      ? Response.json({ conversations: [] })
      : new Response("stale failure", { status: stale === "unauthorized" ? 401 : 503 });
    const cancel = oldResponse instanceof Response ? vi.spyOn(oldResponse.body!, "cancel") : null;
    await releaseFetch(oldResponse);
    expect(link()?.textContent).toContain(createdGroup.title);
    expect(host.textContent).not.toContain("Your messages start here");
    expect(host.textContent).not.toContain("Couldn’t");
    expect(host.textContent).not.toContain("Sign in to message");
    expect(host.textContent).not.toContain("With you in a sec.");
    if (cancel) expect(cancel).toHaveBeenCalledOnce();
  });

  it("ignores older parsed body after newer group has loaded", async () => {
    signedIn();
    fetchState.pending = true;
    await render(createElement(MessagesInboxClient));
    let releaseBody!: () => void;
    const older = new Response(new ReadableStream({
      start(controller) {
        releaseBody = () => {
          controller.enqueue(new TextEncoder().encode(JSON.stringify({ conversations: [] })));
          controller.close();
        };
      },
    }), { headers: { "content-type": "application/json" } });
    await releaseFetch(older);
    fetchState.pending = true;
    await completeCreation();
    await releaseFetch(Response.json({ conversations: [createdGroup] }));
    expect(host.textContent).toContain(createdGroup.title);
    await act(async () => releaseBody());
    expect(host.textContent).toContain(createdGroup.title);
    expect(host.textContent).not.toContain("Your messages start here");
  });

  it("does not finish loading from superseded initial request", async () => {
    signedIn();
    fetchState.pending = true;
    await render(createElement(MessagesInboxClient));
    await completeCreation();
    await releaseFetch(Response.json({ conversations: [] }));
    expect(host.textContent).toContain("With you in a sec.");
    expect(host.textContent).not.toContain("Your messages start here");
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      inboxEvents.poll!();
      inboxEvents.signal!();
    });
    expect(fetchState.calls).toBe(2);
    await releaseFetch(Response.json({ conversations: [createdGroup] }));
    expect(host.textContent).toContain(createdGroup.title);
  });

  it("disposes pending initial and post-create responses after inbox unmount", async () => {
    signedIn();
    fetchState.pending = true;
    await render(createElement(MessagesInboxClient));
    const signal = defined(fetchState.requests[0]).signal;
    await completeCreation();
    expect(fetchState.requests).toHaveLength(2);
    await act(async () => root.render(null));
    expect(signal?.aborted).toBe(true);
    for (let i = 0; i < 2; i += 1) {
      const lateResponse = Response.json({ conversations: [createdGroup] });
      const cancel = vi.spyOn(lateResponse.body!, "cancel");
      await releaseFetch(lateResponse);
      expect(cancel).toHaveBeenCalledOnce();
    }
    expect(host.textContent).toBe("");
  });

  it("ignores an old anonymous inbox result once the session is signed in", async () => {
    await render(createElement(MessagesInboxClient));
    expect(host.textContent).toContain("Sign in to message");

    fetchState.pending = true;
    signedIn();
    await render(createElement(MessagesInboxClient));

    expect(host.textContent).not.toContain("Sign in to message");
    await releaseFetch();
  });

  it("keeps a stale thread result neutral until a new session read returns", async () => {
    await render(createElement(MessageThread, { conversationId: "conversation-1" }));
    expect(host.textContent).toContain("Sign in to read and send messages");

    fetchState.pending = true;
    signedIn();
    await render(createElement(MessageThread, { conversationId: "conversation-1" }));

    expect(host.textContent).not.toContain("Sign in to read and send messages");
    expect(host.textContent).toContain("With you in a sec.");
  });

  it("hides account A inbox content while account B is still loading", async () => {
    signedIn("account-a", "alice", 1);
    fetchState.response = () =>
      Response.json({
        conversations: [
          {
            id: "conversation-a",
            otherHandle: "bridget",
            lastBody: "Account A private note",
            lastAt: "2026-09-01T10:00:00.000Z",
            lastFromMe: false,
            unread: 0,
          },
        ],
      });
    await render(createElement(MessagesInboxClient));
    expect(host.textContent).toContain("Account A private note");

    fetchState.pending = true;
    signedIn("account-b", "bob", 2);
    await render(createElement(MessagesInboxClient));

    expect(host.textContent).not.toContain("Account A private note");
    expect(host.textContent).not.toContain("@bridget");
    expect(host.textContent).toContain("With you in a sec.");
    await releaseFetch(Response.json({ conversations: [] }));
  });

  it("gives a signed-in empty inbox one clear door to start a message", async () => {
    signedIn("user-empty", "alice", 1);
    fetchState.response = () => Response.json({ conversations: [] });

    await render(createElement(MessagesInboxClient));

    expect(host.textContent).toContain("Your messages start here");
    expect(host.textContent).toContain(
      "Tap New message to find a person or start a group",
    );
    expect(host.querySelector('button[aria-label="New message"]')).not.toBeNull();
    expect(host.textContent).not.toContain("Nobody in here yet.");
  });

  it("tells an account its device handle is not linked instead of offering a retry", async () => {
    signedIn("user-no-handle", null, 1);
    window.localStorage.setItem("pubmax_handle", "demo_drinker");
    fetchState.response = () =>
      Response.json({ error: "That handle belongs to another account." }, { status: 403 });

    try {
      await render(createElement(MessagesInboxClient));

      expect(host.textContent).toContain("@demo_drinker isn’t linked to your account.");
      expect(host.querySelector('a[href="/u/you#account-settings"]')?.textContent).toBe(
        "Claim a handle",
      );
      expect(host.textContent).not.toContain("Couldn’t load your conversations.");
      expect(host.querySelector(".threadRetryBtn")).toBeNull();
      expect(host.querySelector('[role="alert"]')).toBeNull();
      expect(host.querySelector<HTMLButtonElement>('button[aria-label="New message"]')?.disabled).toBe(true);
      expect(inboxEvents.poll).toBeNull();
      expect(fetchState.calls).toBe(1);
    } finally {
      window.localStorage.removeItem("pubmax_handle");
    }
  });

  it("hides account A thread content while account B is still loading", async () => {
    signedIn("account-a", "alice", 1);
    fetchState.response = () =>
      Response.json({
        messages: [
          {
            id: "message-a",
            conversationId: "conversation-1",
            senderHandle: "bridget",
            body: "Account A private note",
            createdAt: "2026-09-01T10:00:00.000Z",
            read: false,
            flagged: false,
          },
        ],
      });
    await render(createElement(MessageThread, { conversationId: "conversation-1" }));
    expect(host.textContent).toContain("Account A private note");

    fetchState.pending = true;
    signedIn("account-b", "bob", 2);
    await render(createElement(MessageThread, { conversationId: "conversation-1" }));

    expect(host.textContent).not.toContain("Account A private note");
    expect(host.textContent).toContain("With you in a sec.");
    await releaseFetch(Response.json({ messages: [] }));
  });

  it("keeps the newest conversation read after A to B to A responses race", async () => {
    signedIn("account-a", "alice", 1);
    fetchState.response = () =>
      Response.json({
        messages: [
          {
            id: "message-initial-a",
            conversationId: "conversation-a",
            senderHandle: "bridget",
            body: "Initial A",
            createdAt: "2026-09-01T10:00:00.000Z",
            read: false,
            flagged: false,
          },
        ],
      });
    await render(createElement(MessageThread, { conversationId: "conversation-a" }));
    expect(host.textContent).toContain("Initial A");

    fetchState.pending = true;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    await render(createElement(MessageThread, { conversationId: "conversation-b" }));
    await render(createElement(MessageThread, { conversationId: "conversation-a" }));

    await releaseFetch(
      Response.json({
        messages: [
          {
            id: "message-new-a",
            conversationId: "conversation-a",
            senderHandle: "bridget",
            body: "Newest A",
            createdAt: "2026-09-01T10:02:00.000Z",
            read: false,
            flagged: false,
          },
        ],
      }),
      "conversation-a",
      true,
    );
    expect(host.textContent).toContain("Newest A");

    await releaseFetch(
      Response.json({
        messages: [
          {
            id: "message-b",
            conversationId: "conversation-b",
            senderHandle: "charlie",
            body: "B content",
            createdAt: "2026-09-01T10:01:00.000Z",
            read: false,
            flagged: false,
          },
        ],
      }),
      "conversation-b",
    );
    await releaseFetch(
      Response.json({
        messages: [
          {
            id: "message-old-a",
            conversationId: "conversation-a",
            senderHandle: "bridget",
            body: "Old A",
            createdAt: "2026-09-01T09:59:00.000Z",
            read: false,
            flagged: false,
          },
        ],
      }),
      "conversation-a",
    );

    expect(host.textContent).toContain("Newest A");
    expect(host.textContent).not.toContain("Old A");
    expect(host.textContent).not.toContain("B content");
  });
});
