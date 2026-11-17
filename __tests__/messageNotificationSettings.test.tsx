// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  fetch: vi.fn<() => Promise<Response>>(),
  save: vi.fn<() => Promise<void>>(),
  token: vi.fn<() => Promise<string | null>>(),
}));

vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: { id: "recipient" } }) }));
vi.mock("@/lib/authedFetch", () => ({ authedActionFetch: state.fetch }));
vi.mock("@/lib/messageNotificationClient", () => ({
  currentMessagePushToken: state.token,
  messagePushFingerprint: vi.fn(),
  saveMessageNotificationSetting: state.save,
}));
vi.mock("@/lib/webPush", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/webPush")>(),
  webPushSupport: () => "supported",
  registerWebPush: async () => "webpush:device",
}));

import MessageNotificationSettings from "@/components/messages/MessageNotificationSettings";

let host: HTMLDivElement;
let root: Root;
const settings = { enabled: false, preview: false, muted: false, registered: false };
const toggle = () => host.querySelector<HTMLButtonElement>(".messageAlertsToggle")!;
const action = () => host.querySelector<HTMLButtonElement>(".messageAlertsPanel button")!;
const preview = () => host.querySelector<HTMLInputElement>("input")!;
const click = async (element: HTMLElement) => { await act(async () => element.click()); };

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.fetch.mockReset().mockImplementation(async () => Response.json(settings));
  state.save.mockReset().mockResolvedValue(undefined);
  state.token.mockReset().mockResolvedValue(null);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  Reflect.deleteProperty(window, "Capacitor");
});

it("shows a muted thread before its settings panel opens", async () => {
  state.fetch.mockResolvedValue(Response.json({ ...settings, muted: true }));
  await act(async () => root.render(createElement(MessageNotificationSettings, { conversationId: "thread" })));
  expect(toggle().getAttribute("aria-label")).toMatch(/muted/);
  expect(host.querySelector(".messageAlertsPanel")).toBeNull();
});

it("closes with Escape and returns focus to the toggle", async () => {
  await act(async () => root.render(createElement(MessageNotificationSettings)));
  await click(toggle());
  preview().focus();
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(host.querySelector(".messageAlertsPanel")).toBeNull();
  expect(document.activeElement).toBe(toggle());
});

it("retains focus while a save is pending and ignores repeat changes", async () => {
  await act(async () => root.render(createElement(MessageNotificationSettings)));
  await click(toggle());
  let finish!: () => void;
  state.save.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  preview().focus();
  await click(preview());
  expect(document.activeElement).toBe(preview());
  expect(preview().disabled).toBe(false);
  expect(preview().getAttribute("aria-disabled")).toBe("true");
  await click(preview());
  expect(state.save).toHaveBeenCalledOnce();
  await act(async () => finish());
  expect(preview().checked).toBe(true);
});

it.each(["preview", "enabled", "muted"] as const)("keeps a saved %s change when an older panel read finishes", async (kind) => {
  await act(async () => root.render(createElement(MessageNotificationSettings, kind === "muted" ? { conversationId: "thread" } : {})));
  await click(toggle());
  await click(toggle());
  let finishRead!: (response: Response) => void;
  state.fetch.mockImplementationOnce(() => new Promise<Response>((resolve) => { finishRead = resolve; }));
  await click(toggle());
  let finishSave!: () => void;
  state.save.mockImplementationOnce(() => new Promise<void>((resolve) => { finishSave = resolve; }));
  await click(kind === "preview" ? preview() : action());
  expect(toggle().getAttribute("aria-busy")).toBe("true");
  await act(async () => finishSave());
  await act(async () => finishRead(Response.json(settings)));
  expect(toggle().getAttribute("aria-busy")).toBe("false");
  if (kind === "preview") expect(preview().checked).toBe(true);
  else expect(action().textContent).toBe(kind === "muted" ? "Unmute this chat" : "Turn off alerts on all devices");
  expect(state.save).toHaveBeenCalledWith(kind === "muted"
    ? { action: "mute", conversationId: "thread", muted: true }
    : { action: "preferences", enabled: kind === "enabled", preview: kind === "preview" }, expect.any(AbortSignal));
});

