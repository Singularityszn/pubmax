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
const selection = vi.hoisted(() => ({ value: "first", label: "First label" }));
const photoSelection = vi.hoisted(() => ({ file: null as File | null, files: null as File[] | null, prepare: vi.fn() }));
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
  holdReads: false,
  pendingReads: [] as Array<{ resolve: (response: Response) => void; reject: (error: Error) => void }>,
  useRealWrites: false,
  /** What the thread read answers. An empty list is an EMPTY thread. */
  threadRows: [] as Array<Record<string, unknown>>,
  /** What the inbox read answers, and whether it can be read at all. */
  inboxRows: [] as Array<Record<string, unknown>>,
  inboxFails: false,
  inboxThrows: false,
  threadMissing: false,
  /** The membership the thread read carries, when it carries one. */
  threadConversation: null as Record<string, unknown> | null,
}));

vi.mock("@/components/auth/authContext", () => ({ useAuth: () => authState.current }));
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
vi.mock("@/lib/preparePhotoUpload", () => ({
  preparePhotoUpload: (file: File) => photoSelection.prepare(file),
}));
vi.mock("@/components/messages/MessageAttachmentPicker", () => ({
  default: ({ onAttachmentKind, onFileChange }: {
    onAttachmentKind: (kind: string) => void;
    onFileChange: (event: { target: { files: File[]; value: string } }) => void;
  }) =>
    createElement("div", {},
      createElement("button", {
        "data-photo": true,
        onClick: () => onFileChange({ target: { files: photoSelection.files ?? [photoSelection.file!], value: "" } }),
      }, "Photo"),
      ...["venue", "contact", "event", "poll"].map((kind) =>
      createElement("button", { key: kind, "data-attach": kind, onClick: () => onAttachmentKind(kind) }, kind))),
}));
vi.mock("@/components/messages/MessageVenuePicker", () => ({
  default: ({ onPick }: { onPick: (venue: { id: string; name: string; area: string }) => void }) =>
    createElement("button", { "data-pick": true, onClick: () => onPick({ id: selection.value, name: selection.label, area: "London" }) }, "Pick"),
}));
vi.mock("@/components/messages/MessageContactPicker", () => ({
  default: ({ onPick }: { onPick: (handle: string) => void }) =>
    createElement("button", { "data-pick": true, onClick: () => onPick(selection.value) }, "Pick"),
}));
vi.mock("@/components/messages/MessageEventPicker", () => ({
  default: ({ onPick }: { onPick: (planId: string) => void }) =>
    createElement("button", { "data-pick": true, onClick: () => onPick(selection.value) }, "Pick"),
}));
vi.mock("@/components/messages/MessagePollComposer", () => ({
  default: ({ onPick }: { onPick: (poll: { question: string; options: string[] }) => void }) =>
    createElement("button", { "data-pick": true, onClick: () => onPick({ question: selection.value, options: ["Yes", "No"] }) }, "Pick"),
}));
vi.mock("@/components/messages/MessagePhoto", () => ({
  default: ({ previewUrl }: { previewUrl?: string }) => createElement("img", { "data-stored-photo": true, src: previewUrl, alt: "Stored photo" }),
}));
vi.mock("@/components/messages/MessageVenueCard", () => ({ default: () => null }));
vi.mock("@/components/messages/MessageAvatar", () => ({ default: () => null }));
vi.mock("@/lib/keyboardInset", () => ({ useKeyboardInset: () => 0 }));
vi.mock("@/lib/authClient", () => ({
  getAccessToken: async () => authState.current.user?.id ?? null,
}));
vi.mock("@/lib/authedFetch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authedFetch")>();
  return {
    ...actual,
    authedActionFetch: (input: string, init: RequestInit, options: import("@/lib/authedFetch").AuthActionOptions) => {
      if (String(input).startsWith("/api/message-notifications")) return Promise.resolve(Response.json({ enabled: false, preview: false, muted: false, registered: false }));
      const method = init?.method ?? "GET";
      if (method === "POST" && fetchLog.useRealWrites) return actual.authedActionFetch(input, init, options);
      fetchLog.calls.push({
        url: String(input),
        method,
        body: init?.body instanceof FormData ? String(init.body.get("post")) : typeof init?.body === "string" ? init.body : "",
      });
      if (method === "GET") {
        if (String(input).startsWith("/api/messages?")) {
          if (fetchLog.inboxThrows) return Promise.reject(new TypeError("offline"));
          if (fetchLog.inboxFails) {
            return Promise.resolve(Response.json({ error: "down" }, { status: 503 }));
          }
          return Promise.resolve(Response.json({ conversations: fetchLog.inboxRows }));
        }
        if (fetchLog.holdReads) return new Promise<Response>((resolve, reject) => fetchLog.pendingReads.push({ resolve, reject }));
        if (fetchLog.threadMissing) return Promise.resolve(Response.json({ error: "Not found" }, { status: 404 }));
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
      const body = JSON.parse(fetchLog.calls[fetchLog.calls.length - 1]!.body) as { body: string };
      return Promise.resolve(
        Response.json(
          { message: { id: "m2", conversationId: "c1", senderHandle: "ken", body: body.body, createdAt: "2026-09-05T10:00:01Z", read: false, flagged: false } },
          { status: 201 },
        ),
      );
    },
  };
});

