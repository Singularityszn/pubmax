// @vitest-environment jsdom

import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageDTO } from "@/lib/messages";

const state = vi.hoisted(() => ({
  auth: { user: { id: "alice-id" }, handle: "alice", accountRevision: 1 },
  prepare: vi.fn(),
  messages: [] as MessageDTO[],
  request: vi.fn(),
}));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => createElement("a", { href }, children) }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => state.auth }));
vi.mock("@/components/auth/useViewerSession", () => ({ useViewerSession: () => ({ phase: "signed-in", signedIn: true, signedOut: false, unresolved: false }) }));
vi.mock("@/components/auth/SignInButton", () => ({ default: () => createElement("button", {}, "Sign in") }));
vi.mock("@/lib/analytics", () => ({ trackEvent: () => {} }));
vi.mock("@/lib/messagesRealtime", () => ({ subscribeToMessages: () => () => {}, subscribeToInbox: () => () => {} }));
vi.mock("@/lib/preparePhotoUpload", () => ({ preparePhotoUpload: (file: File) => state.prepare(file) }));
vi.mock("@/lib/authedFetch", async importOriginal => ({
  ...(await importOriginal<typeof import("@/lib/authedFetch")>()),
  authedActionFetch: (url: string, init?: RequestInit) => state.request(url, init),
}));

import MessageThread from "@/components/messages/MessageThread";
import MessagePhotoViewer from "@/components/messages/MessagePhotoViewer";
import { discardMessagePhotoRecovery } from "@/lib/messagePhotoRecovery";

let container: HTMLDivElement;
let root: Root;
const revoke = vi.fn();
const createUrl = vi.fn();

async function mount(strict = false) {
  const thread = createElement(MessageThread, { conversationId: "c1" });
  await act(async () => { root.render(strict ? createElement(StrictMode, {}, thread) : thread); });
}
async function choosePhoto() {
  const input = container.querySelector<HTMLInputElement>("#message-photo-file")!;
  const file = new File([new Uint8Array([1, 2, 3])], "pint.jpg", { type: "image/jpeg" });
  Object.defineProperty(file, "arrayBuffer", { value: async () => new Uint8Array([1, 2, 3]).buffer });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  return file;
}

