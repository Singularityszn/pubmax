// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  auth: { user: { id: "alice-id" }, handle: "alice", accountRevision: 1 },
  prepare: vi.fn(),
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
  authedActionFetch: async () => Response.json({ messages: [] }),
}));

import MessageThread from "@/components/messages/MessageThread";

let container: HTMLDivElement;
let root: Root;
const revoke = vi.fn();
const createUrl = vi.fn();

async function mount() {
  await act(async () => { root.render(createElement(MessageThread, { conversationId: "c1" })); });
}
async function choosePhoto() {
  const input = container.querySelector<HTMLInputElement>("#message-photo-file")!;
  const file = new File([new Uint8Array([1, 2, 3])], "pint.jpg", { type: "image/jpeg" });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  return file;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.auth = { user: { id: "alice-id" }, handle: "alice", accountRevision: 1 };
  state.prepare.mockReset().mockImplementation(async file => ({ file, width: 1200, height: 600 }));
  createUrl.mockReset().mockReturnValue("blob:photo"); revoke.mockReset();
  vi.stubGlobal("URL", class extends URL { static createObjectURL = createUrl; static revokeObjectURL = revoke; });
  window.matchMedia = (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  Element.prototype.scrollIntoView = () => {};
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

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