import MessageThread from "@/components/messages/MessageThread";
import { defined } from "@/__tests__/helpers/defined";
import { publishAuthActionState } from "@/lib/authedFetch";
import { discardMessagePhotoRecovery, readMessagePhotoRecovery } from "@/lib/messagePhotoRecovery";
import { setProviderIdentity } from "@/lib/authProviderRevision";

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
  discardMessagePhotoRecovery("user-ken:1:c1");
  authState.current = { user: { id: "user-ken" }, handle: "ken", accountRevision: 1 };
  selection.value = "first";
  selection.label = "First label";
  photoSelection.file = null;
  photoSelection.files = null;
  photoSelection.prepare.mockReset().mockImplementation(async (file: File) => ({ file, width: 1200, height: 800 }));
  fetchLog.calls = [];
  fetchLog.pendingPosts = [];
  fetchLog.holdPosts = false;
  fetchLog.holdReads = false;
  fetchLog.pendingReads = [];
  fetchLog.useRealWrites = false;
  fetchLog.threadRows = [...ONE_ROW];
  fetchLog.inboxRows = [
    { id: "c1", otherHandle: "sam", lastAt: "2026-09-05T10:00:00Z", lastFromMe: false, unread: 0 },
  ];
  fetchLog.inboxFails = false;
  fetchLog.inboxThrows = false;
  fetchLog.threadMissing = false;
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
  vi.unstubAllGlobals();
});