beforeEach(() => {
  discardMessagePhotoRecovery("alice-id:1:c1");
  discardMessagePhotoRecovery("sam-id:2:c1");
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.auth = { user: { id: "alice-id" }, handle: "alice", accountRevision: 1 };
  state.messages = [];
  state.request.mockReset().mockImplementation(async () => Response.json({ messages: state.messages }));
  state.prepare.mockReset().mockImplementation(async file => ({ file, width: 1200, height: 600 }));
  createUrl.mockReset().mockReturnValue("blob:photo"); revoke.mockReset().mockImplementation((url: string) => {
    expect(Array.from(container.querySelectorAll("img")).some(image => image.getAttribute("src") === url)).toBe(false);
  });
  vi.stubGlobal("URL", class extends URL { static createObjectURL = createUrl; static revokeObjectURL = revoke; });
  window.matchMedia = (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  Element.prototype.scrollIntoView = () => {};
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("choosing a DM photo preserves its frame and the composer's focus", () => {
  it("shows preparation immediately, then offers the whole photo without a crop dialog", async () => {
    let finish!: (value: { file: File; width: number; height: number }) => void;
    state.prepare.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    await mount();
    const field = container.querySelector<HTMLTextAreaElement>(".composerInput")!; field.focus();
    const file = await choosePhoto();
    expect(container.querySelector("[role=status]")?.textContent).toContain("Preparing photos");
    expect(container.querySelector<HTMLButtonElement>(".composerSend")!.disabled).toBe(true);
    await act(async () => finish({ file, width: 1200, height: 600 }));
    const preview = container.querySelector<HTMLImageElement>(".composerPendingThumb")!;
    expect([preview.width, preview.height]).toEqual([1200, 600]);
    expect(container.querySelector(".profileCropFrame")).toBeNull();
    expect(container.querySelector<HTMLButtonElement>(".composerSend")!.disabled).toBe(false);
    expect(document.activeElement).toBe(field);
  });

  it("removes a selected photo and releases its preview", async () => {
    await mount(); await choosePhoto();
    await act(async () => container.querySelector<HTMLButtonElement>(".composerPendingRemove")!.click());
    expect(container.querySelector(".composerPendingThumb")).toBeNull();
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:photo");
    expect(container.querySelector<HTMLButtonElement>(".composerSend")!.disabled).toBe(true);
  });

  it("retains the existing photo when a replacement cannot be decoded", async () => {
    await mount(); await choosePhoto();
    state.prepare.mockRejectedValue(new Error("Could not open that photo."));
    await choosePhoto();
    expect(container.querySelector(".threadError")?.textContent).toContain("Could not open that photo.");
    expect(container.querySelector(".composerPhotoRetry")).toBeNull();
    expect(container.querySelector(".composerPendingThumb")?.getAttribute("src")).toBe("blob:photo");
    expect(revoke).not.toHaveBeenCalled();
  });

  it("discards preparation that completes after the reader changes", async () => {
    let finish!: (value: { file: File; width: number; height: number }) => void;
    state.prepare.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    await mount(); const file = await choosePhoto();
    state.auth = { user: { id: "sam-id" }, handle: "sam", accountRevision: 2 };
    await mount();
    await act(async () => finish({ file, width: 1200, height: 600 }));
    expect(createUrl).not.toHaveBeenCalled();
    expect(container.querySelector(".composerPendingThumb")).toBeNull();
    expect(container.querySelector(".composerPreparing")).toBeNull();
  });
});

// The send acknowledgement is not a media load. The sender must keep readable
// bytes while the authenticated image request waits, fails or changes scope.
describe("successful photo handoff", () => {
  let release: (response: Response) => void;
  const stored: MessageDTO = {
    id: "saved-photo", conversationId: "c1", senderHandle: "alice", body: "", createdAt: "2026-11-17T07:00:00Z", read: false, flagged: false,
    attachment: { kind: "photo", url: "/api/messages/c1/photo/saved-photo", width: 1200, height: 600 },
  };
  beforeEach(() => {
    createUrl.mockReturnValueOnce("blob:local").mockReturnValue("blob:stored");
    state.request.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("/photo/")) return new Promise<Response>(resolve => { release = resolve; });
      if (init?.method === "POST") return Promise.resolve(Response.json({ message: stored }));
      return Promise.resolve(Response.json({ messages: state.messages }));
    });
  });
  async function sendPhoto() {
    await mount(true); await choosePhoto();
    await act(async () => container.querySelector<HTMLButtonElement>(".composerSend")!.click());
  }
  const visiblePhoto = () => container.querySelector<HTMLImageElement>(".messagePhotoButton .messagePhoto");
  it("keeps the local frame until stored image load, then releases only the unused URL", async () => {
    await sendPhoto();
    expect(visiblePhoto()?.getAttribute("src")).toBe("blob:local");
    expect(revoke).not.toHaveBeenCalledWith("blob:local");
    await act(async () => release(new Response("stored", { headers: { "Content-Type": "image/jpeg" } })));
    expect(visiblePhoto()?.getAttribute("src")).toBe("blob:local");
    expect(revoke).not.toHaveBeenCalledWith("blob:local");
    await act(async () => container.querySelector<HTMLImageElement>("img[hidden]")!.dispatchEvent(new Event("load")));
    expect(visiblePhoto()?.getAttribute("src")).toBe("blob:stored");
    expect(revoke).toHaveBeenCalledWith("blob:local");
    expect(revoke).not.toHaveBeenCalledWith("blob:stored");
    await act(async () => root.render(null));
    expect(revoke).toHaveBeenCalledWith("blob:stored");
  });
  it("keeps the sender's preview readable when stored media fails and retries", async () => {
    await sendPhoto();
    await act(async () => release(new Response(null, { status: 503 })));
    expect(visiblePhoto()?.getAttribute("src")).toBe("blob:local");
    expect(revoke).not.toHaveBeenCalledWith("blob:local");
    const retry = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Retry photo")!;
    await act(async () => retry.click());
    expect(visiblePhoto()?.getAttribute("src")).toBe("blob:local");
  });
  it.each(["account", "revision", "handle", "conversation", "unmount"])("drops borrowed bytes on %s without accepting a stale media response", async boundary => {
    await sendPhoto();
    const finish = release;
    expect(visiblePhoto()?.getAttribute("src")).toBe("blob:local");
    state.messages = [stored];
    if (boundary === "account") state.auth = { user: { id: "sam-id" }, handle: "sam", accountRevision: 2 };
    if (boundary === "handle") state.auth = { ...state.auth, handle: "sam" };
    if (boundary === "revision") state.auth = { ...state.auth, accountRevision: 2 };
    await act(async () => root.render(boundary === "unmount" ? null : createElement(StrictMode, {}, createElement(MessageThread, { conversationId: boundary === "conversation" ? "c2" : "c1" }))));
    expect(container.querySelector('img[src="blob:local"]')).toBeNull();
    expect(revoke).toHaveBeenCalledWith("blob:local");
    await act(async () => finish(new Response("late", { headers: { "Content-Type": "image/jpeg" } })));
    expect(container.querySelector('img[src="blob:stored"]')).toBeNull();
  });
  it("reserves a loading box for a remote photo without a local preview", async () => {
    state.messages = [stored];
    await mount();
    expect(visiblePhoto()).toBeNull();
    expect(container.querySelector(".messagePhotoPending")?.textContent).toBe("Loading photo");
  });
});

