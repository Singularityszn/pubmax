// @vitest-environment jsdom

// The nav badge drops the moment a thread is read. It used to ask the inbox on
// focus and once a minute only, so "Messages, 1 unread" stayed over a thread
// with nothing left in it until the next poll or a reload.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const inbox = vi.hoisted(() => ({
  unread: 1,
  reads: 0,
  // One object for the life of the file: the link keys its poll on the user.
  auth: { user: { id: "user-ken" }, handle: "ken" },
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children?: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ prefetch: vi.fn() }) }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => inbox.auth }));
vi.mock("@/lib/authedFetch", () => ({
  authedActionFetch: () => {
    inbox.reads += 1;
    return Promise.resolve(
      Response.json({ conversations: [{ id: "c1", otherHandle: "sam", unread: inbox.unread }] }),
    );
  },
}));

import MessagesLink from "@/components/nav/MessagesLink";
import { announceMessagesRead } from "@/lib/messagesUnreadSignal";

let host: HTMLDivElement;
let root: Root;

const label = (): string | null => host.querySelector("a")?.getAttribute("aria-label") ?? null;

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  inbox.unread = 1;
  inbox.reads = 0;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(MessagesLink));
  });
  await settle();
  await settle();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("MessagesLink unread badge", () => {
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
});
