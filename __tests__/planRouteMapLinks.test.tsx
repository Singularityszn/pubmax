// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/plan/PlanRouteMiniMap", () => ({ default: () => null }));
import PlanRoute from "@/components/plan/PlanRoute";

describe("saved route map destinations", () => {
  it("keeps every saved stop when opening one pub on the map", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(<PlanRoute
      planId="00000000-0000-4000-8000-000000000085"
      startTime="2026-10-26T18:00:00Z"
      stops={[
        { venueId: "venue-a", venueName: "First pub", position: 0 },
        { venueId: "venue-b", venueName: "Second pub", position: 1 },
        { venueId: "venue-c", venueName: "Third pub", position: 2 },
      ]}
    />);
    const links = Array.from(container.querySelectorAll("ol a"));
    expect(links).toHaveLength(3);
    for (const [index, link] of links.entries()) {
      const target = new URL(link.getAttribute("href")!, "http://localhost");
      expect(target.pathname).toBe("/map");
      expect(target.searchParams.get("pubs")).toBe("venue-a,venue-b,venue-c");
      expect(target.searchParams.get("sel")).toBe(["venue-a", "venue-b", "venue-c"][index]);
    }
  });
});
