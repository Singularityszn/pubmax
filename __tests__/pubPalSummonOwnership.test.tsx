// @vitest-environment jsdom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ user: { id: "account-a" } as { id: string } | null, loading: false }));
vi.mock("@/components/auth/authContext", () => ({ useAuth: () => ({ ...auth, getCurrentUserId: () => auth.user?.id ?? null }) }));
vi.mock("@/components/auth/useViewerSession", () => ({
  useViewerSession: () => ({ signedOut: !auth.loading && auth.user === null }),
}));
// Account switching is checked on /plan, where the chip is the link to the Pal.
const route = vi.hoisted(() => ({ pathname: "/plan" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));
const eligibility = vi.hoisted(() => ({ under18: false as boolean | undefined }));
vi.mock("@/lib/authedFetch", () => ({
  authedActionFetch: vi.fn(async () => Response.json({ pal: null, under18: eligibility.under18 })),
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

import { markActivePlan, readActivePlan, setActivePlanPalContext, setActivePlanStopIndex, writeActivePlan } from "@/lib/activePlan";
import { announcePalMoment } from "@/lib/palMoments";
import { readPendingCompletedNight, recordCompletedNight } from "@/lib/morningReentry";
import PubPalSummon from "@/components/pubpal/PubPalSummon";
import { LOCAL_PAL_KEY, announceLocalPalChange } from "@/lib/localPal";
import { DEVICE_ACCOUNT_OWNER_KEY, emitDeviceIdentityChanged } from "@/lib/deviceAccountIdentity";

let root: Root;
let host: HTMLDivElement;
function savePal(ownerId = "account-a", name = "Robin") {
  localStorage.setItem(LOCAL_PAL_KEY, JSON.stringify({
    id: `pal-${ownerId}`, ownerId, name, appearance: { species: "robin", signalAffinity: "beer", material: "hologram", accessory: "none" }, personality: {},
  }));
}
async function render() {
  await act(async () => { root.render(createElement(PubPalSummon)); });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  sessionStorage.clear();
  auth.user = { id: "account-a" };
  auth.loading = false;
  route.pathname = "/plan";
  eligibility.under18 = false;
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ available: true })));
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
  sessionStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("mounted Pal shortcut ownership", () => {
  it("retires the previous account's cheer and night offer when a new Pal arrives", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date(2026, 9, 18, 9, 0));
    const planId = "11111111-1111-4111-8111-111111111111";
    writeActivePlan({ ownerId: "account-a", id: planId, startTime: new Date(2026, 9, 17, 23, 0).toISOString(), stopIndex: 6, palContext: { id: "pal-account-a", name: "Robin" } });
    recordCompletedNight({ version: 1, planId, title: "A's night", completedAt: new Date(2026, 9, 18, 1, 0).toISOString() });
    await render();
    expect(host.querySelector("small")?.textContent).toBe("Morning. Last night's kept");
    await act(async () => { announcePalMoment({ kind: "crawl-finished", stops: 7 }); });
    expect(host.querySelector("small")?.textContent).toBe("Walked all 7 stops");

    auth.user = { id: "account-b" };
    localStorage.setItem(DEVICE_ACCOUNT_OWNER_KEY, "account-b");
    savePal("account-b", "Pip");
    await render();
    expect(host.querySelector("a")?.getAttribute("aria-label")).toContain("Pip");
    expect(readPendingCompletedNight()?.planId).toBe(planId);
    expect(readActivePlan()?.palContext?.id).toBe("pal-account-a");
    expect(host.querySelector("a")?.classList.contains("isCheering")).toBe(false);
    expect(host.querySelector("small")?.textContent).toBe("Morning. Tap to plan tonight");
    await act(async () => { vi.advanceTimersByTime(6_001); });
    expect(host.querySelector("small")?.textContent).toBe("Morning. Tap to plan tonight");
  });

  it("does not transfer a night when the next account opens Pal and returns to the map", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date(2026, 9, 18, 19, 0));
    const planId = "11111111-1111-4111-8111-111111111111";
    markActivePlan(planId, new Date().toISOString(), Date.now(), "account-a");
    setActivePlanStopIndex(4);
    setActivePlanPalContext({ id: "pal-account-a", name: "Robin" }, "account-a");
    await render();
    expect(host.querySelector("small")?.textContent).toBe("Night's on. Stop 5");
    auth.user = { id: "account-b" };
    localStorage.setItem(DEVICE_ACCOUNT_OWNER_KEY, "account-b");
    savePal("account-b", "Pip");
    await render();
    expect(host.querySelector("small")?.textContent).toBe("Where to tonight?");
    expect(readActivePlan()?.stopIndex).toBe(4);
    await act(async () => {
      setActivePlanPalContext({ id: "pal-account-b", name: "Pip" }, "account-b");
    });
    expect(readActivePlan()?.ownerId).toBe("account-a");
    expect(readActivePlan()?.palContext?.id).toBe("pal-account-a");
    expect(host.querySelector("small")?.textContent).toBe("Where to tonight?");
  });

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

  it("removes the shortcut when the account signs out on the map, and offers sign-in there", async () => {
    route.pathname = "/map";
    await render();
    auth.user = null;
    await render();
    expect(host.querySelector('a[href="/pal"]')).toBeNull();
    expect(host.querySelector("a")?.getAttribute("href")).toBe("/login?mode=signin&from=%2Fmap");
    expect(host.textContent).toContain("Sign in to talk to your Pal");
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

  it("shows the map's talk button only once the server says the account is not under 18", async () => {
    route.pathname = "/map";
    await render();
    expect(host.querySelector('button[aria-label="Talk to Robin, your Pub Pal"]')).not.toBeNull();

    await act(async () => root.unmount());
    root = createRoot(host);
    eligibility.under18 = true;
    await render();
    expect(host.querySelector(".palSummon")).toBeNull();

    await act(async () => root.unmount());
    root = createRoot(host);
    eligibility.under18 = undefined;
    await render();
    expect(host.querySelector(".palSummon")).toBeNull();
  });
});
