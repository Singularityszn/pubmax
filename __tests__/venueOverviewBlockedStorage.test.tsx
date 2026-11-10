// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ user: null as { id: string } | null }));
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ user: auth.user, identityResolved: true }),
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/authedFetch", () => ({
  authedActionFetch: async () => new Response(JSON.stringify({
    status: "ready", mission: { venueId: "venue-a", reason: "stale" },
  })),
}));

import { usePriceEvidenceMission } from "@/components/nearme/usePriceEvidenceMission";
import NextBadgeChips from "@/components/profile/NextBadgeChips";
import { bindDeviceAccountOwner, clearDeviceAccountSessionArtifacts, DEVICE_ACCOUNT_OWNER_KEY, releaseDeviceAccountOwner } from "@/lib/deviceAccountIdentity";
import { dismissPriceEvidenceMission, PRICE_EVIDENCE_MISSION_DISMISS_KEY } from "@/lib/priceEvidenceMissionDismiss";
import type { PriceEvidenceMission } from "@/lib/priceEvidenceMissions";

// The venue overview mounts the price evidence mission and the next-badge
// chips. With site data blocked both storage getters on `window` throw
// SecurityError, which must cost the viewer a saved skip or a handle, not the
// /map route.

let container: HTMLDivElement;
let root: Root;

function blockSiteData() {
  const refuse = () => {
    throw new DOMException("site data is blocked", "SecurityError");
  };
  vi.spyOn(window, "localStorage", "get").mockImplementation(refuse);
  vi.spyOn(window, "sessionStorage", "get").mockImplementation(refuse);
}

beforeEach(() => {
  auth.user = null;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  blockSiteData();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("venue overview when the browser refuses site data", () => {
  it("mounts the price evidence mission and still lets a mission be skipped", () => {
    let api: ReturnType<typeof usePriceEvidenceMission> | null = null;
    function Host() {
      api = usePriceEvidenceMission({
        venueIds: ["venue-a"],
        enabled: false,
        surface: "map",
      });
      return createElement("p", null, api.status);
    }

    act(() => root.render(createElement(Host)));
    expect(container.textContent).toBe("idle");

    const mission = { venueId: "venue-a", reason: "stale" } as PriceEvidenceMission;
    expect(() => act(() => api!.dismiss(mission))).not.toThrow();
    expect(() => act(() => api!.complete(mission))).not.toThrow();
  });

  it("renders no badge chips instead of rejecting on the handle read", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await act(async () => {
      root.render(createElement(NextBadgeChips));
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(container.innerHTML).toBe("");
  });
});


it.each(["owner-change", "tab-departure", "sign-out"])(
  "refreshes every mounted mission reader after %s and rejects departed actions",
  async (transition) => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    auth.user = { id: "account-a" };
    localStorage.setItem(DEVICE_ACCOUNT_OWNER_KEY, "account-a");
    const mission: PriceEvidenceMission = { venueId: "venue-a", reason: "stale" };
    dismissPriceEvidenceMission(mission, sessionStorage);
    let readers: ReturnType<typeof usePriceEvidenceMission>[] = [];
    function Host() {
      readers = [
        usePriceEvidenceMission({ venueIds: ["venue-a"], enabled: true, surface: "map" }),
        usePriceEvidenceMission({ venueIds: ["venue-a"], enabled: true, surface: "map" }),
      ];
      return null;
    }
    await act(async () => { root.render(createElement(Host)); });
    expect(readers.map((read) => read.mission)).toEqual([null, null]);
    const departed = readers[0]!;
    await act(async () => {
      if (transition === "owner-change") {
        auth.user = { id: "account-b" };
        bindDeviceAccountOwner("account-b", localStorage, sessionStorage);
      } else if (transition === "tab-departure") {
        clearDeviceAccountSessionArtifacts(sessionStorage);
      } else {
        releaseDeviceAccountOwner(localStorage, sessionStorage);
      }
      departed.dismiss(mission);
      departed.complete(mission);
    });
    expect(sessionStorage.getItem(PRICE_EVIDENCE_MISSION_DISMISS_KEY)).toBeNull();
    expect(readers.map((read) => read.mission)).toEqual([mission, mission]);
    await act(async () => { readers[0]!.dismiss(mission); });
    expect(readers[0]!.mission).toBeNull();
    expect(sessionStorage.getItem(PRICE_EVIDENCE_MISSION_DISMISS_KEY)).not.toBeNull();
  },
);
