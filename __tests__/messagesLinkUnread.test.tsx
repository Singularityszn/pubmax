// @vitest-environment jsdom

// The nav badge drops the moment a thread is read. It used to ask the inbox on
// focus and once a minute only, so "Messages, 1 unread" stayed over a thread
// with nothing left in it until the next poll or a reload.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const inbox = vi.hoisted(() => ({
  unread: 1,
  lastMessageId: "message-1" as string | undefined,
  lastAt: "2026-11-17T12:00:00Z",
  lastFromMe: false,
  kind: "direct",
  pathname: "/messages",
  quiet: false,
  degraded: false,
  reads: 0,
  // One object for the life of the file: the link keys its poll on the user.
  auth: { user: { id: "user-ken" } as { id: string } | null, handle: "ken" },
  unresolved: false,
  release: vi.fn(async () => undefined),
  onIncoming: (() => {}) as () => void,
}));

vi.mock("next/navigation", () => ({ usePathname: () => inbox.pathname, useRouter: () => ({ prefetch: vi.fn() }) }));
vi.mock("@/lib/messagesRealtime", () => ({ subscribeToInbox: (_handle: string, onIncoming: () => void) => {
  inbox.onIncoming = () => { invalidateMessagesInbox(_handle); onIncoming(); };
  return () => {};
} }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => inbox.auth }));
vi.mock("@/components/auth/useViewerSession", () => ({ useViewerSession: () => ({ unresolved: inbox.unresolved }) }));
vi.mock("@/lib/messageNotificationClient", () => ({ restoreMessagePushAccount: async () => undefined }));
vi.mock("@/lib/messageNotificationLifecycle", () => ({ MESSAGE_PUSH_DEPARTURE: "departure", releaseMessagePush: inbox.release }));
vi.mock("@/lib/authedFetch", () => ({
  authedActionFetch: (url: string) => {
    if (url.startsWith("/api/message-notifications")) return Promise.resolve(Response.json({ quiet: inbox.quiet }));
    inbox.reads += 1;
    return Promise.resolve(
      Response.json({ status: inbox.degraded ? "degraded" : "ready", conversations: [{ id: "c1", otherHandle: "sam", unread: inbox.unread, lastMessageId: inbox.lastMessageId, lastAt: inbox.lastAt, lastFromMe: inbox.lastFromMe, kind: inbox.kind }] }),
    );
  },
}));

import MessagesLink from "@/components/nav/MessagesLink";
import { announceMessagesRead } from "@/lib/messagesUnreadSignal";

import { invalidateMessagesInbox } from "@/lib/messagesInboxClient";

let host: HTMLDivElement;
let root: Root;

const label = (): string | null => host.querySelector("a")?.getAttribute("aria-label") ?? null;

async function settle(): Promise<void> {
  await act(async () => {});
}

beforeEach(async () => {
  invalidateMessagesInbox();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  inbox.unread = 1;
  inbox.lastMessageId = "message-1";
  inbox.lastAt = "2026-11-17T12:00:00Z";
  inbox.lastFromMe = false;
  inbox.kind = "direct";
  inbox.pathname = "/messages";
  inbox.quiet = false;
  inbox.degraded = false;
  inbox.reads = 0;
  inbox.auth.user = { id: "user-ken" };
  inbox.unresolved = false;
  inbox.release.mockClear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(MessagesLink));
  });
  await settle();
  await settle();
});

describe("MessagesLink arrival notices", () => {
  it.each(["direct", "group"])("notifies a new %s message when another device reads the old unread message", async (kind) => {
    inbox.kind = kind;
    inbox.lastMessageId = "message-2";
    inbox.lastAt = "2026-11-17T12:01:00Z";
    await act(async () => inbox.onIncoming());
    expect(label()).toBe("Messages, 1 unread");
    expect(document.querySelector(".messageArrival a")?.getAttribute("href")).toBe("/messages/c1");
    expect(inbox.reads).toBe(2);
    await act(async () => document.querySelector<HTMLButtonElement>(".messageArrival button")!.click());
    await act(async () => inbox.onIncoming());
    expect(document.querySelector(".messageArrival")).toBeNull();
  });

  it("notifies distinct messages with the same timestamp and content", async () => {
    inbox.lastMessageId = "message-2";
    await act(async () => inbox.onIncoming());
    expect(document.querySelector(".messageArrival")).not.toBeNull();
  });

  it("keeps the last complete baseline across a failed preview read", async () => {
    inbox.degraded = true;
    inbox.lastMessageId = undefined;
    await act(async () => inbox.onIncoming());
    expect(document.querySelector(".messageArrival")).toBeNull();
    inbox.degraded = false;
    inbox.lastMessageId = "message-1";
    await act(async () => inbox.onIncoming());
    expect(document.querySelector(".messageArrival")).toBeNull();
    inbox.lastMessageId = "message-2";
    await act(async () => inbox.onIncoming());
    expect(document.querySelector(".messageArrival")).not.toBeNull();
  });

  it.each(["count", "timestamp", "both"])("does not notify when only the %s changes", async (change) => {
    if (change !== "timestamp") inbox.unread = 2;
    if (change !== "count") inbox.lastAt = "2026-11-17T12:01:00Z";
    await act(async () => inbox.onIncoming());
    expect(document.querySelector(".messageArrival")).toBeNull();
  });

  it.each(["sender", "read", "open", "muted", "blocked"])("keeps a new message quiet for %s", async (reason) => {
    inbox.lastMessageId = "message-2";
    inbox.lastAt = "2026-11-17T12:01:00Z";
    inbox.unread = reason === "read" ? 0 : 2;
    inbox.lastFromMe = reason === "sender";
    inbox.quiet = reason === "muted" || reason === "blocked";
    if (reason === "open") {
      inbox.pathname = "/messages/c1";
      await act(async () => root.render(createElement(MessagesLink)));
    }
    await act(async () => inbox.onIncoming());
    expect(document.querySelector(".messageArrival")).toBeNull();
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("MessagesLink unread badge", () => {
  it("does not release notifications while the session is unresolved", async () => {
    inbox.auth.user = null;
    inbox.unresolved = true;
    await act(async () => root.render(createElement(MessagesLink)));
    await settle();
    expect(inbox.release).not.toHaveBeenCalled();
    inbox.unresolved = false;
    await act(async () => root.render(createElement(MessagesLink)));
    await settle();
    expect(inbox.release).toHaveBeenCalledTimes(1);
  });
  it("shows the unread count from the inbox", () => {
    expect(label()).toBe("Messages, 1 unread");
  });

  it("asks the inbox again when a thread announces a read, and drops the badge", async () => {
    const before = inbox.reads;
    inbox.unread = 0;
    await act(async () => {
      announceMessagesRead();
    });
    await settle();
    expect(inbox.reads).toBeGreaterThan(before);
    expect(label()).toBe("Messages");
  });

  it("updates the badge immediately when an incoming message signal arrives", async () => {
    inbox.unread = 2;
    await act(async () => inbox.onIncoming());
    await settle();
    expect(label()).toBe("Messages, 2 unread");
  });
});