describe("photo viewer pan release", () => {
  let frames: Map<number, FrameRequestCallback>;
  let reducedMotion: boolean;
  let stage: HTMLDivElement;
  let photo: HTMLImageElement;
  const showModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
  const close = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");

  beforeEach(async () => {
    Object.defineProperties(HTMLDialogElement.prototype, {
      showModal: { configurable: true, value(this: HTMLDialogElement) { this.setAttribute("open", ""); } },
      close: { configurable: true, value(this: HTMLDialogElement) { this.removeAttribute("open"); } },
    });
    frames = new Map();
    reducedMotion = false;
    let frameId = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(++frameId, callback);
      return frameId;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    vi.stubGlobal("matchMedia", () => ({ matches: reducedMotion, addEventListener() {}, removeEventListener() {} }));
    vi.spyOn(performance, "now").mockReturnValue(0);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 400, 400));
    await act(async () => root.render(createElement(MessagePhotoViewer, {
      url: "blob:photo", alt: "A pub", width: 800, height: 800, onClose: vi.fn(), onError: vi.fn(),
    })));
    stage = container.querySelector<HTMLDivElement>(".messagePhotoViewerStage")!;
    photo = container.querySelector<HTMLImageElement>(".messagePhotoViewerImage")!;
    stage.setPointerCapture = vi.fn();
    await act(async () => {
      container.querySelector<HTMLButtonElement>("[aria-label='Zoom in']")!.click();
      container.querySelector<HTMLButtonElement>("[aria-label='Zoom in']")!.click();
    });
  });

  afterEach(async () => {
    await act(async () => root.render(null));
    for (const [key, descriptor] of [["showModal", showModal], ["close", close]] as const) {
      if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, key, descriptor);
      else Reflect.deleteProperty(HTMLDialogElement.prototype, key);
    }
  });

  it("claims the shared native window Escape event exactly once", async () => {
    const onClose = vi.fn();
    await act(async () => root.render(createElement(MessagePhotoViewer, {
      url: "blob:photo", alt: "A pub", width: 800, height: 800, onClose, onError: vi.fn(),
    })));
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    await act(async () => { window.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  function pointer(type: string, x: number, y: number, time: number, pointerId = 1) {
    const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
    Object.defineProperties(event, {
      pointerId: { value: pointerId }, pointerType: { value: "touch" }, timeStamp: { value: time + 1 },
    });
    act(() => { stage.dispatchEvent(event); });
  }

  function position() {
    const values = photo.style.transform.match(/^translate\(([^)]+)\)/)![1]!.split(",").map(parseFloat);
    return { x: values[0]!, y: values[1] ?? 0 };
  }

  function frame(time: number) {
    const callbacks = [...frames.values()];
    frames.clear();
    act(() => { callbacks.forEach(callback => callback(time)); });
  }

  it.each([[1, 1.5], [-1, 1.5], [1, 1.1], [-1, 1.1]])("anchors a pinch after %s-direction resisted dragging at ratio %s on both axes", (direction, ratio) => {
    pointer("pointerdown", 100, 100, 0);
    pointer("pointermove", 100 + direction * 300, 100 + direction * 300, 10);
    const visible = position();
    const first = { x: 100 + direction * 300, y: 100 + direction * 300 };
    const second = { x: 400 - first.x, y: 400 - first.y };
    pointer("pointerdown", second.x, second.y, 20, 2);
    pointer("pointermove", first.x, first.y, 30);
    expect(position().x).toBeCloseTo(visible.x);
    expect(position().y).toBeCloseTo(visible.y);
    pointer("pointermove", 200 + (first.x - 200) * ratio, 200 + (first.y - 200) * ratio, 40);
    pointer("pointermove", 200 + (second.x - 200) * ratio, 200 + (second.y - 200) * ratio, 50, 2);
    expect(Number(stage.dataset.scale)).toBeCloseTo(2 * ratio);
    expect(position().x).toBeCloseTo(visible.x * ratio);
    expect(position().y).toBeCloseTo(visible.y * ratio);
    pointer("pointerup", 200 + (first.x - 200) * ratio, 200 + (first.y - 200) * ratio, 50);
    const remaining = { x: 200 + (second.x - 200) * ratio, y: 200 + (second.y - 200) * ratio };
    const pinched = position();
    pointer("pointermove", remaining.x, remaining.y, 60, 2);
    expect(position().x).toBeCloseTo(pinched.x);
    expect(position().y).toBeCloseTo(pinched.y);
    pointer("pointermove", remaining.x - direction * 10, remaining.y - direction * 10, 70, 2);
    expect(position().x * direction).toBeLessThan(pinched.x * direction);
    expect(position().y * direction).toBeLessThan(pinched.y * direction);
    if (ratio === 1.5) {
      expect(position().x).toBeCloseTo(pinched.x - direction * 10);
      expect(position().y).toBeCloseTo(pinched.y - direction * 10);
    }
  });

  it.each((["x", "y"] as const).flatMap(axis =>
    [1, -1].flatMap(direction => [600, 1000, 1_000_000].map(travel => ({ axis, direction, travel }))),
  ))("keeps $axis responsive after a $direction-direction pinch travels $travel pixels", ({ axis, direction, travel }) => {
    const delta = { x: 0, y: 0, [axis]: direction * travel };
    pointer("pointerdown", 100, 100, 0);
    pointer("pointerdown", 300, 300, 0, 2);
    pointer("pointermove", 100 + delta.x, 100 + delta.y, 10);
    pointer("pointermove", 300 + delta.x, 300 + delta.y, 20, 2);
    const pinched = position();
    expect(Number(stage.dataset.scale)).toBe(2);
    expect(pinched[axis] * direction).toBeGreaterThan(200);
    expect(pinched[axis] * direction).toBeLessThanOrEqual(400);
    expect(pinched[axis === "x" ? "y" : "x"]).toBe(0);
    pointer("pointerup", 100 + delta.x, 100 + delta.y, 30);
    pointer("pointermove", 300 + delta.x, 300 + delta.y, 40, 2);
    expect(position()[axis]).toBeCloseTo(pinched[axis]);
    const inward = { x: 0, y: 0, [axis]: direction * 10 };
    pointer("pointermove", 300 + delta.x - inward.x, 300 + delta.y - inward.y, 50, 2);
    expect((pinched[axis] - position()[axis]) * direction).toBeGreaterThan(1);
    pointer("pointerup", 300 + delta.x - inward.x, 300 + delta.y - inward.y, 150, 2);
    frame(5_000);
    expect(position()[axis]).toBe(direction * 200);
    expect(frames.size).toBe(0);
  });

  it.each(["alice", "bob"])("keeps %s's photo action revealed after viewer controls and close", async senderHandle => {
    await act(async () => root.render(null));
    state.messages = [{ id: "m1", conversationId: "c1", senderHandle, body: "", createdAt: "2026-11-17T10:00:00Z", read: true, flagged: false,
      attachment: { kind: "photo", url: "/api/messages/c1/media/m1", width: 800, height: 800 } }];
    await mount();
    container.querySelector<HTMLTextAreaElement>(".composerInput")!.focus();
    await act(async () => container.querySelector<HTMLImageElement>("img[hidden]")!.dispatchEvent(new Event("load")));
    const row = container.querySelector<HTMLLIElement>(".messageRow")!;
    expect(row.hasAttribute("data-revealed")).toBe(false);
    await act(async () => container.querySelector<HTMLButtonElement>(".messagePhotoButton")!.click());
    await act(async () => container.querySelector<HTMLButtonElement>("[aria-label='Zoom in']")!.click());
    await act(async () => container.querySelector<HTMLButtonElement>(".messagePhotoViewerClose")!.click());
    expect(container.querySelector(".messagePhotoViewer")).toBeNull();
    expect(row.hasAttribute("data-revealed")).toBe(true);
    const action = row.querySelector<HTMLButtonElement>(senderHandle === "alice" ? ".messageUnsendBtn" : ".messageReportBtn");
    expect(action?.disabled).toBe(false);
  });

  it.each([1, -1])("hands a %s-direction diagonal flick to momentum and lands at the photo edges", direction => {
    pointer("pointerdown", 200, 200, 0);
    pointer("pointermove", 200 + direction * 20, 200 + direction * 20, 10);
    expect(position()).toEqual({ x: direction * 20, y: direction * 20 });
    pointer("pointerup", 200 + direction * 20, 200 + direction * 20, 10);
    frame(16);
    expect(position().x * direction).toBeGreaterThan(45);
    expect(position().y * direction).toBeGreaterThan(45);
    expect(position().x * direction).toBeLessThan(200);
    frame(5_000);
    expect(position()).toEqual({ x: direction * 200, y: direction * 200 });
    expect(frames.size).toBe(0);
  });

  it.each([1, -1])("resists %s-direction overscroll on both axes and settles without crossing the edge", direction => {
    pointer("pointerdown", 200, 200, 0);
    pointer("pointermove", 200 + direction * 300, 200 + direction * 300, 100);
    expect(position().x).toBeCloseTo(direction * 248.351648);
    expect(position().y).toBeCloseTo(direction * 248.351648);
    pointer("pointerup", 200 + direction * 300, 200 + direction * 300, 200);
    frame(16);
    expect(position().x * direction).toBeGreaterThanOrEqual(200);
    expect(position().x * direction).toBeLessThan(248.351648);
    frame(5_000);
    expect(position()).toEqual({ x: direction * 200, y: direction * 200 });
  });

  it("keeps a short flick's projected landing point inside the pan limits", () => {
    pointer("pointerdown", 200, 200, 0);
    pointer("pointermove", 202, 198, 10);
    pointer("pointerup", 202, 198, 10);
    frame(5_000);
    expect(position().x).toBeCloseTo(101.8);
    expect(position().y).toBeCloseTo(-101.8);
  });

  it("includes the final pointer-up position when no move event delivered it", () => {
    pointer("pointerdown", 200, 200, 0);
    pointer("pointerup", 202, 198, 10);
    expect(position()).toEqual({ x: 2, y: -2 });
    frame(5_000);
    expect(position().x).toBeCloseTo(101.8);
    expect(position().y).toBeCloseTo(-101.8);
  });

  it.each(["pointercancel", "lostpointercapture", "rest"])("settles a %s without a stale fling", end => {
    pointer("pointerdown", 200, 200, 0);
    pointer("pointermove", 220, 220, 10);
    pointer(end === "rest" ? "pointerup" : end, 220, 220, end === "rest" ? 100 : 10);
    expect(position()).toEqual({ x: 20, y: 20 });
    expect(frames.size).toBe(0);
  });

  it("continues from the live position when a new drag catches a spring beyond an edge", () => {
    pointer("pointerdown", 200, 200, 0);
    pointer("pointermove", 500, 500, 10);
    pointer("pointerup", 500, 500, 10);
    frame(16);
    const live = position();
    pointer("pointerdown", 100, 100, 30);
    expect(frames.size).toBe(0);
    pointer("pointermove", 100, 100, 40);
    expect(position()).toEqual(live);
    pointer("pointermove", 90, 90, 50);
    expect(position().x).toBeLessThan(live.x);
    expect(position().y).toBeLessThan(live.y);
  });

  it("continues a pinch as a single-pointer pan and ignores duplicate capture-loss events", () => {
    act(() => container.querySelector<HTMLButtonElement>("button:nth-child(2)")!.click());
    pointer("pointerdown", 100, 200, 0, 1);
    pointer("pointerdown", 300, 200, 0, 2);
    pointer("pointermove", 0, 200, 10, 1);
    pointer("pointermove", 400, 200, 20, 2);
    expect(stage.dataset.scale).toBe("2");
    pointer("pointerup", 0, 200, 20, 1);
    pointer("pointermove", 420, 220, 30, 2);
    expect(position()).toEqual({ x: 20, y: 20 });
    pointer("pointerup", 420, 220, 30, 2);
    pointer("lostpointercapture", 420, 220, 30, 2);
    frame(5_000);
    expect(position()).toEqual({ x: 200, y: 200 });
  });

  it.each(["button", "keyboard", "wheel", "resize", "unmount"])("cancels release motion when interrupted by %s", async action => {
    pointer("pointerdown", 200, 200, 0);
    pointer("pointermove", 220, 220, 10);
    pointer("pointerup", 220, 220, 10);
    expect(frames.size).toBeGreaterThan(0);
    await act(async () => {
      if (action === "button") container.querySelector<HTMLButtonElement>("button:nth-child(2)")!.click();
      if (action === "keyboard") stage.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
      if (action === "wheel") stage.dispatchEvent(new WheelEvent("wheel", { ctrlKey: true, deltaY: 20, bubbles: true }));
      if (action === "resize") window.dispatchEvent(new Event("resize"));
      if (action === "unmount") root.render(null);
    });
    expect(frames.size).toBe(0);
    const stopped = position();
    frame(5_000);
    expect(position()).toEqual(stopped);
    if (action === "button") expect(position()).toEqual({ x: 0, y: 0 });
    if (action === "keyboard") expect(position()).toEqual({ x: 60, y: 20 });
  });

  it("keeps direct tracking but removes momentum and animated settling for reduced motion", () => {
    reducedMotion = true;
    pointer("pointerdown", 200, 200, 0);
    pointer("pointermove", 220, 220, 10);
    expect(position()).toEqual({ x: 20, y: 20 });
    pointer("pointerup", 220, 220, 10);
    expect(position()).toEqual({ x: 20, y: 20 });
    pointer("pointerdown", 200, 200, 20);
    pointer("pointermove", 500, 500, 30);
    expect(position().x).toBeGreaterThan(200);
    pointer("pointerup", 500, 500, 30);
    expect(position()).toEqual({ x: 200, y: 200 });
    expect(frames.size).toBe(0);
  });
});
