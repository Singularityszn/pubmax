// @vitest-environment jsdom

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchState = vi.hoisted(() => ({ request: vi.fn() }));

const authState = vi.hoisted(() => ({
  current: { user: { id: "user-1" }, handle: "alice", accountRevision: 1 },
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => authState.current,
}));
vi.mock("@/components/auth/useViewerSession", () => ({
  useViewerSession: () => ({
    phase: "signed-in",
    signedIn: true,
    signedOut: false,
    unresolved: false,
  }),
}));
vi.mock("@/components/auth/SignInButton", () => ({
  default: () => createElement("button", { type: "button" }, "Continue with email"),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children?: ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));
vi.mock("@/lib/authedFetch", () => ({
  authedActionFetch: (...args: unknown[]) => fetchState.request(...args),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/messagesRealtime", () => ({
  subscribeToMessages: () => () => {},
  subscribeToInbox: () => () => {},
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/useDismissOnEscape", () => ({ useDismissOnEscape: vi.fn() }));
vi.mock("@/lib/useFocusTrap", () => ({ useFocusTrap: vi.fn() }));
vi.mock("@/components/profile/ProfileImageCropper", () => ({ default: () => null }));

import MessageThread from "@/components/messages/MessageThread";

import MessagesInboxClient from "@/app/messages/MessagesInboxClient";

const LOADING_LINE = "With you in a sec.";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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
  fetchState.request.mockReset().mockRejectedValue(new Error("network"));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function render(surface: typeof MessageThread | typeof MessagesInboxClient): Promise<void> {
  await act(async () => {
    root.render(surface === MessageThread
      ? createElement(MessageThread, { conversationId: "conversation-1" })
      : createElement(MessagesInboxClient));
  });
}

function assertPlainFailure(visible: string): void {
  for (const leak of ["fetch", "status", "500", "AbortError", "network", "error", "sorry", "\u2014", "!"]) {
    expect(visible.includes(leak), `${leak} leaked into visible failure copy`).toBe(false);
  }
}

function retryButton(): HTMLButtonElement {
  const button = Array.from(host.querySelectorAll("button")).find((node) =>
    /Try again|Trying again/.test(node.textContent ?? ""));
  expect(button).toBeDefined();
  return button!;
}

const conversation = {
  id: "conversation-1", otherHandle: "bridget", lastBody: "See you at seven",
  lastAt: "2026-10-01T18:00:00.000Z", lastFromMe: false, unread: 0,
};

describe("messages friction voice", () => {
  it.each([MessageThread, MessagesInboxClient])("renders shared loading copy while request is pending", async (surface) => {
    fetchState.request.mockImplementation(() => new Promise(() => {}));
    await render(surface);
    expect(host.textContent).toContain(LOADING_LINE);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.textContent).not.toContain("Your messages start here");
  });

  it("renders unreachable thread with plain failure and both exits", async () => {
    await render(MessageThread);
    const failure = host.querySelector(".threadFailure");
    expect(failure).not.toBeNull();
    expect(failure!.textContent).toContain("This conversation won’t open right now. Your messages are safe.");
    expect(host.textContent).not.toContain(LOADING_LINE);
    expect(retryButton()).toBeDefined();
    expect(failure!.querySelector('a[href="/messages"]')?.textContent).toBe("Back to inbox");
    assertPlainFailure(failure!.textContent ?? "");
    fetchState.request.mockResolvedValue(Response.json({ messages: [] }));
    await act(async () => retryButton().click());
    expect(host.querySelector(".threadFailure")).toBeNull();
    expect(host.querySelector('textarea[aria-label="Message"]')).not.toBeNull();
  });

  it.each(["http", "thrown", "degraded"])("renders %s inbox failure without warm empty state", async (failure) => {
    if (failure === "http") fetchState.request.mockResolvedValue(new Response(null, { status: 503 }));
    if (failure === "degraded") fetchState.request.mockResolvedValue(Response.json({ conversations: [], status: "degraded" }));
    await render(MessagesInboxClient);
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Couldn’t load your conversations.");
    expect(host.textContent).not.toContain("Your messages start here");
    expect(host.textContent).not.toContain(LOADING_LINE);
    assertPlainFailure(alert!.textContent ?? "");
    fetchState.request.mockResolvedValue(Response.json({ conversations: [] }));
    await act(async () => retryButton().click());
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.textContent).toContain("Your messages start here");
    expect(host.textContent).toContain("Tap New message to find a person or start a group");
    expect(host.querySelector('button[aria-label="New message"]')).not.toBeNull();
    expect(host.textContent).not.toContain("Nobody in here yet.");
  });

  it.each(["http", "thrown"])("retains loaded list on %s refresh failure and guards focused retry", async (failure) => {
    fetchState.request.mockResolvedValue(Response.json({ conversations: [conversation] }));
    await render(MessagesInboxClient);
    expect(host.textContent).toContain(conversation.lastBody);
    if (failure === "http") fetchState.request.mockResolvedValue(new Response(null, { status: 503 }));
    else fetchState.request.mockRejectedValue(new Error("network"));
    await act(async () => window.dispatchEvent(new Event("focus")));
    const notice = host.querySelector('[role="status"]');
    expect(notice?.textContent).toContain("Couldn’t refresh this list. It shows what loaded last.");
    assertPlainFailure(notice!.textContent ?? "");
    expect(host.textContent).toContain(conversation.lastBody);
    expect(host.textContent).not.toContain("Your messages start here");
    let release!: (response: Response) => void;
    fetchState.request.mockImplementation(() => new Promise<Response>((resolve) => { release = resolve; }));
    const button = retryButton();
    button.focus();
    const callsBefore = fetchState.request.mock.calls.length;
    await act(async () => { button.click(); button.click(); });
    expect(fetchState.request).toHaveBeenCalledTimes(callsBefore + 1);
    expect(button.disabled).toBe(false);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.textContent).toBe("Trying again");
    expect(document.activeElement).toBe(button);
    expect(host.textContent).toContain(conversation.lastBody);
    expect(notice?.textContent).toContain("Couldn’t refresh this list.");
    await act(async () => release(Response.json({ conversations: [conversation] })));
    expect(host.querySelector(".inboxStaleNotice")).toBeNull();
    expect(host.textContent).toContain(conversation.lastBody);
  });
});
