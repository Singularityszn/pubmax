// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ owner: "owner-a" }));
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ user: { id: auth.owner }, session: { user: { id: auth.owner }, access_token: "test-only-token" } }),
}));
import PalMemoryConfirmCard from "@/components/pal/PalMemoryConfirmCard";

let root: Root;
let host: HTMLDivElement;
let request: ReturnType<typeof vi.fn>;
let number = 0;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  auth.owner = "owner-a";
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  request = vi.fn(async () => Response.json({ memory: { id: "saved" } }, { status: 201 }));
  vi.stubGlobal("fetch", request);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

function props() {
  return { proposal: { id: `voice-card-${++number}`, kind: "remember_memory" as const, memoryKind: "drink_preference" as const, value: "Cask ale", label: "Remember: Cask ale" }, onDismiss: vi.fn(), onConfirmed: vi.fn() };
}

it("writes nothing for speech alone and saves once after the owner taps the card", async () => {
  const input = props();
  await act(async () => root.render(createElement(PalMemoryConfirmCard, input)));
  expect(request).not.toHaveBeenCalled();
  await act(async () => { host.querySelector<HTMLButtonElement>("button")?.click(); });
  expect(request).toHaveBeenCalledOnce();
  expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({ kind: "drink_preference", value: "Cask ale" });
  expect(host.querySelector('[role="status"]')?.textContent).toBe("Saved: Cask ale");
  expect(input.onConfirmed).toHaveBeenCalledWith("Cask ale");
});

it("dismisses without sending a memory", async () => {
  const input = props();
  await act(async () => root.render(createElement(PalMemoryConfirmCard, input)));
  await act(async () => { host.querySelectorAll<HTMLButtonElement>("button")[1]?.click(); });
  expect(input.onDismiss).toHaveBeenCalledOnce();
  expect(request).not.toHaveBeenCalled();
});

it("hides the old account's card when the account changes", async () => {
  const input = props();
  await act(async () => root.render(createElement(PalMemoryConfirmCard, input)));
  auth.owner = "owner-b";
  await act(async () => root.render(createElement(PalMemoryConfirmCard, input)));
  expect(host.textContent).toBe("");
  expect(request).not.toHaveBeenCalled();
});
