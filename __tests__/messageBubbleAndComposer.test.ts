// @vitest-environment jsdom

import { act, createElement, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  finePointer: false, mobile: false, request: vi.fn(), track: vi.fn(),
  auth: { user: { id: "user-1" }, handle: "alice", accountRevision: 1 },
}));
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => state.auth,
}));
vi.mock("@/components/auth/useViewerSession", () => ({
  useViewerSession: () => ({ phase: "signed-in", signedIn: true, signedOut: false, unresolved: false }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children?: ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));
vi.mock("@/lib/authedFetch", () => ({ authedActionFetch: (...args: unknown[]) => state.request(...args) }));
vi.mock("@/lib/messagesRealtime", () => ({ subscribeToMessages: () => () => {}, subscribeToInbox: () => () => {} }));
vi.mock("@/lib/analytics", () => ({ trackEvent: (...args: unknown[]) => state.track(...args) }));

import MessageThread from "@/components/messages/MessageThread";
import MessagePhoto from "@/components/messages/MessagePhoto";
import MessageAttachmentPicker from "@/components/messages/MessageAttachmentPicker";
import MessagePollCard from "@/components/messages/MessagePollCard";
import MessagePollComposer from "@/components/messages/MessagePollComposer";
import {
  MESSAGE_ATTACHMENT_KINDS,
  MESSAGE_ATTACH_CONTACT_LABEL, MESSAGE_ATTACH_EVENT_LABEL, MESSAGE_ATTACH_POLL_LABEL, MESSAGE_ATTACH_VENUE_LABEL,
  MESSAGE_PHOTO_ASPECT_PROPERTY, MESSAGE_PHOTO_ASPECT_RATIO, messagePhotoAspect,
} from "@/lib/messageAttachments";
import { POLL_COMPOSE_LABEL, POLL_UNREADABLE_LINE, type MessagePollView } from "@/lib/messagePoll";
import { MAX_MESSAGE_BODY } from "@/lib/messages";
import { defined } from "@/__tests__/helpers/defined";

const BALLOT = [{ index: 0, label: "The Harp", votes: 0 }, { index: 1, label: "The Blackfriar", votes: 0 }] as const;
const messages = ["alice", "bridget"].map((senderHandle, i) => ({
  id: `message-${i}`, conversationId: "conversation-1", senderHandle, body: "Yo!!",
  createdAt: "2026-10-01T18:00:00.000Z", read: false, flagged: false,
}));
let host: HTMLDivElement;
let root: Root;
let restoreDOM: Array<() => void>;

function domMethod(target: object, name: string, value: unknown): void {
  const original = Object.getOwnPropertyDescriptor(target, name);
  Object.defineProperty(target, name, { configurable: true, writable: true, value });
  restoreDOM.push(() => {
    if (original) Object.defineProperty(target, name, original);
    else Reflect.deleteProperty(target, name);
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  restoreDOM = [];
  domMethod(URL, "createObjectURL", vi.fn(() => "blob:private-photo"));
  domMethod(URL, "revokeObjectURL", vi.fn());
  domMethod(HTMLDialogElement.prototype, "showModal", function (this: HTMLDialogElement) { this.open = true; });
  domMethod(HTMLDialogElement.prototype, "close", function (this: HTMLDialogElement) { this.open = false; });
  state.finePointer = false;
  state.mobile = false;
  state.track.mockReset();
  state.request.mockReset().mockImplementation((_url: string, init?: RequestInit) => {
    if (init?.method === "POST") return Promise.resolve(Response.json({ message: {
      ...messages[0], id: "sent-1", body: JSON.parse(String(init.body)).body,
    } }));
    return Promise.resolve(Response.json({ messages, conversations: [] }));
  });
  window.matchMedia = ((query: string) => ({
    matches: query === "(pointer: fine)" ? state.finePointer : state.mobile,
    media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  restoreDOM.reverse().forEach((restore) => restore());
});

async function render(element: ReactElement): Promise<void> {
  await act(async () => root.render(element));
}
async function thread(): Promise<void> {
  await render(createElement(MessageThread, { conversationId: "conversation-1" }));
}
function field(): HTMLTextAreaElement {
  return host.querySelector('textarea[aria-label="Message"]')!;
}
function button(label: string): HTMLButtonElement {
  const target = Array.from(host.querySelectorAll("button")).find((node) =>
    (node.getAttribute("aria-label") ?? node.textContent ?? "").trim() === label);
  expect(target, label).toBeDefined();
  return target!;
}
async function typeInto(input: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> {
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("mobile message attachment picker", () => {
  it("renders labelled library, camera, and file targets with honest inputs", () => {
    const markup = renderToStaticMarkup(
      createElement(MessageAttachmentPicker, {
        open: true,
        disabled: false,
        onOpenChange: () => {},
        onFileChange: () => {},
        onKindSelected: () => {},
      }),
    );

    expect(markup).toContain('class="mobileSheetPortal messageAttachSheetPortal"');
    expect(markup).toContain('class="mobileSharedSheet');
    expect(markup).toContain(">Photos</span>");
    expect(markup).toContain(">Camera</span>");
    expect(markup).toContain(">Document</span>");
    expect(markup).toMatch(/id="message-photo-file"[^>]*type="file"[^>]*>/);
    expect(markup).toMatch(/id="message-camera-file"[^>]*type="file"[^>]*capture="environment"[^>]*>/);
    expect(markup).toMatch(/id="message-document-file"[^>]*type="file"[^>]*>/);
    expect(markup).not.toMatch(/id="message-photo-file"[^>]*capture=/);
    expect(markup).not.toMatch(/id="message-document-file"[^>]*capture=/);
  });

  it("names non-file attach targets with the long accessible labels", () => {
    const markup = renderToStaticMarkup(
      createElement(MessageAttachmentPicker, {
        open: true,
        disabled: false,
        onOpenChange: () => {},
        onFileChange: () => {},
        onKindSelected: () => {},
        onAttachmentKind: () => {},
      }),
    );

    expect(markup).toContain(`aria-label="${MESSAGE_ATTACH_VENUE_LABEL}"`);
    expect(markup).toContain(`aria-label="${MESSAGE_ATTACH_CONTACT_LABEL}"`);
    expect(markup).toContain(`aria-label="${MESSAGE_ATTACH_EVENT_LABEL}"`);
    expect(markup).toContain(`aria-label="${MESSAGE_ATTACH_POLL_LABEL}"`);
  });

  it("refuses to render a poll it cannot read, and says so in words", () => {
    // A ballot needs a question and at least two answers, so a row that lost
    // either is a row nobody can vote in. Printing a bare button list or an
    // empty question reads as a poll that is merely loading, and a reader waits
    // for something that is never coming; the line says what happened instead.
    const unreadable: readonly MessagePollView[] = [
      { question: "   ", options: BALLOT, totalVotes: 0, viewerOptionIndex: null },
      {
        question: "Where first?",
        options: [{ index: 0, label: "The Harp", votes: 0 }],
        totalVotes: 0,
        viewerOptionIndex: null,
      },
    ];
    for (const poll of unreadable) {
      const markup = renderToStaticMarkup(createElement(MessagePollCard, { poll }));
      expect(markup).toContain(POLL_UNREADABLE_LINE);
      expect(markup).not.toContain("messagePollQuestion");
    }
  });

  it("renders a readable ballot rather than the unreadable line", () => {
    const markup = renderToStaticMarkup(
      createElement(MessagePollCard, {
        poll: {
          question: "Where first?",
          options: BALLOT,
          totalVotes: 0,
          viewerOptionIndex: null,
        },
      }),
    );
    expect(markup).not.toContain(POLL_UNREADABLE_LINE);
    expect(markup).toContain("Where first?");
  });

  it("names the poll composer as one group, on an element that can carry a name", () => {
    // `aria-label` on a bare <div> is discarded: the generic role takes no
    // accessible name, so the label has to ride a real role.
    const markup = renderToStaticMarkup(
      createElement(MessagePollComposer, { onPick: () => {}, onCancel: () => {} }),
    );
    expect(markup).toMatch(
      new RegExp(`role="group"[^>]*aria-label="${POLL_COMPOSE_LABEL}"`),
    );
  });

});
describe("message photo dimensions", () => {
  it("falls back to the frame a message photo is cut to when a dimension is missing", () => {
    expect(messagePhotoAspect(1080, 1350)).toBeCloseTo(0.8, 10);
    expect(messagePhotoAspect(1080, 720)).toBeCloseTo(1.5, 10);
    for (const bad of [
      [0, 1350],
      [1080, 0],
      [-4, 5],
      [Number.NaN, 1350],
      [null, undefined],
      ["1080", "1350"],
    ] as const) {
      expect(messagePhotoAspect(bad[0], bad[1])).toBe(MESSAGE_PHOTO_ASPECT_RATIO);
    }
  });

});
describe("rendered conversation and composer", () => {
  it("keeps own and incoming bubbles and metadata in their row's width wrapper", async () => {
    await thread();
    const rows = host.querySelectorAll(".messageRow");
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const line = row.querySelector(".messageLine");
      expect(line?.parentElement).toBe(row);
      expect(line?.querySelector(".messageBubble")?.parentElement).toBe(line);
      expect(line?.querySelector(".messageMeta")?.parentElement).toBe(line);
      expect(line?.textContent).toContain("Yo!!");
    }
  });

  it("renders keyboard help for prose and grows to the measured scroll height", async () => {
    await thread();
    const input = field();
    expect(input.getAttribute("autocapitalize")).toBe("sentences");
    expect(input.getAttribute("autocorrect")).toBe("on");
    expect(input.getAttribute("spellcheck")).toBe("true");
    expect(input.rows).toBe(1);
    Object.defineProperty(input, "scrollHeight", { configurable: true, value: 88 });
    await typeInto(input, "A longer message");
    expect(input.style.height).toBe("88px");
  });

  it.each([false, true])("Enter respects pointer capability %s and Shift preserves newline", async (fine) => {
    state.finePointer = fine;
    await thread();
    expect(field().getAttribute("enterkeyhint")).toBe(fine ? "send" : "enter");
    await typeInto(field(), "See you there");
    const posts = () => state.request.mock.calls.filter(([, init]) => init?.method === "POST");
    await act(async () => field().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true })));
    expect(posts()).toHaveLength(0);
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    await act(async () => field().dispatchEvent(event));
    expect(event.defaultPrevented).toBe(fine);
    expect(posts()).toHaveLength(fine ? 1 : 0);
    if (fine) expect(JSON.parse(String(defined(posts()[0])[1].body))).toMatchObject({ action: "send", handle: "alice", body: "See you there" });
    else expect(field().value).toBe("See you there");
  });

  it("refuses whitespace and over-cap drafts while displaying actual count", async () => {
    await thread();
    expect(button("Send").disabled).toBe(true);
    await typeInto(field(), "   ");
    expect(button("Send").disabled).toBe(true);
    expect(MAX_MESSAGE_BODY).toBe(1000);
    expect(field().maxLength).toBe(MAX_MESSAGE_BODY + 100);
    await typeInto(field(), "x".repeat(MAX_MESSAGE_BODY + 1));
    expect(host.querySelector(".composerCount")?.textContent).toBe("1001/1000");
    expect(button("Send").disabled).toBe(true);
    await typeInto(field(), "x".repeat(MAX_MESSAGE_BODY));
    expect(host.querySelector(".composerCount")?.textContent).toBe("1000/1000");
    expect(button("Send").disabled).toBe(false);
  });

  it("sends attachment-only poll, records selection, and blocks duplicate send", async () => {
    state.mobile = true;
    await thread();
    await act(async () => button("Add an attachment").click());
    await act(async () => button(MESSAGE_ATTACH_POLL_LABEL).click());
    expect(state.track).toHaveBeenCalledWith("message_attach_selected", { kind: "poll" });
    const inputs = host.querySelectorAll<HTMLInputElement>(".composerPollComposer input");
    expect(inputs).toHaveLength(3);
    await typeInto(defined(inputs[0]), "Where first?");
    await typeInto(defined(inputs[1]), "The Harp");
    await typeInto(defined(inputs[2]), "The Blackfriar");
    const attach = host.querySelector<HTMLButtonElement>(".composerPollComposer .composerVenueResult")!;
    await act(async () => attach.click());
    expect(field().value).toBe("");
    expect(button("Send").disabled).toBe(false);
    let release!: (response: Response) => void;
    state.request.mockImplementation((_url: string, init?: RequestInit) => init?.method === "POST"
      ? new Promise<Response>((resolve) => { release = resolve; })
      : Promise.resolve(Response.json({ messages })));
    const send = button("Send");
    await act(async () => { send.click(); send.click(); });
    const posts = state.request.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(1);
    expect(JSON.parse(String(defined(posts[0])[1].body))).toMatchObject({ body: "", poll: { question: "Where first?", options: ["The Harp", "The Blackfriar"] } });
    expect(button("Send").disabled).toBe(true);
    await act(async () => release(Response.json({ message: { ...messages[0], id: "poll-sent", body: "" } })));
  });
});

describe("attachment chooser interactions", () => {
  it.each(["photos", "camera", "document"] as const)("opens %s input and closes chooser", async (kind) => {
    const onOpenChange = vi.fn();
    const onKindSelected = vi.fn();
    const onFileChange = vi.fn();
    await render(createElement(MessageAttachmentPicker, { open: true, disabled: false, onOpenChange, onKindSelected, onFileChange }));
    const inputId = { photos: "message-photo-file", camera: "message-camera-file", document: "message-document-file" }[kind];
    const input = host.querySelector<HTMLInputElement>(`#${inputId}`)!;
    const click = vi.spyOn(input, "click").mockImplementation(() => {});
    await act(async () => button({ photos: "Photos", camera: "Camera", document: "Document" }[kind]).click());
    expect(onKindSelected).toHaveBeenCalledWith(kind);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(click).toHaveBeenCalledOnce();
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(onFileChange).toHaveBeenCalledOnce();
  });

  it.each(["Dismiss attachment chooser", "Close attachment chooser"])("closes through %s", async (label) => {
    const close = vi.fn();
    await render(createElement(MessageAttachmentPicker, { open: true, disabled: false, onOpenChange: close, onKindSelected: vi.fn(), onFileChange: vi.fn() }));
    await act(async () => button(label).click());
    expect(close).toHaveBeenCalledWith(false);
  });

  it("dismisses downward swipe and keeps short drag open", async () => {
    const close = vi.fn();
    await render(createElement(MessageAttachmentPicker, { open: true, disabled: false, onOpenChange: close, onKindSelected: vi.fn(), onFileChange: vi.fn() }));
    const header = host.querySelector("header")!;
    const drag = async (distance: number) => {
      for (const [type, y] of [["pointerdown", 100], ["pointermove", 100 + distance], ["pointerup", 100 + distance]] as const) {
        await act(async () => header.dispatchEvent(new MouseEvent(type, { clientY: y, bubbles: true })));
      }
    };
    await drag(40);
    expect(close).not.toHaveBeenCalled();
    await drag(100);
    expect(close).toHaveBeenCalledWith(false);
  });

  it("exposes only supported attachment kinds", () => {
    expect([...MESSAGE_ATTACHMENT_KINDS]).toEqual(["photo", "venue", "contact", "event", "poll"]);
  });
});

describe("private photo rendering", () => {
  it("renders an unavailable photo without exposing its private address", async () => {
    state.request.mockResolvedValue(new Response(null, { status: 403 }));
    await render(createElement(MessagePhoto, { url: "/api/messages/private-photo", width: 1080, height: 1350, handle: "alice", senderHandle: "bridget" }));
    expect(host.querySelector(".messagePhotoFailed")).not.toBeNull();
    expect(host.querySelector("img")).toBeNull();
    expect(host.textContent).not.toContain("/api/messages/private-photo");
  });

  it("preserves reserved aspect after authenticated bytes arrive and opens full-frame viewer", async () => {
    let release!: (response: Response) => void;
    state.request.mockImplementation(() => new Promise<Response>((resolve) => { release = resolve; }));
    const createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:private-photo");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const show = vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function (this: HTMLDialogElement) { this.open = true; });
    vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function (this: HTMLDialogElement) { this.open = false; });
    await render(createElement(MessagePhoto, { url: "/api/messages/photo", width: 1080, height: 1350, handle: "alice", senderHandle: "bridget" }));
    const figure = host.querySelector<HTMLElement>("figure")!;
    expect(figure.style.getPropertyValue(MESSAGE_PHOTO_ASPECT_PROPERTY)).toBe("0.8");
    expect(figure.textContent).toContain("Loading photo");
    expect(host.querySelector("img")).toBeNull();
    expect(state.request).toHaveBeenCalledWith("/api/messages/photo?handle=alice", expect.objectContaining({ signal: expect.any(AbortSignal) }), { requiresIdentity: true });
    await act(async () => release(new Response("private", { status: 200 })));
    expect(createUrl).toHaveBeenCalledOnce();
    const photoBlob = defined(createUrl.mock.calls[0])[0];
    if (!("text" in photoBlob)) throw new Error("Expected photo bytes as a Blob");
    await expect(photoBlob.text()).resolves.toBe("private");
    expect(host.querySelector("figure")).toBe(figure);
    expect(figure.style.getPropertyValue(MESSAGE_PHOTO_ASPECT_PROPERTY)).toBe("0.8");
    expect(host.querySelector(".messagePhotoPending")).toBeNull();
    expect(host.querySelector(".messagePhoto")?.getAttribute("src")).toBe("blob:private-photo");
    await act(async () => host.querySelector<HTMLButtonElement>(".messagePhotoButton")!.click());
    const dialog = host.querySelector("dialog")!;
    expect(show).toHaveBeenCalledOnce();
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector("img")?.getAttribute("src")).toBe("blob:private-photo");
    await act(async () => dialog.click());
    expect(dialog.open).toBe(false);
    await act(async () => host.querySelector<HTMLButtonElement>(".messagePhotoButton")!.click());
    await act(async () => button("Close").click());
    expect(dialog.open).toBe(false);
    await act(async () => root.render(null));
    expect(revoke).toHaveBeenCalledWith("blob:private-photo");
  });
});
