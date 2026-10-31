// @vitest-environment jsdom

// "Still on" under a drinker's regular night (E4), and the kitchen taps on the
// food row (A1): who is offered a button, and the line each answer prints.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const viewer = vi.hoisted(() => ({
  phase: "signed-in" as "signed-in" | "signed-out" | "unresolved",
  handle: "bob" as string | null,
  identityResolved: true,
}));
const fetchMock = vi.hoisted(() => vi.fn<(url: string, init?: RequestInit) => Promise<Response>>());

vi.mock("@/components/auth/useViewerSession", () => ({
  useViewerSession: () => ({
    phase: viewer.phase,
    signedIn: viewer.phase === "signed-in",
    signedOut: viewer.phase === "signed-out",
    unresolved: viewer.phase === "unresolved",
  }),
}));
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ handle: viewer.handle, identityResolved: viewer.identityResolved }),
}));
vi.mock("@/lib/authedFetch", () => ({
  authedActionFetch: (url: string, init?: RequestInit) => fetchMock(url, init),
  publishAuthActionState: () => {},
}));

import VenueKitchenReport from "@/components/map/inspector/VenueKitchenReport";
import RegularNightStillOn from "@/components/tonight/RegularNightStillOn";
import { KITCHEN_REPORTED_LINE } from "@/lib/kitchenReports";
import { REGULAR_NIGHT_STILL_ON_LABEL, REGULAR_NIGHT_STILL_ON_RECEIPT } from "@/lib/regularNightReports";

let container: HTMLDivElement;
let root: Root | null = null;

async function settle(): Promise<void> {
  for (let turn = 0; turn < 4; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const NIGHT = { id: "c0ffee00-0000-4000-8000-000000000001", own: false, handle: "alice" };

async function renderStillOn(night = NIGHT) {
  await act(async () => {
    root?.render(createElement(RegularNightStillOn, { night }));
  });
  await settle();
}

function stillOnButton(): HTMLButtonElement | null {
  return [...container.querySelectorAll("button")].find((b) => b.textContent === REGULAR_NIGHT_STILL_ON_LABEL) ?? null;
}

beforeEach(() => {
  viewer.phase = "signed-in";
  viewer.handle = "bob";
  viewer.identityResolved = true;
  fetchMock.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  container.remove();
  vi.unstubAllGlobals();
});

describe("Still on", () => {
  it("is offered to a signed-in reader who did not report the night", async () => {
    await renderStillOn();
    expect(stillOnButton()).not.toBeNull();
  });

  it("is hidden from the reporter, by the read's own flag or by their handle", async () => {
    await renderStillOn({ ...NIGHT, own: true });
    expect(stillOnButton()).toBeNull();
    viewer.handle = "Alice";
    await renderStillOn({ ...NIGHT, own: false });
    expect(stillOnButton()).toBeNull();
  });

  it("is hidden from a signed-out reader and while the session is unresolved", async () => {
    viewer.phase = "signed-out";
    await renderStillOn();
    expect(stillOnButton()).toBeNull();
    viewer.phase = "unresolved";
    await renderStillOn();
    expect(stillOnButton()).toBeNull();
    viewer.phase = "signed-in";
    viewer.identityResolved = false;
    await renderStillOn();
    expect(stillOnButton()).toBeNull();
  });

  it("thanks the reader on 200", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { extended: true, expiresAt: "2027-01-28T19:00:00.000Z" }));
    await renderStillOn();
    await act(async () => stillOnButton()?.click());
    await settle();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/regular-nights",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ id: NIGHT.id }) }),
    );
    expect(container.textContent).toBe(REGULAR_NIGHT_STILL_ON_RECEIPT);
    expect(REGULAR_NIGHT_STILL_ON_RECEIPT).toBe("Thanks, kept for 90 days");
  });

  it("prints the server's line on 409", async () => {
    fetchMock.mockResolvedValueOnce(
      json(409, { error: "You have already said this one is still on.", code: "ALREADY_STILL_ON" }),
    );
    await renderStillOn();
    await act(async () => stillOnButton()?.click());
    await settle();
    expect(container.textContent).toBe("You have already said this one is still on.");
    expect(stillOnButton()).toBeNull();
  });
});

describe("the kitchen taps on the food row", () => {
  const T = Date.now();
  function stubRead(report: unknown) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(200, { status: "ready", report })),
    );
  }

  async function renderKitchen() {
    await act(async () => {
      root?.render(createElement(VenueKitchenReport, { venueId: "venue-crown" }));
    });
    await settle();
  }

  it("prints the read to a signed-out reader with no buttons", async () => {
    viewer.phase = "signed-out";
    stubRead({
      id: "k1",
      venueId: "venue-crown",
      state: "open",
      reportedAt: new Date(T - 20 * 60_000).toISOString(),
      handle: "alice",
      confirmed: true,
    });
    await renderKitchen();
    expect(container.textContent).toContain("Kitchen open, said @alice 20 min ago, confirmed by one other");
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });

  it("renders nothing to a signed-out reader when there is no fresh word", async () => {
    viewer.phase = "signed-out";
    stubRead(null);
    await renderKitchen();
    expect(container.innerHTML).toBe("");
  });

  it("offers a signed-in reader both words and thanks a report", async () => {
    stubRead(null);
    await renderKitchen();
    const labels = [...container.querySelectorAll("button")].map((b) => b.textContent);
    expect(labels).toEqual(["Still serving", "Kitchen closed"]);
    fetchMock.mockResolvedValueOnce(
      json(200, {
        outcome: "reported",
        report: { id: "k2", venueId: "venue-crown", state: "closed", reportedAt: new Date().toISOString(), handle: "bob", confirmed: false },
      }),
    );
    await act(async () => container.querySelectorAll("button")[1]?.click());
    await settle();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/kitchen-reports",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ venueId: "venue-crown", state: "closed" }) }),
    );
    expect(container.textContent).toContain("Kitchen closed, said @bob just now");
    expect(container.textContent).toContain(KITCHEN_REPORTED_LINE);
  });

  it("prints the server's line on 409", async () => {
    stubRead(null);
    await renderKitchen();
    fetchMock.mockResolvedValueOnce(json(409, { error: "Somebody else has to confirm it.", code: "OWN_KITCHEN_REPORT" }));
    await act(async () => container.querySelectorAll("button")[0]?.click());
    await settle();
    expect(container.textContent).toContain("Somebody else has to confirm it.");
  });
});
