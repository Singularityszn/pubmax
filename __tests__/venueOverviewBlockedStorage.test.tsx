// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ user: null, identityResolved: true }),
}));

import { usePriceEvidenceMission } from "@/components/nearme/usePriceEvidenceMission";
import NextBadgeChips from "@/components/profile/NextBadgeChips";
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
