// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OccupancyNowAnswer } from "@/lib/occupancy";

const READING: OccupancyNowAnswer = {
  now: null,
  ageMinutes: null,
  reportersLast90: 0,
  degraded: false,
  state: "none",
  id: null,
};

const report = vi.hoisted(() => vi.fn());
vi.mock("@/components/map/useVenueOccupancy", () => ({
  useVenueOccupancy: () => ({ reading: READING, report, reporting: false, error: null }),
  trackOccupancyRead: vi.fn(),
  flagVenueOccupancy: vi.fn(),
}));
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: { id: "user-1" },
    session: { user: { id: "user-1" }, access_token: "token" },
  }),
}));
vi.mock("@/components/auth/useViewerSession", () => ({
  useViewerSession: () => ({ phase: "signed-in", signedIn: true, signedOut: false }),
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

import VenueOccupancyRow from "@/components/map/VenueOccupancyRow";

// The busy report's thanks line was read twice by a screen reader: once from
// the live region and once from the visible line that shows the same words.

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  report.mockReset().mockResolvedValue({
    ok: true,
    reading: { ...READING, now: "full", ageMinutes: 0, state: "fresh", id: "report-1" },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("the busy report thanks line", () => {
  it("is announced once: the visible copy is hidden while the live region carries it", async () => {
    await act(async () => {
      root.render(createElement(VenueOccupancyRow, { venueId: "venue-1" }));
    });
    const visible = container.querySelector(".venueOccupancyReading")!;
    const live = container.querySelector('[role="status"]')!;
    expect(visible.getAttribute("aria-hidden")).toBeNull();
    expect(live.textContent).toBe("");

    const full = [...container.querySelectorAll("button")].find((b) => b.textContent === "Full")!;
    await act(async () => {
      full.click();
    });

    expect(live.textContent).toMatch(/^Thanks - Full/);
    expect(visible.textContent).toBe(live.textContent);
    expect(visible.getAttribute("aria-hidden")).toBe("true");
  });
});