describe("message thread request budget", () => {
  it.each(["snapshot", "notfound", "signedout", "offline", "partial-batch"])("keeps acknowledged photo previews after an older %s read", async outcome => {
    fetchLog.holdPosts = true;
    const revoke = vi.fn();
    let nextUrl = 0;
    vi.stubGlobal("URL", class extends URL {
      static createObjectURL() { return `blob:retained-${nextUrl++}`; }
      static revokeObjectURL = revoke;
    });
    photoSelection.files = [1, 2].map(value => {
      const bytes = new Uint8Array([value]);
      const file = new File([bytes], `photo-${value}.jpg`, { type: "image/jpeg" });
      Object.defineProperty(file, "arrayBuffer", { value: async () => bytes.buffer });
      return file;
    });
    await mount();
    fetchLog.holdReads = true;
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(fetchLog.pendingReads).toHaveLength(1);
    await act(async () => { container.querySelector<HTMLButtonElement>("[data-photo]")!.click(); });
    await typeAndSend("caption");
    const saved = [0, 1].map(index => ({
      ...ONE_ROW[0]!, id: `saved-${index}`, senderHandle: "ken", body: index === 0 ? "caption" : "",
      attachment: { kind: "photo", url: `/api/messages/c1/photo/saved-${index}`, width: 1200, height: 800 },
    }));
    for (const index of [0, 1]) {
      await act(async () => {
        fetchLog.pendingPosts[index]!(outcome === "partial-batch" && index === 1
          ? Response.json({ error: "interrupted" }, { status: 503 })
          : Response.json({ message: saved[index] }));
      });
    }
    const expected = outcome === "partial-batch" ? 1 : 2;
    expect(container.querySelectorAll("[data-stored-photo]")).toHaveLength(expected);
    await act(async () => {
      const read = fetchLog.pendingReads[0]!;
      if (outcome === "offline") read.reject(new TypeError("offline"));
      else read.resolve(Response.json({ messages: ONE_ROW }, { status: outcome === "notfound" ? 404 : outcome === "signedout" ? 401 : 200 }));
    });
    expect(container.querySelectorAll("[data-stored-photo]")).toHaveLength(expected);
    expect(container.querySelector("[data-stored-photo]")?.getAttribute("src")).toBe("blob:retained-0");
    expect(revoke).not.toHaveBeenCalled();
    if (outcome === "partial-batch") expect(container.querySelectorAll(".composerPendingThumb")).toHaveLength(1);
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await act(async () => { fetchLog.pendingReads[1]!.resolve(Response.json({ messages: ONE_ROW })); });
    expect(container.querySelectorAll("[data-stored-photo]")).toHaveLength(0);
    expect(revoke).toHaveBeenCalledWith("blob:retained-0");
  });

  it("retries only the unsent photos after part of a batch succeeds", async () => {
    fetchLog.holdPosts = true;
    const revoke = vi.fn();
    let nextUrl = 0;
    vi.stubGlobal("URL", class extends URL {
      static createObjectURL() { return `blob:photo-${nextUrl++}`; }
      static revokeObjectURL = revoke;
    });
    photoSelection.files = [1, 2, 3].map(value => {
      const file = new File([new Uint8Array([value])], `photo-${value}.jpg`, { type: "image/jpeg" });
      Object.defineProperty(file, "arrayBuffer", { value: async () => new Uint8Array([value]).buffer });
      return file;
    });
    await mount();
    await act(async () => { container.querySelector<HTMLButtonElement>("[data-photo]")!.click(); });
    expect(container.querySelectorAll(".composerPendingThumb")).toHaveLength(3);
    await typeAndSend("batch caption");
    expect(container.querySelectorAll(".messagePhotoSending")).toHaveLength(3);
    await act(async () => { fetchLog.pendingPosts[0]!(Response.json({ message: { ...ONE_ROW[0], id: "saved", senderHandle: "ken", body: "batch caption" } })); });
    expect(posts()).toHaveLength(2);
    await act(async () => { fetchLog.pendingPosts[1]!(Response.json({ error: "interrupted" }, { status: 503 })); });
    expect(container.querySelectorAll(".composerPendingThumb")).toHaveLength(2);
    expect(composerValue()).toBe("");
    expect(revoke).toHaveBeenCalledWith("blob:photo-0");
    expect(revoke).not.toHaveBeenCalledWith("blob:photo-1");
    expect(revoke).not.toHaveBeenCalledWith("blob:photo-2");
    const failedKey = JSON.parse(posts()[1]!.body).clientMessageId;
    await act(async () => root.unmount()); container.remove();
    await mount();
    expect(readMessagePhotoRecovery("user-ken:1:c1")?.photos.map(photo => photo.file.name)).toEqual(["photo-2.jpg", "photo-3.jpg"]);
    expect(container.querySelector(".threadError")?.textContent).toContain("interrupted");
    await typeAndSend("");
    expect(posts()).toHaveLength(3);
    expect(JSON.parse(posts()[2]!.body)).toMatchObject({ clientMessageId: failedKey, body: "" });
    expect(container.querySelectorAll(".messagePhotoSending")).toHaveLength(2);
  });

  it("keeps the selected photo readable while sending and after a refused upload", async () => {
    fetchLog.holdPosts = true;
    const revoke = vi.fn();
    vi.stubGlobal("URL", class extends URL {
      static createObjectURL() { return "blob:photo"; }
      static revokeObjectURL = revoke;
    });
    photoSelection.file = new File([new Uint8Array([1, 2, 3])], "photo.jpg", { type: "image/jpeg" });
    Object.defineProperty(photoSelection.file, "arrayBuffer", { value: async () => new Uint8Array([1, 2, 3]).buffer });
    await mount();
    await act(async () => { container.querySelector<HTMLButtonElement>("[data-photo]")!.click(); });
    await typeAndSend("photo caption");
    expect(container.querySelector(".messagePhotoSending")?.getAttribute("src")).toBe("blob:photo");
    expect(revoke).not.toHaveBeenCalled();
    await act(async () => {
      fetchLog.pendingPosts[0]!(Response.json({ error: "Upload interrupted." }, { status: 503 }));
    });
    expect(container.querySelector(".composerPendingThumb")?.getAttribute("src")).toBe("blob:photo");
    expect(revoke).not.toHaveBeenCalled();
  });

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
  it.each([false, true])("binds a delayed photo to its starting account (switch: %s)", async (switchAccount) => {
    setProviderIdentity("supabase", "user-ken");
    publishAuthActionState({ status: "signed-in", identityResolved: true });
    fetchLog.useRealWrites = true;
    const network = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ message: {
      id: "photo-message", conversationId: "c1", senderHandle: "ken", body: "caption",
      createdAt: "2026-09-05T10:00:01Z", read: false, flagged: false,
    } }));
    const messageWrites = () => network.mock.calls.filter(([url, init]) =>
      String(url) === "/api/messages/c1" && init?.method === "POST");
    vi.stubGlobal("fetch", network);
    vi.stubGlobal("URL", class extends URL {
      static createObjectURL() { return "blob:photo"; }
      static revokeObjectURL() {}
    });
    let finishRead!: (bytes: ArrayBuffer) => void;
    const bytes = new Promise<ArrayBuffer>((resolve) => { finishRead = resolve; });
    const readPhoto = vi.fn(() => bytes);
    photoSelection.file = new File([new Uint8Array([1, 2, 3])], "photo.jpg", { type: "image/jpeg" });
    Object.defineProperty(photoSelection.file, "arrayBuffer", { value: readPhoto });
    await mount();
    await act(async () => { container.querySelector<HTMLButtonElement>("[data-photo]")!.click(); });
    await typeAndSend("caption");
    expect(readPhoto).toHaveBeenCalledOnce();
    expect(messageWrites()).toHaveLength(0);

    if (switchAccount) {
      setProviderIdentity("supabase", "user-sam");
      authState.current = { user: { id: "user-sam" }, handle: "sam", accountRevision: 2 };
      await act(async () => { root.render(createElement(MessageThread, { conversationId: "c1" })); });
    }
    await act(async () => { finishRead(new Uint8Array([1, 2, 3]).buffer); });

    expect(messageWrites()).toHaveLength(switchAccount ? 0 : 1);
    if (!switchAccount) {
      const init = defined(defined(messageWrites()[0])[1]);
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer user-ken");
      const post = JSON.parse(String((init.body as FormData).get("post")));
      expect(post).toMatchObject({ handle: "ken", body: "caption", clientMessageId: expect.any(String) });
      expect(container.querySelector("[data-sending]")).toBeNull();
    }
  });

  it("reuses identical photo bytes after reselection and rotates for changed bytes or media type", async () => {
    fetchLog.holdPosts = true;
    vi.stubGlobal("URL", class extends URL {
      static createObjectURL() { return "blob:photo"; }
      static revokeObjectURL() {}
    });
    await mount();

    const variants = [
      { bytes: [1, 2, 3], name: "first.jpg", type: "image/jpeg" },
      { bytes: [1, 2, 3], name: "reselected.jpg", type: "image/jpeg" },
      { bytes: [1, 2, 4], name: "reselected.jpg", type: "image/jpeg" },
      { bytes: [1, 2, 4], name: "reselected.jpg", type: "image/png" },
    ];
    for (const [index, variant] of variants.entries()) {
      const bytes = new Uint8Array(variant.bytes);
      const file = new File([bytes], variant.name, { type: variant.type });
      Object.defineProperty(file, "arrayBuffer", { value: async () => bytes.slice().buffer });
      photoSelection.file = file;
      await act(async () => {
        container.querySelector<HTMLButtonElement>("[data-photo]")!.click();
      });
      await typeAndSend("same caption");
      await act(async () => {
        await expect.poll(() => posts().length).toBe(index + 1);
        fetchLog.pendingPosts[index]!(Response.json({ error: "unavailable" }, { status: 503 }));
      });
    }

    const keys = posts().map((call) => (JSON.parse(call.body) as { clientMessageId: string }).clientMessageId);
    expect(keys[0]).toEqual(expect.any(String));
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[1]);
    expect(keys[3]).not.toBe(keys[2]);
  });

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

  it("sends a failed message again under its first key, and edited words under a new one", async () => {
    fetchLog.holdPosts = true;
    await mount();
    await typeAndSend("same words");
    await act(async () => {
      fetchLog.pendingPosts[0]!(Response.json({ error: "Storage is unavailable." }, { status: 503 }));
    });
    await flush();
    // The words came back to the field. Send them again, unchanged.
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".composerSend")!.click();
    });
    await act(async () => {
      fetchLog.pendingPosts[1]!(Response.json({ error: "Storage is unavailable." }, { status: 503 }));
    });
    await flush();
    await typeAndSend("same words, edited");

    const keys = posts().map((call) => (JSON.parse(call.body) as { clientMessageId: string }).clientMessageId);
    expect(keys).toHaveLength(3);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  it.each(["account", "handle", "conversation"])("does not reuse a failed key after the %s changes", async (changed) => {
    fetchLog.holdPosts = true;
    await mount();
    await typeAndSend("same words");
    await act(async () => {
      fetchLog.pendingPosts[0]!(Response.json({ error: "unavailable" }, { status: 503 }));
    });
    if (changed === "account") authState.current.user = { id: "user-sam" };
    if (changed === "handle") authState.current.handle = "sam";
    authState.current.accountRevision += 1;
    await act(async () => {
      root.render(createElement(MessageThread, { conversationId: changed === "conversation" ? "c2" : "c1" }));
    });
    await typeAndSend("same words");

    const keys = posts().map((call) => (JSON.parse(call.body) as { clientMessageId: string }).clientMessageId);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toEqual(expect.any(String));
    expect(keys[1]).not.toBe(keys[0]);
  });

  it.each(["venue", "contact", "event", "poll"])("reuses equivalent %s values and rotates for changed values", async (kind) => {
    fetchLog.holdPosts = true;
    await mount();
    const pick = async () => {
      await act(async () => {
        container.querySelector<HTMLButtonElement>(`[data-attach="${kind}"]`)!.click();
      });
      await act(async () => {
        container.querySelector<HTMLButtonElement>("[data-pick]")!.click();
      });
    };
    await pick();
    await typeAndSend("same words");
    await act(async () => {
      fetchLog.pendingPosts[0]!(Response.json({ error: "unavailable" }, { status: 503 }));
    });
    selection.label = "Updated display label";
    await pick();
    await typeAndSend("same words");
    await act(async () => {
      fetchLog.pendingPosts[1]!(Response.json({ error: "unavailable" }, { status: 503 }));
    });
    selection.value = "second";
    await pick();
    await typeAndSend("same words");

    const keys = posts().map((call) => (JSON.parse(call.body) as { clientMessageId: string }).clientMessageId);
    expect(keys).toHaveLength(3);
    expect(keys[0]).toEqual(expect.any(String));
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
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

describe("group conversation sender labels", () => {
  it("names each incoming run by its sender and leaves own messages unlabelled", async () => {
    fetchLog.threadConversation = { kind: "group", members: ["ken", "sam", "maisie"], title: "Friday regulars" };
    fetchLog.threadRows = [
      { ...ONE_ROW[0], id: "m1", senderHandle: "sam" },
      { ...ONE_ROW[0], id: "m2", senderHandle: "sam", createdAt: "2026-09-05T10:00:10Z" },
      { ...ONE_ROW[0], id: "m3", senderHandle: "maisie", createdAt: "2026-09-05T10:00:20Z" },
      { ...ONE_ROW[0], id: "m4", senderHandle: "ken", createdAt: "2026-09-05T10:00:30Z" },
    ];
    await mount();
    expect(Array.from(container.querySelectorAll(".messageSender"), (label) => label.textContent)).toEqual(["@sam", "@maisie"]);
  });
});


describe("council photo send regressions", () => {
  beforeEach(() => {
    fetchLog.holdPosts = true;
    vi.stubGlobal("URL", class extends URL {
      static createObjectURL(file: File) { return `blob:${file.name}`; }
      static revokeObjectURL() {}
    });
  });
  function photo(index = 0): File {
    const file = new File([new Uint8Array([index])], `photo-${index}.jpg`, { type: "image/jpeg" });
    Object.defineProperty(file, "arrayBuffer", { value: async () => new Uint8Array([index]).buffer });
    return file;
  }
  async function choose(files: File[]) {
    photoSelection.files = files;
    await act(async () => container.querySelector<HTMLButtonElement>("[data-photo]")!.click());
  }
  it("sends with the same stored handle that opened the thread", async () => {
    authState.current.handle = null;
    await mount(); await typeAndSend("fallback handle");
    expect(posts()).toHaveLength(1);
    expect(JSON.parse(posts()[0]!.body)).toMatchObject({ handle: "ken", body: "fallback handle" });
  });
  it("refuses an over-budget batch before decoding any photo", async () => {
    await mount(); await choose(Array.from({ length: 13 }, (_, index) => photo(index)));
    expect(photoSelection.prepare).not.toHaveBeenCalled();
    expect(container.querySelector(".threadError")?.textContent).toContain("12 photos");
    expect(container.querySelectorAll(".composerPendingThumb")).toHaveLength(0);
  });
  it("shows the server's photo budget error instead of a text-message error", async () => {
    await mount(); await choose([photo()]); await typeAndSend("");
    await act(async () => fetchLog.pendingPosts[0]!(Response.json({ error: "Too many photos, slow down." }, { status: 429 })));
    expect(container.querySelector(".threadError")?.textContent).toContain("Too many photos");
  });
  it("keeps replacement preparation active when a message report fails", async () => {
    await mount(); await choose([photo(0)]);
    let finish!: (value: { file: File; width: number; height: number }) => void;
    photoSelection.prepare.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const replacement = photo(1); await choose([replacement]);
    await act(async () => container.querySelector<HTMLButtonElement>(".messageReportBtn")!.click());
    await act(async () => fetchLog.pendingPosts[0]!(Response.json({ error: "Report unavailable" }, { status: 503 })));
    expect(container.querySelector(".composerPreparing")).not.toBeNull();
    expect(container.querySelector<HTMLButtonElement>(".composerSend")!.disabled).toBe(true);
    await act(async () => finish({ file: replacement, width: 1200, height: 800 }));
    expect(container.querySelector(".composerPendingThumb")?.getAttribute("src")).toBe("blob:photo-1.jpg");
  });
  it("closes the venue picker before sending and retains a failed photo", async () => {
    await mount(); await choose([photo()]);
    await act(async () => container.querySelector<HTMLButtonElement>('[data-attach="venue"]')!.click());
    expect(container.querySelector("[data-pick]")).not.toBeNull();
    await typeAndSend("");
    expect(container.querySelector("[data-pick]")).toBeNull();
    await act(async () => fetchLog.pendingPosts[0]!(Response.json({ error: "Upload interrupted" }, { status: 503 })));
    expect(container.querySelector(".composerPendingThumb")).not.toBeNull();
  });
  it("recovers queued photos and the uncertain send key after leaving the thread", async () => {
    await mount(); await choose([photo(0), photo(1), photo(2)]); await typeAndSend("our photos");
    const key = JSON.parse(posts()[0]!.body).clientMessageId;
    await act(async () => root.unmount()); container.remove();
    await act(async () => fetchLog.pendingPosts[0]!(Response.json({ message: { ...ONE_ROW[0], id: "saved", senderHandle: "ken" } })));
    await mount();
    expect(container.querySelectorAll(".composerPendingThumb")).toHaveLength(3);
    expect(composerValue()).toBe("our photos");
    expect(container.querySelector(".threadError")).toBeNull();
    expect(container.querySelector(".composerPhotoRetry")).toBeNull();
    expect(window.dispatchEvent(new Event("beforeunload", { cancelable: true }))).toBe(false);
    await act(async () => root.unmount()); container.remove();
    await mount();
    expect(container.querySelectorAll(".composerPendingThumb")).toHaveLength(3);
    expect(composerValue()).toBe("our photos");
    await typeAndSend("our photos");
    expect(JSON.parse(posts()[1]!.body).clientMessageId).toBe(key);
  });
});


describe("council pending recovery ownership", () => {
  beforeEach(() => {
    fetchLog.holdPosts = true;
    vi.stubGlobal("URL", class extends URL { static createObjectURL() { return "blob:photo"; } static revokeObjectURL() {} });
    const file = new File([new Uint8Array([1])], "photo.jpg", { type: "image/jpeg" });
    Object.defineProperty(file, "arrayBuffer", { value: async () => new Uint8Array([1]).buffer });
    photoSelection.file = file;
  });
  async function failPhoto() {
    await mount();
    await act(async () => container.querySelector<HTMLButtonElement>("[data-photo]")!.click());
    await typeAndSend("caption");
    await act(async () => fetchLog.pendingPosts[0]!(Response.json({ error: "Upload interrupted" }, { status: 503 })));
  }
  it("restores an untouched selection as a draft through repeated navigation", async () => {
    await mount();
    await act(async () => container.querySelector<HTMLButtonElement>("[data-photo]")!.click());
    await type("Unsent caption");
    for (const visit of [1, 2]) {
      await act(async () => root.unmount()); container.remove();
      await mount();
      expect(container.querySelectorAll(".composerPendingThumb"), `visit ${visit}`).toHaveLength(1);
      expect(composerValue()).toBe("Unsent caption");
      expect(container.querySelector(".threadError")).toBeNull();
      expect(container.querySelector(".composerPhotoRetry")).toBeNull();
      expect(container.querySelector<HTMLButtonElement>(".composerSend")!.disabled).toBe(false);
      expect(posts()).toHaveLength(0);
    }
    await typeAndSend("Unsent caption");
    expect(JSON.parse(posts()[0]!.body)).toMatchObject({ body: "Unsent caption", clientMessageId: expect.any(String) });
  });
  it("releases recovery and the reload warning after a confirmed send", async () => {
    await mount();
    await act(async () => container.querySelector<HTMLButtonElement>("[data-photo]")!.click());
    await typeAndSend("caption");
    await act(async () => fetchLog.pendingPosts[0]!(Response.json({ message: { ...ONE_ROW[0], id: "saved", senderHandle: "ken" } })));
    expect(readMessagePhotoRecovery("user-ken:1:c1")).toBeNull();
    expect(window.dispatchEvent(new Event("beforeunload", { cancelable: true }))).toBe(true);
  });
  it("keeps a refused photo, its caption and its warning across navigation", async () => {
    await failPhoto();
    const failure = container.querySelector(".threadError")!.textContent;
    expect(failure).toContain("Upload interrupted");
    const key = JSON.parse(posts()[0]!.body).clientMessageId;
    expect(window.dispatchEvent(new Event("beforeunload", { cancelable: true }))).toBe(false);
    for (const visit of [1, 2]) {
      await act(async () => root.unmount()); container.remove();
      await mount();
      expect(container.querySelector(".composerPendingThumb"), `visit ${visit}`).not.toBeNull();
      expect(composerValue()).toBe("caption");
      expect(container.querySelector(".threadError")?.textContent).toBe(failure);
      expect(container.querySelector(".composerPhotoRetry")).not.toBeNull();
    }
    expect(window.dispatchEvent(new Event("beforeunload", { cancelable: true }))).toBe(false);
    await act(async () => container.querySelector<HTMLButtonElement>(".composerPhotoRetry")!.click());
    expect(JSON.parse(posts()[1]!.body).clientMessageId).toBe(key);
  });
  it("does not restore one account's failed photo into another account", async () => {
    await failPhoto();
    authState.current = { user: { id: "user-sam" }, handle: "sam", accountRevision: 2 };
    await act(async () => root.render(createElement(MessageThread, { conversationId: "c1" })));
    expect(container.querySelector(".composerPendingThumb")).toBeNull();
    expect(container.querySelector(".threadError")).toBeNull();
    expect(container.querySelector(".composerPhotoRetry")).toBeNull();
  });
  it.each(["replace", "remove"] as const)("clears the old photo error on %s", async action => {
    await failPhoto();
    if (action === "replace") {
      await act(async () => container.querySelector<HTMLButtonElement>('[data-attach="venue"]')!.click());
      await act(async () => container.querySelector<HTMLButtonElement>("[data-pick]")!.click());
    } else await act(async () => container.querySelector<HTMLButtonElement>(".composerPendingRemove")!.click());
    expect(container.querySelector(".threadError")).toBeNull();
    expect(container.querySelector(".composerPhotoRetry")).toBeNull();
    expect(container.querySelector(".composerPendingThumb")).toBeNull();
    expect(window.dispatchEvent(new Event("beforeunload", { cancelable: true }))).toBe(true);
  });
});


describe("terminal conversation photo cleanup", () => {
  beforeEach(() => {
    fetchLog.holdPosts = true;
    vi.stubGlobal("URL", class extends URL { static createObjectURL() { return "blob:photo"; } static revokeObjectURL() {} });
    const file = new File([new Uint8Array([1])], "photo.jpg", { type: "image/jpeg" });
    Object.defineProperty(file, "arrayBuffer", { value: async () => new Uint8Array([1]).buffer });
    photoSelection.file = file;
  });
  it.each(["pending", "sending", "failed", "leave", "notfound"] as const)("discards unreachable photos after %s", async mode => {
    if (mode === "leave") fetchLog.threadConversation = { id: "c1", kind: "group", title: "Our group", members: ["ken", "sam", "maisie"] };
    await mount();
    await act(async () => container.querySelector<HTMLButtonElement>("[data-photo]")!.click());
    if (mode === "sending" || mode === "failed") {
      await typeAndSend("caption");
      if (mode === "failed") await act(async () => fetchLog.pendingPosts[0]!(Response.json({ error: "Upload interrupted" }, { status: 503 })));
    }
    expect(readMessagePhotoRecovery("user-ken:1:c1")).not.toBeNull();
    if (mode === "notfound") {
      fetchLog.threadMissing = true;
      await act(async () => window.dispatchEvent(new Event("focus")));
    } else {
      await act(async () => container.querySelector<HTMLButtonElement>(".threadMenuToggle")!.click());
      const items = container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
      await act(async () => items[mode === "leave" ? 1 : 0]!.click());
      await act(async () => document.querySelector<HTMLButtonElement>(".messageConfirmActions button:last-child")!.click());
      await act(async () => fetchLog.pendingPosts.at(-1)!(Response.json({ ok: true })));
    }
    expect(container.querySelector(".composerInput")).toBeNull();
    expect(readMessagePhotoRecovery("user-ken:1:c1")).toBeNull();
    expect(window.dispatchEvent(new Event("beforeunload", { cancelable: true }))).toBe(true);
    if (mode === "sending") {
      await act(async () => fetchLog.pendingPosts[0]!(Response.json({ error: "Not found" }, { status: 404 })));
      expect(readMessagePhotoRecovery("user-ken:1:c1")).toBeNull();
      expect(window.dispatchEvent(new Event("beforeunload", { cancelable: true }))).toBe(true);
    }
  });
});
