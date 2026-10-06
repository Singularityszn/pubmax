// @vitest-environment jsdom

// The thread's REQUEST BUDGET, counted. Opening a thread is ONE gated read;
// sending a message is ONE write with the outbox bubble already on screen, and
// no read follows it: the POST's own answer is the stored row. It used to be a
// POST and then a full GET, with the bubble waiting on the second.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  current: { user: { id: "user-ken" } as { id: string } | null, handle: "ken" as string | null, accountRevision: 1 },
}));
type ThreadRow = {
  id: string;
  conversationId: string;
  senderHandle: string;
  body: string;
  createdAt: string;
  read: boolean;
  flagged: boolean;
};

const ONE_ROW: ThreadRow[] = [
  { id: "m1", conversationId: "c1", senderHandle: "sam", body: "hi", createdAt: "2026-09-05T10:00:00Z", read: true, flagged: false },
];

const fetchLog = vi.hoisted(() => ({
  calls: [] as Array<{ url: string; method: string; body: string }>,
  pendingPosts: [] as Array<(response: Response) => void>,
  holdPosts: false,
  /** What the thread read answers. An empty list is an EMPTY thread. */
  threadRows: [] as Array<Record<string, unknown>>,
  /** What the inbox read answers, and whether it can be read at all. */
  inboxRows: [] as Array<Record<string, unknown>>,
  inboxFails: false,
  inboxThrows: false,
  /** The membership the thread read carries, when it carries one. */
  threadConversation: null as Record<string, unknown> | null,
}));

vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => authState.current }));
vi.mock("@/components/auth/useViewerSession", () => ({
  useViewerSession: () => ({ phase: "signed-in", signedIn: true, signedOut: false, unresolved: false }),
}));
vi.mock("@/components/auth/SignInButton", () => ({ default: () => createElement("button", { type: "button" }, "Sign in") }));
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
  authedActionFetch: (input: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    fetchLog.calls.push({
      url: String(input),
      method,
      body: typeof init?.body === "string" ? init.body : "",
    });
    if (method === "GET") {
      if (String(input).startsWith("/api/messages?")) {
        if (fetchLog.inboxThrows) return Promise.reject(new TypeError("offline"));
        if (fetchLog.inboxFails) {
          return Promise.resolve(Response.json({ error: "down" }, { status: 503 }));
        }
        return Promise.resolve(Response.json({ conversations: fetchLog.inboxRows }));
      }
      return Promise.resolve(
        Response.json({
          messages: fetchLog.threadRows,
          ...(fetchLog.threadConversation
            ? { conversation: fetchLog.threadConversation }
            : {}),
        }),
      );
    }
    if (fetchLog.holdPosts) {
      return new Promise<Response>((resolve) => fetchLog.pendingPosts.push(resolve));
    }
    const body = JSON.parse(String(init?.body)) as { body: string };
    return Promise.resolve(
      Response.json(
        { message: { id: "m2", conversationId: "c1", senderHandle: "ken", body: body.body, createdAt: "2026-09-05T10:00:01Z", read: false, flagged: false } },
        { status: 201 },
      ),
    );
  },
}));

import MessageThread from "@/components/messages/MessageThread";
import { defined } from "@/__tests__/helpers/defined";

let container: HTMLDivElement;
let root: Root;

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function mount(): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(MessageThread, { conversationId: "c1" }));
  });
  await flush();
  await flush();
}

async function type(text: string): Promise<void> {
  const field = container.querySelector<HTMLTextAreaElement>(".composerInput")!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    setter.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function typeAndSend(text: string): Promise<void> {
  await type(text);
  const send = container.querySelector<HTMLButtonElement>(".composerSend")!;
  await act(async () => {
    send.click();
  });
}

function posts(): Array<{ url: string; method: string; body: string }> {
  return fetchLog.calls.filter((call) => call.method === "POST");
}

function composerValue(): string {
  return container.querySelector<HTMLTextAreaElement>(".composerInput")!.value;
}

beforeEach(() => {
  fetchLog.calls = [];
  fetchLog.pendingPosts = [];
  fetchLog.holdPosts = false;
  fetchLog.threadRows = [...ONE_ROW];
  fetchLog.inboxRows = [
    { id: "c1", otherHandle: "sam", lastAt: "2026-09-05T10:00:00Z", lastFromMe: false, unread: 0 },
  ];
  fetchLog.inboxFails = false;
  fetchLog.inboxThrows = false;
  fetchLog.threadConversation = null;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.setItem("pubmax_handle", "ken");
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  });
  if (!("scrollIntoView" in Element.prototype)) {
    Object.defineProperty(Element.prototype, "scrollIntoView", { value: () => {}, configurable: true });
  }
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
});

