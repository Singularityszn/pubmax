// @vitest-environment jsdom

// Opening a thread is what marks its waiting messages read, and the nav badge is
// a separate surface. The thread tells it, so the badge drops at once instead of
// at its next poll; a quiet thread with nothing waiting says nothing.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const thread = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  // One object for the life of the file: the thread keys its read on the user.
  auth: { user: { id: "user-ken" }, handle: "ken", accountRevision: 1 },
  session: { phase: "signed-in", signedIn: true, signedOut: false, unresolved: false },
}));

vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => thread.auth }));
vi.mock("@/components/auth/useViewerSession", () => ({ useViewerSession: () => thread.session }));
vi.mock("@/components/auth/SignInButton", () => ({ default: () => null }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children?: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));
vi.mock("@/lib/messagesRealtime", () => ({
  subscribeToMessages: () => () => {},
  subscribeToInbox: () => () => {},
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/useDismissOnEscape", () => ({ useDismissOnEscape: vi.fn() }));
vi.mock("@/lib/useFocusTrap", () => ({ useFocusTrap: vi.fn() }));
vi.mock("@/components/profile/ProfileImageCropper", () => ({ default: () => null }));
vi.mock("@/components/messages/MessageVenuePicker", () => ({ default: () => null }));
vi.mock("@/components/messages/MessagePhoto", () => ({ default: () => null }));
vi.mock("@/components/messages/MessageVenueCard", () => ({ default: () => null }));
vi.mock("@/components/messages/MessageAvatar", () => ({ default: () => null }));
vi.mock("@/lib/keyboardInset", () => ({ useKeyboardInset: () => 0 }));
vi.mock("@/lib/authedFetch", () => ({
  authedActionFetch: () => Promise.resolve(Response.json({ messages: thread.rows })),
}));

import MessageThread from "@/components/messages/MessageThread";
import { MESSAGES_READ_EVENT } from "@/lib/messagesUnreadSignal";

const row = (overrides: Record<string, unknown>) => ({
  id: "m1",
  conversationId: "c1",
  senderHandle: "sam",
  body: "hi",
  createdAt: "2026-09-05T10:00:00Z",
  read: true,
  flagged: false,
  ...overrides,
});

let container: HTMLDivElement;
let root: Root;
let heard: ReturnType<typeof vi.fn<() => void>>;

async function open(): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(MessageThread, { conversationId: "c1" }));
  });
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  heard = vi.fn<() => void>();
  window.localStorage.setItem("pubmax_handle", "ken");
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  });
  if (!("scrollIntoView" in Element.prototype)) {
    Object.defineProperty(Element.prototype, "scrollIntoView", { value: () => {}, configurable: true });
  }
  window.addEventListener(MESSAGES_READ_EVENT, heard);
});

afterEach(() => {
  window.removeEventListener(MESSAGES_READ_EVENT, heard);
  act(() => root.unmount());
  container.remove();
});

describe("thread read announces itself to the nav badge", () => {
  it("announces when the read carried a message that was waiting for the viewer", async () => {
    thread.rows = [row({ read: false })];
    await open();
    expect(heard).toHaveBeenCalled();
  });

  it("stays quiet for a thread with nothing waiting", async () => {
    thread.rows = [row({ read: true }), row({ id: "m2", senderHandle: "ken", read: false })];
    await open();
    expect(heard).not.toHaveBeenCalled();
  });
});
