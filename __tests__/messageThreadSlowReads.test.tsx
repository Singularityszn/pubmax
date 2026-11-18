// @vitest-environment jsdom

// A THREAD READ SLOWER THAN THE POLL STILL LANDS. An upstream 503 that the SDK
// retries keeps the thread read in flight for longer than the five-second
// fallback poll, and each poll used to supersede the read before it, so no
// answer ever landed and a cold load sat on the loading line for as long as the
// outage lasted. A COLD FAILURE IS READ FROM THE TOP: the page used to be pinned
// to its foot before any thread was drawn, which pushed the retry panel above a
// phone's fold. The oracle is the message layout contract: the list scrolls,
// the page stays still, and a read preserves the reader's chosen position.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, onTestFinished, vi } from "vitest";

const viewer = vi.hoisted(() => ({
  current: { user: { id: "account-a" } as { id: string } | null, handle: "alice" as string | null, accountRevision: 1 },
}));
const transport = vi.hoisted(() => ({
  reads: [] as Array<{ url: string; resolve: (response: Response) => void; reject: (error: Error) => void }>,
  writes: [] as Array<{ resolve: (response: Response) => void; reject: (error: Error) => void }>,
}));
const realtime = vi.hoisted(() => ({
  poll: null as (() => void) | null,
  signal: null as (() => void) | null,
}));

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
  subscribeToMessages: (_id: string, signal: () => void, options?: { poll?: () => void }) => {
    realtime.poll = options?.poll ?? null;
    realtime.signal = signal;
    return () => {
      realtime.poll = null;
      realtime.signal = null;
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
vi.mock("@/lib/authedFetch", () => ({
  authedActionFetch: (input: string, init?: RequestInit) =>
    String(input).startsWith("/api/message-notifications")
      ? Promise.resolve(Response.json({ enabled: false, preview: false, muted: false, registered: false }))
      : new Promise<Response>((resolve, reject) => {
      if (init?.method === "POST") transport.writes.push({ resolve, reject });
      else transport.reads.push({ url: String(input), resolve, reject });
    }),
}));

import MessageThread from "@/components/messages/MessageThread";
import { clearSurfaceCache } from "@/lib/surfaceDataCache";

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
  clearSurfaceCache();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  viewer.current = { user: { id: "account-a" }, handle: "alice", accountRevision: 1 };
  transport.reads = [];
  transport.writes = [];
  realtime.poll = null;
  realtime.signal = null;
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

it.each(["cold", "retry"])("keeps the header and inbox exit during a %s read", async mode => {
  await render();
  if (mode === "retry") {
    await answer(outage());
    await click(".threadRetryBtn");
  }
  expect(host.querySelector(".threadHeader")).not.toBeNull();
  expect(host.querySelector('a[aria-label="Back to inbox"]')?.getAttribute("href")).toBe("/messages");
  expect(host.querySelector(".threadWith")).not.toBeNull();
  expect(host.querySelector(".composerInput")).toBeNull();
  expect(host.querySelector('[aria-label="Chat options"]')).toBeNull();
  await answer(thread("Loaded history"));
  expect(host.querySelectorAll(".threadHeader")).toHaveLength(1);
  expect(host.querySelector(".messageBubble")?.textContent).toContain("Loaded history");
  expect(host.querySelector(".composerInput")).not.toBeNull();
});

it("restores a previously loaded thread while a returning read is pending", async () => {
  await render();
  await answer(thread("Meet at seven"));
  await act(async () => root.unmount());
  root = createRoot(host);

  await render();

  expect(host.querySelector(".messageBubble")?.textContent).toContain("Meet at seven");
  await answer(outage());
  expect(host.querySelector(".messageBubble")?.textContent).toContain("Meet at seven");
  expect(retryPanel()).toBeNull();
});

it("keeps a confirmed send when an older poll answers afterward", async () => {
  await render();
  await answer(thread("Earlier history"));
  await poll();
  const input = host.querySelector<HTMLTextAreaElement>(".composerInput")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "A confirmed message");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click(".composerSend");
  const message = { id: "stored-send", conversationId: "conversation-a", senderHandle: "alice", body: "A confirmed message", createdAt: "2026-10-04T12:01:00Z", read: false, flagged: false };
  await act(async () => transport.writes.shift()!.resolve(Response.json({ message })));
  expect(host.textContent).toContain("A confirmed message");

  await answer(thread("Earlier history"));

  expect(host.textContent).toContain("A confirmed message");
  expect(host.textContent).toContain("Earlier history");
});

it.each([false, true])("keeps the cold composer closed during a retry (overlapping poll=%s)", async overlap => {
  await render();
  await answer(outage());
  await click(".threadRetryBtn");
  if (overlap) await poll();

  expect(host.querySelector(".composerInput")).toBeNull();
  expect(host.querySelector(".composerSend")).toBeNull();
  await answer(thread("Earlier history"));
  if (overlap) await answer(thread("Earlier history"));

  expect(host.querySelector(".messageBubble")?.textContent).toContain("Earlier history");
  expect(host.querySelector(".composerInput")).not.toBeNull();
});

it("keeps an empty thread's learned name in its snapshot after a poll", async () => {
  await render();
  await answer(Response.json({ messages: [] }), "/messages/conversation-a?");
  await answer(Response.json({ conversations: [{ id: "conversation-a", otherHandle: "bridget" }] }), "/api/messages?");
  expect(host.querySelector(".threadWithHandle")?.textContent).toContain("bridget");
  await poll();
  await answer(Response.json({ messages: [] }), "/messages/conversation-a?");
  await act(async () => root.unmount());
  root = createRoot(host);

  await render();

  expect(host.querySelector(".threadWithHandle")?.textContent).toContain("bridget");
});

it("does not restore a cached previous thread from a late subscription callback", async () => {
  await render("conversation-a");
  await answer(thread("A private note"));
  const previousSignal = realtime.signal;
  await render("conversation-b");
  await answer(thread("B private note", "conversation-b"), "conversation-b");

  await act(async () => previousSignal?.());

  expect(host.querySelector(".messageBubble")?.textContent).toContain("B private note");
  expect(host.textContent).not.toContain("A private note");
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

it.each(["account", "conversation"] as const)("opens at newest after a %s change while reading history", async (change) => {
  const listHeight = vi.spyOn(HTMLUListElement.prototype, "scrollHeight", "get").mockReturnValue(976);
  const listViewport = vi.spyOn(HTMLUListElement.prototype, "clientHeight", "get").mockReturnValue(400);
  try {
    await render();
    await answer(thread("First reader"));
    const list = host.querySelector<HTMLUListElement>(".threadMessages")!;
    expect(list.scrollTop).toBe(976);
    await act(async () => {
      list.scrollTop = 100;
      list.dispatchEvent(new Event("scroll"));
    });
    await poll();
    await answer(thread("New message while reading history"));
    expect(list.scrollTop).toBe(100);

    const conversationId = change === "conversation" ? "conversation-b" : "conversation-a";
    if (change === "account") {
      viewer.current = { user: { id: "account-b" }, handle: "bob", accountRevision: 2 };
      window.localStorage.setItem("pubmax_handle", "bob");
    }
    await render(conversationId);
    await answer(thread("New identity newest message", conversationId));
    expect(host.textContent).toContain("New identity newest message");
    expect(host.querySelector<HTMLUListElement>(".threadMessages")?.scrollTop).toBe(976);
  } finally {
    listHeight.mockRestore();
    listViewport.mockRestore();
  }
});

it("keeps the page still through a cold failure and its recovery", async () => {
  await render();
  await answer(outage());
  expect(retryPanel()).not.toBeNull();
  expect(scrollTo).not.toHaveBeenCalled();

  const retry = host.querySelector<HTMLButtonElement>(".threadRetryBtn");
  expect(retry?.textContent).toBe("Try again");
  await act(async () => retry?.click());
  await settle();
  expect(scrollTo).not.toHaveBeenCalled();
  const listHeight = vi.spyOn(HTMLUListElement.prototype, "scrollHeight", "get").mockReturnValue(976);
  try {
    await answer(thread("Meet at seven"));
    expect(host.textContent).toContain("Meet at seven");
    expect(scrollTo).not.toHaveBeenCalled();
    expect(host.querySelector<HTMLUListElement>(".threadMessages")?.scrollTop).toBe(976);
  } finally {
    listHeight.mockRestore();
  }
});


async function click(selector: string, scope: ParentNode = host): Promise<void> {
  const button = scope.querySelector<HTMLButtonElement>(selector);
  if (!button) throw new Error(`Missing control: ${selector}`);
  await act(async () => button.click());
}

async function requestRemoval(kind: "unsend" | "delete" | "leave"): Promise<void> {
  if (kind === "unsend") {
    await click(".messageBubble");
    await click(".messageUnsendBtn");
  } else {
    await click('[aria-label="Chat options"]');
    const item = [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      .find((button) => button.textContent?.includes(kind === "delete" ? "Delete chat" : "Leave group"));
    if (!item) throw new Error("Missing removal menu item");
    await act(async () => item.click());
  }
  const dialog = document.querySelector('[role="alertdialog"]');
  if (!dialog) throw new Error("Missing confirmation");
  const confirm = [...dialog.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent !== "Cancel");
  if (!confirm) throw new Error("Missing confirm action");
  await act(async () => confirm.click());
}

function removableThread(): Response {
  return Response.json({
    messages: [{ id: "own-message", conversationId: "conversation-a", senderHandle: "alice", body: "Take this back", createdAt: "2026-10-04T12:00:00Z", read: true, flagged: false }],
    conversation: { kind: "group", members: ["alice", "bridget", "charlie"], title: "Friday" },
  });
}

it.each(["unsend", "delete", "leave"] as const)("ignores a pre-%s read after the removal succeeds", async (kind) => {
  await render();
  await answer(removableThread());
  await poll();
  await requestRemoval(kind);
  await act(async () => transport.writes.shift()!.resolve(Response.json({ ok: true })));
  await answer(removableThread());
  expect(host.textContent).not.toContain("Take this back");
  expect(host.textContent).toContain(kind === "unsend" ? "Message unsent" : kind === "delete" ? "Chat deleted" : "You've left");
});

it.each(["delete", "leave"] as const)("keeps the successful %s state through later refreshes", async (kind) => {
  await render();
  await answer(removableThread());
  await requestRemoval(kind);
  await act(async () => transport.writes.shift()!.resolve(Response.json({ ok: true })));
  await poll();
  await act(async () => {
    realtime.signal?.();
    window.dispatchEvent(new Event("focus"));
  });
  await settle();
  expect(transport.reads).toHaveLength(0);
  expect(host.textContent).toContain(kind === "delete" ? "Chat deleted" : "You've left");
  expect(host.querySelector("textarea")).toBeNull();
});

it("continues refreshing the thread after a successful unsend", async () => {
  await render();
  await answer(removableThread());
  await requestRemoval("unsend");
  await act(async () => transport.writes.shift()!.resolve(Response.json({ ok: true })));
  await poll();
  await answer(thread("A later message"));
  expect(host.textContent).toContain("A later message");
  expect(host.querySelector("textarea")).not.toBeNull();
});

it.each([
  ["delete", "thread"], ["delete", "account"],
  ["leave", "thread"], ["leave", "account"],
] as const)("resumes reads after %s when the %s changes", async (kind, change) => {
  await render();
  await answer(removableThread());
  await requestRemoval(kind);
  await act(async () => transport.writes.shift()!.resolve(Response.json({ ok: true })));
  if (change === "account") viewer.current = { user: { id: "account-b" }, handle: "bridget", accountRevision: 2 };
  const id = change === "thread" ? "conversation-b" : "conversation-a";
  await render(id);
  await answer(thread("Current thread", id));
  expect(host.textContent).toContain("Current thread");
  expect(host.textContent).not.toContain(kind === "delete" ? "Chat deleted" : "You've left");
});

it.each(["thread", "account"] as const)("ignores old removal success after a %s change", async (change) => {
  await render();
  await answer(removableThread());
  await requestRemoval("delete");
  if (change === "account") viewer.current = { user: { id: "account-b" }, handle: "bridget", accountRevision: 2 };
  await render(change === "thread" ? "conversation-b" : "conversation-a");
  await answer(thread("Current thread", change === "thread" ? "conversation-b" : "conversation-a"));
  await act(async () => transport.writes.shift()!.resolve(Response.json({ deleted: true })));
  expect(host.textContent).toContain("Current thread");
  expect(host.textContent).not.toContain("Chat deleted");
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
});

it.each(["refusal", "network"] as const)("ignores an old removal %s while the next thread awaits removal", async (failure) => {
  await render();
  await answer(removableThread());
  await requestRemoval("delete");
  const old = transport.writes.shift()!;
  await render("conversation-b");
  await answer(thread("Current thread", "conversation-b"));
  await requestRemoval("delete");
  await act(async () => {
    if (failure === "refusal") old.resolve(Response.json({ error: "Old removal failed" }, { status: 503 }));
    else old.reject(new Error("offline"));
  });
  expect(document.querySelector('[role="alertdialog"]')?.textContent).not.toContain("Old removal failed");
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')];
  expect(buttons.every((button) => button.disabled)).toBe(true);
});

// A successful transport is not proof of valid history. The wire contract requires an array.
it.each([null, {}, { messages: null }, { messages: {} }])("refuses invalid cold history %j on open and Retry", async body => {
  await render();
  await answer(Response.json(body));
  expect(retryPanel()).not.toBeNull();
  expect(host.querySelector(".composerInput")).toBeNull();
  await act(async () => host.querySelector<HTMLButtonElement>(".threadRetryBtn")!.click());
  await answer(Response.json(body));
  expect(retryPanel()).not.toBeNull();
  expect(host.querySelector(".composerInput")).toBeNull();
});

it.each(["malformed", "rejected"])("retains warm history on %s and isolates a thread change", async outcome => {
  await render();
  await answer(thread("Warm private note"));
  await poll();
  await answer(outcome === "rejected" ? new Error("offline") : Response.json({ messages: "invalid" }));
  expect(host.textContent).toContain("Warm private note");
  expect(host.querySelector(".inboxStaleNotice")?.getAttribute("role")).toBe("status");
  expect(host.querySelector(".composerInput")).not.toBeNull();
  await render("conversation-b");
  await answer(Response.json({}));
  expect(host.textContent).not.toContain("Warm private note");
  expect(retryPanel()).not.toBeNull();
  expect(host.querySelector(".composerInput")).toBeNull();
});

it("keeps mounted history independently of detached cache eviction", async () => {
  await render();
  await answer(thread("Still reading this note"));
  clearSurfaceCache();
  expect(host.textContent).toContain("Still reading this note");
  expect(host.querySelector(".composerInput")).not.toBeNull();
});

async function readHistoryAt(body: string, newest: boolean): Promise<HTMLUListElement> {
  const height = vi.spyOn(HTMLUListElement.prototype, "scrollHeight", "get").mockReturnValue(976);
  const viewport = vi.spyOn(HTMLUListElement.prototype, "clientHeight", "get").mockReturnValue(400);
  onTestFinished(() => { height.mockRestore(); viewport.mockRestore(); });
  await render();
  await answer(thread(body));
  const list = host.querySelector<HTMLUListElement>(".threadMessages")!;
  await act(async () => {
    list.scrollTop = newest ? 576 : 100;
    list.dispatchEvent(new Event("scroll"));
  });
  scrollTo.mockClear();
  return list;
}

it.each(["unchanged", "appended"])("preserves older history through an %s background read", async change => {
  const list = await readHistoryAt("Older history", false);
  await poll();
  const next = await thread("Older history").json();
  if (change === "appended") next.messages.push((await thread("New incoming history").json()).messages[0]);
  await answer(Response.json(next));
  expect(list.scrollTop).toBe(100);
  expect(scrollTo).not.toHaveBeenCalled();
  expect(host.textContent).toContain(change === "appended" ? "New incoming history" : "Older history");
});

it("follows incoming history when the reader stays at the newest position", async () => {
  const list = await readHistoryAt("Earlier history", true);
  await poll();
  await answer(thread("Latest history"));
  expect(list.scrollTop).toBe(976);
  expect(scrollTo).not.toHaveBeenCalled();
});

it.each([
  { removed: 1, nativeAnchor: false, viewportShift: 0 },
  { removed: 1, nativeAnchor: true, viewportShift: 0 },
  { removed: 100, nativeAnchor: false, viewportShift: 0 },
  { removed: 1, nativeAnchor: false, viewportShift: 60 },
])("keeps visible history fixed after replacement ($removed, native=$nativeAnchor, shift=$viewportShift)", async ({ removed, nativeAnchor, viewportShift }) => {
  const height = vi.spyOn(HTMLUListElement.prototype, "scrollHeight", "get").mockReturnValue(10000);
  const viewport = vi.spyOn(HTMLUListElement.prototype, "clientHeight", "get").mockReturnValue(400);
  let listTop = 100;
  let browserAnchored = false;
  const rect = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const list = host.querySelector<HTMLUListElement>(".threadMessages");
    if (this === list) {
      if (nativeAnchor && !browserAnchored && list?.querySelector(".messageBubble")?.textContent === "History 2") {
        list.scrollTop -= 50;
        browserAnchored = true;
      }
      return new DOMRect(0, listTop, 300, 400);
    }
    const rows = Array.from(list?.querySelectorAll(".messageRow") ?? []);
    const index = rows.indexOf(this);
    return new DOMRect(0, listTop + index * 50 - (list?.scrollTop ?? 0), 300, 50);
  });
  onTestFinished(() => { height.mockRestore(); viewport.mockRestore(); rect.mockRestore(); });
  const messages = Array.from({ length: 201 }, (_, index) => ({
    id: `history-${index + 1}`, conversationId: "conversation-a", senderHandle: "bridget",
    body: `History ${index + 1}`, createdAt: "2026-10-04T12:00:00Z", read: true, flagged: false,
  }));
  await render();
  await answer(Response.json({ messages: messages.slice(0, 200) }));
  const list = host.querySelector<HTMLUListElement>(".threadMessages")!;
  await act(async () => {
    list.scrollTop = 4975;
    list.dispatchEvent(new Event("scroll"));
  });
  const visible = Array.from(list.querySelectorAll(".messageRow")).find(row => row.querySelector(".messageBubble")?.textContent === "History 101")!;
  expect(Array.from(list.querySelectorAll(".messageRow")).indexOf(visible)).toBe(100);
  const before = visible.getBoundingClientRect().top;
  await poll();
  listTop += viewportShift;
  await answer(Response.json({ messages: messages.filter((_, index) => index + 1 !== removed) }));
  expect(visible.isConnected).toBe(true);
  expect(visible.getBoundingClientRect().top).toBe(before);
  expect(list.scrollTop).toBe(4925 + viewportShift);
});

it.each([true, false])("keeps the reading position when recovery appears (newest=%s)", async newest => {
  const list = await readHistoryAt("Retained history", newest);
  await poll();
  await answer(outage());
  expect(host.querySelector(".threadReadRecovery")).not.toBeNull();
  expect(list.scrollTop).toBe(newest ? 976 : 100);
  expect(scrollTo).not.toHaveBeenCalled();
});

it("coalesces repeated manual recovery while its read is pending", async () => {
  await render();
  await answer(thread("Retained history"));
  await poll();
  await answer(outage());
  const retry = host.querySelector<HTMLButtonElement>(".threadReadRecovery button")!;
  retry.focus();
  await act(async () => {
    for (let i = 0; i < 5; i++) retry.click();
  });
  expect(transport.reads).toHaveLength(1);
  expect(retry.getAttribute("aria-disabled")).toBe("true");
  expect(document.activeElement).toBe(retry);
  await answer(thread("Recovered history"));
  expect(host.querySelector(".threadReadRecovery")).toBeNull();
  await poll();
  await answer(outage());
  expect(host.querySelector<HTMLButtonElement>(".threadReadRecovery button")!.getAttribute("aria-disabled")).toBe("false");
});

it.each(["conversation", "reader"])("does not let the previous %s retry unlock a new pending retry", async change => {
  await render();
  await answer(thread("Previous history"));
  await poll();
  await answer(outage());
  await click(".threadReadRecovery button");
  const conversation = change === "conversation" ? "conversation-b" : "conversation-a";
  if (change === "reader") viewer.current = { user: { id: "account-b" }, handle: "bridget", accountRevision: 2 };
  await render(conversation);
  await answerLatest(thread("Current history", conversation));
  await poll();
  await answerLatest(outage());
  await click(".threadReadRecovery button");
  expect(transport.reads).toHaveLength(2);
  await answer(thread("Obsolete response"));
  expect(host.querySelector<HTMLButtonElement>(".threadReadRecovery button")!.getAttribute("aria-disabled")).toBe("true");
  expect(host.textContent).not.toContain("Obsolete response");
  await answer(thread("Current recovery", conversation));
  expect(host.querySelector(".threadReadRecovery")).toBeNull();
  expect(host.textContent).toContain("Current recovery");
});

it("lands an intentional send at the newest position after reading older history", async () => {
  const list = await readHistoryAt("Earlier history", false);
  const input = host.querySelector<HTMLTextAreaElement>(".composerInput")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "An intentional send");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click(".composerSend");
  expect(host.textContent).toContain("An intentional send");
  expect(list.scrollTop).toBe(976);
  expect(scrollTo).not.toHaveBeenCalled();
});
