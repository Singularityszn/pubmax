// @vitest-environment jsdom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ user: { id: "account-a" } as { id: string } | null, loading: false }));
vi.mock("@/components/auth/authContext", () => ({ useAuth: () => auth }));
vi.mock("next/navigation", () => ({ usePathname: () => "/map" }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

import PubPalSummon from "@/components/pubpal/PubPalSummon";
import { LOCAL_PAL_KEY, announceLocalPalChange } from "@/lib/localPal";
import { DEVICE_ACCOUNT_OWNER_KEY, emitDeviceIdentityChanged } from "@/lib/deviceAccountIdentity";

let root: Root;
let host: HTMLDivElement;
function savePal(ownerId = "account-a", name = "Robin") {
  localStorage.setItem(LOCAL_PAL_KEY, JSON.stringify({
    id: "pal-a", ownerId, name, appearance: { species: "robin", signalAffinity: "beer", material: "hologram", accessory: "none" }, personality: {},
  }));
}
async function render() {
  await act(async () => { root.render(createElement(PubPalSummon)); });
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  auth.user = { id: "account-a" };
  auth.loading = false;
  localStorage.setItem(DEVICE_ACCOUNT_OWNER_KEY, "account-a");
  savePal();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear();
});

describe("mounted Pal shortcut ownership", () => {
  it("removes the previous account's shortcut during an account switch on the same route", async () => {
    await render();
    expect(host.querySelector("a")?.getAttribute("aria-label")).toContain("Robin");
    auth.user = { id: "account-b" };
    await render();
    expect(host.querySelector("a")).toBeNull();
  });

  it("does not paint the previous account before effects process an account switch", async () => {
    const painted: string[] = [];
    function Boundary() {
      useLayoutEffect(() => { painted.push(host.textContent ?? ""); });
      return createElement(PubPalSummon);
    }
    await act(async () => { root.render(createElement(Boundary)); });
    painted.length = 0;
    auth.user = { id: "account-b" };
    await act(async () => { root.render(createElement(Boundary)); });
    expect(painted).toEqual([""]);
  });

  it("shows the new account's legitimate Pal without removing its saved data", async () => {
    await render();
    auth.user = { id: "account-b" };
    localStorage.setItem(DEVICE_ACCOUNT_OWNER_KEY, "account-b");
    savePal("account-b", "Pip");
    const saved = localStorage.getItem(LOCAL_PAL_KEY);
    await render();
    expect(host.querySelector("a")?.getAttribute("aria-label")).toContain("Pip");
    expect(localStorage.getItem(LOCAL_PAL_KEY)).toBe(saved);
  });

  it("removes the shortcut when the account signs out on the same route", async () => {
    await render();
    auth.user = null;
    await render();
    expect(host.querySelector("a")).toBeNull();
  });

  it("removes the shortcut while the live account is unresolved", async () => {
    await render();
    auth.loading = true;
    await render();
    expect(host.querySelector("a")).toBeNull();
  });

  it("refreshes a renamed Pal after a same-tab cache write", async () => {
    await render();
    await act(async () => { savePal("account-a", "Pip"); announceLocalPalChange(); });
    expect(host.querySelector("a")?.getAttribute("aria-label")).toContain("Pip");
  });

  it("removes a stale Pal when another tab changes the owner stamp", async () => {
    await render();
    await act(async () => {
      localStorage.setItem(DEVICE_ACCOUNT_OWNER_KEY, "account-b");
      window.dispatchEvent(new StorageEvent("storage", { key: DEVICE_ACCOUNT_OWNER_KEY }));
    });
    expect(host.querySelector("a")).toBeNull();
  });

  it("refreshes the Pal when another tab writes its cache", async () => {
    await render();
    await act(async () => {
      savePal("account-a", "Pip");
      window.dispatchEvent(new StorageEvent("storage", { key: LOCAL_PAL_KEY }));
    });
    expect(host.querySelector("a")?.getAttribute("aria-label")).toContain("Pip");
  });

  it("does not show an unstamped cached Pal", async () => {
    localStorage.removeItem(DEVICE_ACCOUNT_OWNER_KEY);
    await render();
    expect(host.querySelector("a")).toBeNull();
  });

  it("removes the shortcut after a same-tab identity reset", async () => {
    await render();
    await act(async () => { localStorage.removeItem(LOCAL_PAL_KEY); emitDeviceIdentityChanged(); });
    expect(host.querySelector("a")).toBeNull();
  });

  it("does not show another account's Pal under the current device stamp", async () => {
    savePal("account-b");
    await render();
    expect(host.querySelector("a")).toBeNull();
  });
});
