// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import FriendLocationControl from "@/components/map/friends/FriendLocationControl";
import type { FriendLocationSession } from "@/lib/friendLocation";

const fixture = vi.hoisted(() => ({
  state: {
    status: "ready", message: "Choose who can see you.", own: null as FriendLocationSession | null,
    mutuals: [{ profileId: "bob", handle: "bob" }], friends: [],
  },
  client: { start: vi.fn(), stop: vi.fn(), refresh: vi.fn() },
  signedIn: true,
  accountKey: "alice:0",
}));
vi.mock("@/components/map/friends/useFriendLocations", () => ({ useFriendLocations: () => fixture }));
vi.mock("@/components/map/friends/useFriendLocationMarkers", () => ({ useFriendLocationMarkers: () => {} }));

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.state.mutuals = [{ profileId: "bob", handle: "bob" }];
  fixture.state.own = null;
  fixture.state.status = "ready";
  fixture.state.message = "Choose who can see you.";
  fixture.client.start.mockReset();
  fixture.client.stop.mockReset();
  host = document.createElement("div"); document.body.appendChild(host);
  root = createRoot(host);
});

it("stages inactive Friends until the first-visit answer without removing the component", async () => {
  const pending = { map: null, arrivalPending: true };
  await act(async () => { root.render(createElement(FriendLocationControl, pending)); });
  expect(host.querySelector("button")).toBeNull();
  await act(async () => { root.render(createElement(FriendLocationControl, { ...pending, arrivalPending: false })); });
  expect(host.querySelector("button")?.getAttribute("aria-label")).toBe("Friend locations");
});

it("keeps an existing share and its Stop action reachable during the first-visit ask", async () => {
  fixture.state.own = {
    sessionId: "10000000-0000-4000-8000-000000000002", revision: 1,
    expiresAt: "2026-10-02T01:00:00.000Z", recipients: ["bob"], accuracy: 110,
  };
  fixture.state.status = "paused";
  const pending = { map: null, arrivalPending: true };
  await act(async () => { root.render(createElement(FriendLocationControl, pending)); });
  await act(async () => { host.querySelector<HTMLButtonElement>("button")!.click(); });
  const stop = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Stop sharing")!;
  expect(stop.disabled).toBe(false);
  await act(async () => { stop.click(); });
  expect(fixture.client.stop).toHaveBeenCalledTimes(1);
});

it("keeps an uncertain sharing start reachable without enabling another start", async () => {
  fixture.state.status = "start-unconfirmed";
  fixture.state.message = "Sharing start is unconfirmed. Updates are stopped here.";
  const pending = { map: null, arrivalPending: true };
  await act(async () => { root.render(createElement(FriendLocationControl, pending)); });
  await act(async () => { host.querySelector<HTMLButtonElement>("button")!.click(); });
  expect(host.querySelector('[role="status"]')?.textContent).toContain("unconfirmed");
  const share = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Share my location")!;
  expect(share.disabled).toBe(true);
  expect(fixture.client.start).not.toHaveBeenCalled();
});

it("keeps an open Friends panel when the first-visit ask becomes pending", async () => {
  await act(async () => { root.render(createElement(FriendLocationControl, { map: null })); });
  await act(async () => { host.querySelector<HTMLButtonElement>("button")!.click(); });
  const pending = { map: null, arrivalPending: true };
  await act(async () => { root.render(createElement(FriendLocationControl, pending)); });
  expect(host.querySelector("section")?.getAttribute("aria-label")).toBe("Friend locations");
  expect(host.querySelector("button")?.getAttribute("aria-expanded")).toBe("true");
});

it("claims Escape from the focused trigger and closes the anchored panel", async () => {
  await act(async () => { root.render(createElement(FriendLocationControl, { map: null })); });
  const trigger = host.querySelector<HTMLButtonElement>("button")!;
  trigger.focus();
  await act(async () => { trigger.click(); });
  expect(document.activeElement).toBe(trigger);
  expect(host.querySelector("section")).not.toBeNull();
  const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  await act(async () => { trigger.dispatchEvent(escape); });
  expect(host.querySelector("section")).toBeNull();
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(escape.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(trigger);
  const closedEscape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  trigger.dispatchEvent(closedEscape);
  expect(closedEscape.defaultPrevented).toBe(false);
});

it("keeps inside pointers open and dismisses outside without stealing focus", async () => {
  await act(async () => { root.render(createElement(FriendLocationControl, { map: null })); });
  const trigger = host.querySelector<HTMLButtonElement>("button")!;
  await act(async () => { trigger.click(); });
  await act(async () => { host.querySelector("section")!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })); });
  expect(host.querySelector("section")).not.toBeNull();
  const outside = document.createElement("input");
  document.body.appendChild(outside);
  try {
    outside.focus();
    await act(async () => { outside.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })); });
    expect(host.querySelector("section")).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(outside);
  } finally {
    outside.remove();
  }
});

it("keeps another Share disabled while a lost start response awaits authority confirmation", async () => {
  await act(async () => { root.render(createElement(FriendLocationControl, { map: null })); });
  await act(async () => { host.querySelector<HTMLButtonElement>("button")!.click(); });
  await act(async () => { host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(); });
  fixture.state.status = "start-unconfirmed";
  fixture.state.message = "Sharing start is unconfirmed. Checking server authority. Updates remain stopped here.";
  await act(async () => { root.render(createElement(FriendLocationControl, { map: null })); });
  const share = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Share my location")!;
  expect(share.disabled).toBe(true);
  expect(host.querySelector('[role="status"]')?.textContent).toContain("unconfirmed");
  expect([...host.querySelectorAll<HTMLButtonElement>("button")].some((button) => button.textContent === "Check locations again")).toBe(true);
  await act(async () => { share.click(); });
  expect(fixture.client.start).not.toHaveBeenCalled();
});

it("shows server-confirmed owner uncertainty alongside recipients, end time and Stop", async () => {
  const confirmed = {
    sessionId: "10000000-0000-4000-8000-000000000001", revision: 1,
    expiresAt: "2026-09-30T03:00:00.000Z", recipients: ["bob"], accuracy: 5270.4,
  };
  fixture.state.own = confirmed;
  await act(async () => { root.render(createElement(FriendLocationControl, { map: null })); });
  await act(async () => { host.querySelector<HTMLButtonElement>("button")!.click(); });
  expect(host.textContent).toContain("Accuracy about 5271 metres.");
  expect(host.textContent).toContain("Shared with bob.");
  expect(host.textContent).toContain("Ends ");
  expect([...host.querySelectorAll<HTMLButtonElement>("button")].some((button) => button.textContent === "Stop sharing")).toBe(true);
  fixture.state.own = { ...confirmed, revision: 2, accuracy: 280.2 };
  await act(async () => { root.render(createElement(FriendLocationControl, { map: null })); });
  expect(host.textContent).toContain("Accuracy about 281 metres.");
  expect(host.textContent).not.toContain("Accuracy about 5271 metres.");
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

it("drops a selected mate who stops being mutual before location sharing starts", async () => {
  await act(async () => { root.render(createElement(FriendLocationControl, { map: null })); });
  await act(async () => { host.querySelector<HTMLButtonElement>("button")!.click(); });
  await act(async () => { host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(); });
  const shareButton = () => [...host.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent === "Share my location")!;
  expect(shareButton().disabled).toBe(false);
  fixture.state.mutuals = [];
  await act(async () => { root.render(createElement(FriendLocationControl, { map: null })); });
  expect(shareButton().disabled).toBe(true);
  expect(fixture.client.start).not.toHaveBeenCalled();
});
