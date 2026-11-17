// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  fetch: vi.fn<() => Promise<Response>>(),
  save: vi.fn<() => Promise<void>>(),
}));

vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: { id: "recipient" } }) }));
vi.mock("@/lib/authedFetch", () => ({ authedActionFetch: state.fetch }));
vi.mock("@/lib/messageNotificationClient", () => ({
  currentMessagePushToken: async () => null,
  messagePushFingerprint: vi.fn(),
  saveMessageNotificationSetting: state.save,
}));
vi.mock("@/lib/webPush", () => ({
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
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
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
  expect(toggle().disabled).toBe(true);
  await act(async () => finishSave());
  await act(async () => finishRead(Response.json(settings)));
  expect(toggle().disabled).toBe(false);
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
