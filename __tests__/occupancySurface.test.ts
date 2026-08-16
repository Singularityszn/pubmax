import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import VenueOccupancyRow from "@/components/map/VenueOccupancyRow";
import type { OccupancyNowAnswer } from "@/lib/occupancy";

const authState = vi.hoisted(() => ({
  user: null as { id: string } | null,
  session: null as { access_token: string; user: { id: string } } | null,
  identityResolved: true,
}));

const occupancyState = vi.hoisted(() => ({
  reading: {
    now: null,
    ageMinutes: null,
    reportsLast90: 0,
    degraded: false,
    state: "none",
  } as OccupancyNowAnswer | null,
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: authState.user,
    session: authState.session,
    identityResolved: authState.identityResolved,
  }),
}));

vi.mock("@/components/map/useVenueOccupancy", () => ({
  useVenueOccupancy: () => ({
    reading: occupancyState.reading,
    report: async () => ({ ok: false, error: "unused" }),
    reporting: false,
    error: null,
    reload: async () => undefined,
  }),
  confirmOccupancyProposal: async () => ({ ok: false, error: "unused" }),
}));

function signedIn(): void {
  authState.user = { id: "user-a" };
  authState.session = { access_token: "token", user: { id: "user-a" } };
}

function render(): string {
  return renderToStaticMarkup(
    createElement(VenueOccupancyRow, { venueId: "venue-1" }),
  );
}

beforeEach(() => {
  authState.user = null;
  authState.session = null;
  authState.identityResolved = true;
  occupancyState.reading = {
    now: null,
    ageMinutes: null,
    reportsLast90: 0,
    degraded: false,
    state: "none",
  };
});

describe("occupancy venue surface", () => {
  it("asks one question and offers the three now buttons", () => {
    signedIn();

    const html = render();

    expect(html).toContain("How busy is it right now?");
    expect(html).toContain("Empty");
    expect(html).toContain("Some seats");
    expect(html).toContain("Full");
    expect(html).toContain("No fresh reading");
    expect(html).not.toContain("quiet");
    expect(html).not.toContain("rammed");
  });

  it("asks a signed-out visitor to sign in and still shows the reading", () => {
    const html = render();

    expect(html).toContain("How busy is it right now?");
    expect(html).toContain("No fresh reading");
    expect(html).toContain("Sign in to report");
    expect(html).not.toContain(">Empty<");
  });

  it("prints a fresh reading with its age, and greys an empty one", () => {
    signedIn();
    occupancyState.reading = {
      now: "some-seats",
      ageMinutes: 12,
      reportsLast90: 1,
      degraded: false,
      state: "fresh",
    };

    const dated = render();
    expect(dated).toContain("Some seats · 12 min ago");
    expect(dated).not.toContain("venueOccupancyReading--empty");

    occupancyState.reading = {
      now: null,
      ageMinutes: null,
      reportsLast90: 0,
      degraded: false,
      state: "stale",
    };

    const aged = render();
    expect(aged).toContain("No fresh reading");
    expect(aged).toContain("venueOccupancyReading--empty");
  });

  it("says a failed read could not be checked, never that nobody reported", () => {
    signedIn();
    occupancyState.reading = {
      now: null,
      ageMinutes: null,
      reportsLast90: 0,
      degraded: true,
      state: "degraded",
    };

    const html = render();
    expect(html).toContain("Could not check how busy it is.");
    expect(html).not.toContain("No fresh reading");
  });

  it("names nobody and offers no door until identity resolves", () => {
    authState.identityResolved = false;

    const html = render();
    expect(html).toContain("How busy is it right now?");
    expect(html).not.toContain("Sign in to report");
    expect(html).not.toContain(">Empty<");
  });
});