it("restores the previous setting after a failed save without accepting an older read", async () => {
  await act(async () => root.render(createElement(MessageNotificationSettings)));
  await click(toggle());
  await click(toggle());
  let finishRead!: (response: Response) => void;
  state.fetch.mockImplementationOnce(() => new Promise<Response>((resolve) => { finishRead = resolve; }));
  await click(toggle());
  state.save.mockRejectedValueOnce(new Error("Offline"));
  await click(preview());
  await act(async () => finishRead(Response.json({ ...settings, preview: true })));
  expect(preview().checked).toBe(false);
  expect(preview().disabled).toBe(false);
  expect(host.querySelector('[role="status"]')).not.toBeNull();
});


it("reconciles a committed change after a response timeout", async () => {
  await act(async () => root.render(createElement(MessageNotificationSettings)));
  await click(toggle());
  state.save.mockRejectedValueOnce(new DOMException("The response timed out.", "TimeoutError"));
  state.fetch.mockResolvedValueOnce(Response.json({ ...settings, preview: true }));
  await click(preview());
  expect(preview().checked).toBe(true);
  expect(toggle().getAttribute("aria-busy")).toBe("false");
  expect(host.querySelector('[role="status"]')).toBeNull();
});

it("does not take focus from the control clicked outside the panel", async () => {
  await act(async () => root.render(createElement(MessageNotificationSettings)));
  await click(toggle());
  const outside = document.createElement("button");
  document.body.append(outside);
  outside.focus();
  await act(async () => outside.dispatchEvent(new Event("pointerdown", { bubbles: true })));
  expect(host.querySelector(".messageAlertsPanel")).toBeNull();
  expect(document.activeElement).toBe(outside);
  outside.remove();
});

it("loads thread mute settings even when the browser subscription does not answer", async () => {
  state.token.mockImplementation(() => new Promise(() => {}));
  state.fetch.mockImplementation(async () => Response.json({ ...settings, muted: true }));
  await act(async () => root.render(createElement(MessageNotificationSettings, { conversationId: "thread" })));
  expect(toggle().getAttribute("aria-label")).toMatch(/muted/);
});

it("shows a retry when timeout confirmation itself fails", async () => {
  await act(async () => root.render(createElement(MessageNotificationSettings)));
  await click(toggle());
  state.save.mockRejectedValueOnce(new DOMException("Timed out", "TimeoutError"));
  state.fetch.mockRejectedValueOnce(new Error("No connection"));
  await click(preview());
  expect(host.querySelector("input")).toBeNull();
  const retry = Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Try again")!;
  expect(retry).toBeDefined();
  await click(retry);
  expect(preview().checked).toBe(false);
  expect(host.querySelector('[role="status"]')).toBeNull();
});


it("leaves global loading and offers retry when the subscription never answers", async () => {
  vi.useFakeTimers();
  try {
    state.token.mockImplementation(() => new Promise(() => {}));
    await act(async () => root.render(createElement(MessageNotificationSettings)));
    await click(toggle());
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    const retry = Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Try again");
    expect(retry).toBeDefined();
    expect(toggle().getAttribute("aria-busy")).toBe("false");
    state.token.mockResolvedValue(null);
    await click(retry!);
    expect(preview().checked).toBe(false);
  } finally { vi.useRealTimers(); }
});

it("leaves confirmation busy state when the subscription lookup hangs", async () => {
  vi.useFakeTimers();
  try {
    await act(async () => root.render(createElement(MessageNotificationSettings)));
    await click(toggle());
    state.save.mockRejectedValueOnce(new DOMException("Timed out", "TimeoutError"));
    state.token.mockImplementation(() => new Promise(() => {}));
    await click(preview());
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(toggle().getAttribute("aria-busy")).toBe("false");
    expect(host.querySelector("input")).toBeNull();
    expect(Array.from(host.querySelectorAll("button")).some(button => button.textContent === "Try again")).toBe(true);
  } finally { vi.useRealTimers(); }
});

it("does not confirm device activation from global consent alone", async () => {
  state.fetch.mockImplementation(async () => Response.json({ ...settings, enabled: true, registered: false }));
  await act(async () => root.render(createElement(MessageNotificationSettings)));
  await click(toggle());
  state.save.mockRejectedValueOnce(new DOMException("Timed out", "TimeoutError"));
  await click(action());
  expect(host.querySelector('[role="status"]')).not.toBeNull();
  expect(action().textContent).toBe("Turn on alerts on this device");
});
