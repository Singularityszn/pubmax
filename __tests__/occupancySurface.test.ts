import { readFileSync } from "node:fs";
import path from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import VenueOccupancyRow from "@/components/map/VenueOccupancyRow";

const authState = vi.hoisted(() => ({
  user: null as { id: string } | null,
  session: null as { access_token: string; user: { id: string } } | null,
  identityResolved: true,
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
    reading: {
      now: null,
      ageMinutes: null,
      reportsLast90: 0,
      degraded: false,
      state: "none",
    },
    report: async () => ({ ok: false, error: "unused" }),
    reporting: false,
    error: null,
    reload: async () => undefined,
  }),
  confirmOccupancyProposal: async () => ({ ok: false, error: "unused" }),
}));

function source(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), "utf8");
}

describe("occupancy venue surface", () => {
  it("asks one question and offers the three now buttons", () => {
    authState.user = { id: "user-a" };
    authState.session = {
      access_token: "token",
      user: { id: "user-a" },
    };

    const html = renderToStaticMarkup(
      createElement(VenueOccupancyRow, { venueId: "venue-1" }),
    );

    expect(html).toContain("How busy is it right now?");
    expect(html).toContain("Empty");
    expect(html).toContain("Some seats");
    expect(html).toContain("Full");
    expect(html).toContain("No fresh reading");
    expect(html).not.toContain("quiet");
    expect(html).not.toContain("rammed");
  });

  it("asks a signed-out visitor to sign in and still shows the reading", () => {
    authState.user = null;
    authState.session = null;

    const html = renderToStaticMarkup(
      createElement(VenueOccupancyRow, { venueId: "venue-1" }),
    );

    expect(html).toContain("How busy is it right now?");
    expect(html).toContain("No fresh reading");
    expect(html).toContain("Sign in to report");
    expect(html).not.toContain(">Empty<");
  });

  it("mounts one row on the venue overview and keeps 44px taps", () => {
    const overview = source("components/map/inspector/VenueOverviewTab.tsx");
    const css = source("components/map/venueOccupancy.css");
    const pal = source("components/pal/PalChat.tsx");
    const client = source("lib/conciergeAskClient.ts");

    expect(overview).toContain("VenueOccupancyRow");
    expect(overview).toContain('active={tab === "overview"}');
    expect(css).toContain("min-height: 44px");
    expect(css).toContain("font-size: 16px");
    expect(pal).toContain("confirmOccupancyProposal");
    expect(pal).toContain('kind === "report_occupancy"');
    expect(client).toContain('record.kind === "report_occupancy"');
  });
});
