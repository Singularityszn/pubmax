// @vitest-environment jsdom

// The open thread's inbox row drops its unread pill the moment the thread is
// read. The nav badge already learned this from `announceMessagesRead`, so the
// row used to go on saying "1 unread" beside a nav that said none, on one
// screen, until the inbox was fetched again.

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  current: { user: { id: "user-alice" }, handle: "alice", accountRevision: 1 },
}));
const fetches = vi.hoisted(() => ({ calls: 0 }));

vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => auth.current }));
vi.mock("@/components/auth/useViewerSession", () => ({
  useViewerSession: () => ({
    phase: "signed-in",
    signedIn: true,
    signedOut: false,
    unresolved: false,
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children?: ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));
vi.mock("@/components/messages/MessagesNewGroup", () => ({ default: () => null }));
vi.mock("@/lib/messagesRealtime", () => ({ subscribeToInbox: () => () => {} }));
vi.mock("@/lib/authedFetch", () => ({
  authedActionFetch: () => {
    fetches.calls += 1;
    return Promise.resolve(
      Response.json({
        conversations: [
          { id: "c-erin", kind: "direct", otherHandle: "erin", lastBody: "Pint?", unread: 1 },
          { id: "c-bob", kind: "direct", otherHandle: "bob", lastBody: "Later", unread: 2 },
        ],
      }),
    );
  },
}));

import MessagesInboxClient from "@/app/messages/MessagesInboxClient";
import { announceMessagesRead } from "@/lib/messagesUnreadSignal";

let host: HTMLDivElement;
let root: Root;

function pill(conversationId: string): string | null {
  const link = host.querySelector(`a[href="/messages/${conversationId}"]`);
  return link?.querySelector(".conversationUnread")?.getAttribute("aria-label") ?? null;
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fetches.calls = 0;
  window.matchMedia = (() => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(MessagesInboxClient, { activeConversationId: "c-erin" }));
  });
  await settle();
  await settle();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("inbox row unread after a thread read", () => {
  it("drops the open thread's pill when the thread announces a read, and leaves other rows alone", async () => {
    expect(pill("c-erin")).toBe("1 unread");
    expect(pill("c-bob")).toBe("2 unread");
    const before = fetches.calls;

    await act(async () => {
      announceMessagesRead();
    });

    expect(pill("c-erin")).toBeNull();
    expect(pill("c-bob")).toBe("2 unread");
    expect(fetches.calls).toBe(before);
  });
});