describe("message thread request budget", () => {
  it("opens a thread on ONE gated read", async () => {
    await mount();
    const gets = fetchLog.calls.filter((c) => c.method === "GET");
    expect(gets).toHaveLength(1);
    expect(defined(gets[0]).url).toBe("/api/messages/c1?handle=ken");
    expect(container.querySelectorAll(".messageRow")).toHaveLength(1);
  });

  it("draws the outbox bubble BEFORE the POST answers, and refetches nothing after it", async () => {
    fetchLog.holdPosts = true;
    await mount();
    await typeAndSend("Yo");

    // The bubble is up while the request is still in flight, and the composer
    // is already empty for the next one.
    const rows = container.querySelectorAll(".messageRow");
    expect(rows).toHaveLength(2);
    expect(defined(rows[1]).hasAttribute("data-sending")).toBe(true);
    expect(defined(rows[1]).textContent).toContain("Yo");
    expect(container.querySelector<HTMLTextAreaElement>(".composerInput")!.value).toBe("");

    await act(async () => {
      fetchLog.pendingPosts[0]!(
        Response.json(
          { message: { id: "m2", conversationId: "c1", senderHandle: "ken", body: "Yo", createdAt: "2026-09-05T10:00:01Z", read: false, flagged: false } },
          { status: 201 },
        ),
      );
    });
    await flush();

    const after = container.querySelectorAll(".messageRow");
    expect(after).toHaveLength(2);
    expect(defined(after[1]).hasAttribute("data-sending")).toBe(false);
    expect(defined(after[1]).textContent).toContain("Yo");
    expect(fetchLog.calls.filter((c) => c.method === "POST")).toHaveLength(1);
    expect(fetchLog.calls.filter((c) => c.method === "GET")).toHaveLength(1);
  });

  it("takes the bubble back on a failed send, hands the words back to the composer, and reads nothing", async () => {
    fetchLog.holdPosts = true;
    await mount();
    await typeAndSend("Yo");
    await act(async () => {
      fetchLog.pendingPosts[0]!(Response.json({ error: "Storage is unavailable." }, { status: 503 }));
    });
    await flush();

    expect(container.querySelectorAll(".messageRow")).toHaveLength(1);
    expect(container.querySelector<HTMLTextAreaElement>(".composerInput")!.value).toBe("Yo");
    expect(container.querySelector(".threadError")?.textContent).toContain("Storage is unavailable.");
    expect(fetchLog.calls.filter((c) => c.method === "GET")).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F-25 / fix task 13 - one tap is one message, and one message is one row.
// ─────────────────────────────────────────────────────────────────────────────
describe("the send is latched and carries an idempotency key", () => {
  it("posts ONCE when the control is tapped twice in a single task", async () => {
    fetchLog.holdPosts = true;
    await mount();
    await type("Two taps");

    const send = container.querySelector<HTMLButtonElement>(".composerSend")!;
    await act(async () => {
      // Both taps in ONE task: `sending` state is committed a microtask later,
      // so state alone let the second one through.
      send.click();
      send.click();
      send.click();
    });

    expect(posts()).toHaveLength(1);
  });

  it("carries the same clientMessageId the outbox bubble was minted with", async () => {
    fetchLog.holdPosts = true;
    await mount();
    await typeAndSend("Keyed");

    const sent = JSON.parse(defined(posts()[0]).body) as { clientMessageId?: string };
    expect(sent.clientMessageId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("gives each deliberate send its own key, so two messages are never one row", async () => {
    await mount();
    await typeAndSend("first");
    await flush();
    await typeAndSend("second");
    await flush();

    const keys = posts().map((call) => (JSON.parse(call.body) as { clientMessageId: string }).clientMessageId);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F-11 / fix task 14 - a refused send keeps what the drinker wrote.
//
// The field is cleared at the tap. Somebody who starts the next line while the
// first is in flight used to lose the first one outright: the bubble went, the
// text was dropped for being "not empty", and all that was left was an error
// with nothing to try again with.
// ─────────────────────────────────────────────────────────────────────────────
describe("a refused send never eats the message", () => {
  it("keeps the failed line when the drinker has already started the next one", async () => {
    fetchLog.holdPosts = true;
    await mount();
    await typeAndSend("the one that matters");
    // The reader starts typing again while the first send is still in flight.
    await type("meanwhile");

    await act(async () => {
      fetchLog.pendingPosts[0]!(Response.json({ error: "Storage is unavailable." }, { status: 503 }));
    });
    await flush();

    const value = composerValue();
    expect(value).toContain("the one that matters");
    expect(value).toContain("meanwhile");
    expect(container.querySelectorAll(".messageRow")).toHaveLength(1);
  });

  it("keeps it on a thrown request too, not only a refused one", async () => {
    fetchLog.holdPosts = true;
    await mount();
    await typeAndSend("still mine");
    await type("next line");

    await act(async () => {
      fetchLog.pendingPosts[0]!(Response.json({ error: "gone" }, { status: 500 }));
    });
    await flush();

    expect(composerValue()).toContain("still mine");
  });

  it("puts the failed line back on its own when the field is empty", async () => {
    fetchLog.holdPosts = true;
    await mount();
    await typeAndSend("alone");

    await act(async () => {
      fetchLog.pendingPosts[0]!(Response.json({ error: "nope" }, { status: 503 }));
    });
    await flush();

    expect(composerValue()).toBe("alone");
  });
});

describe("an empty thread still knows whose it is", () => {
  function head(): string {
    return container.querySelector(".threadWithHandle")?.textContent ?? "";
  }

  function inboxReads(): number {
    return fetchLog.calls.filter(
      (call) => call.method === "GET" && call.url.startsWith("/api/messages?"),
    ).length;
  }

  async function refocus(): Promise<void> {
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await flush();
    await flush();
  }

  it("names the head off the inbox row, and asks the inbox ONCE however often the thread refreshes", async () => {
    fetchLog.threadRows = [];
    await mount();
    expect(head()).toBe("@sam");
    expect(inboxReads()).toBe(1);

    await refocus();
    await refocus();

    // The thread is read again on each focus; the inbox is not.
    expect(inboxReads()).toBe(1);
    expect(head()).toBe("@sam");
  });

  it("keeps a name it already learned when a later read carries none", async () => {
    fetchLog.threadRows = [];
    await mount();
    expect(head()).toBe("@sam");

    fetchLog.inboxRows = [];
    fetchLog.inboxFails = true;
    await refocus();

    expect(head()).toBe("@sam");
  });

  it("stays READY when the inbox read throws, and asks again next time", async () => {
    fetchLog.threadRows = [];
    fetchLog.inboxThrows = true;
    await mount();

    // A head with no name is a cosmetic gap, never a thread that failed.
    expect(container.querySelector(".threadEmpty")).not.toBeNull();
    expect(container.textContent).not.toContain("With you in a sec");
    expect(head()).toBe("Conversation");

    fetchLog.inboxThrows = false;
    await refocus();

    expect(head()).toBe("@sam");
  });
});

describe("a group thread is named by the group, never by one of its people", () => {
  function head(): string {
    return container.querySelector(".threadWithHandle")?.textContent ?? "";
  }

  it("reads its title off the thread read, and asks the inbox for nothing", async () => {
    fetchLog.threadRows = [];
    fetchLog.threadConversation = {
      kind: "group",
      members: ["ken", "sam", "maisie"],
      title: "Friday crew",
    };
    await mount();

    expect(head()).toBe("Friday crew");
    expect(container.querySelector(".threadWithMembers")?.textContent).toBe("3 people");
    expect(
      fetchLog.calls.filter((call) => call.url.startsWith("/api/messages?")),
    ).toHaveLength(0);
  });

  it("falls back to the people in it when it has no title", async () => {
    fetchLog.threadRows = [];
    fetchLog.threadConversation = {
      kind: "group",
      members: ["ken", "sam", "maisie"],
    };
    await mount();

    expect(head()).toBe("@sam, @maisie");
  });

  it("names a direct thread by the other person from the same read", async () => {
    fetchLog.threadRows = [];
    fetchLog.threadConversation = { kind: "direct", members: ["ken", "sam"] };
    await mount();

    expect(head()).toBe("@sam");
    expect(
      fetchLog.calls.filter((call) => call.url.startsWith("/api/messages?")),
    ).toHaveLength(0);
  });
});
