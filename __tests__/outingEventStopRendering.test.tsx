import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/plan/PlanRouteMiniMap", () => ({ default: () => null }));

import PlanRoute from "@/components/plan/PlanRoute";

const URL_SUPPLIED_EVENT = {
  kind: "event" as const,
  id: "gig-42",
  title: "Late set",
  placeName: "Camden Assembly",
  venueId: "venue-camden-assembly",
  source: { label: "Venue programme", url: "https://venue.example/gig-42" },
  startsAt: "2026-09-27T19:30:00.000Z",
  endsAt: "2026-09-27T22:30:00.000Z",
  observedAt: "2026-09-20T10:00:00.000Z",
  admissionGbp: 12,
};

describe("event details supplied through an outing URL", () => {
  it("does not present caller-controlled details as checked, or promise an event route on the map", () => {
    const html = renderToStaticMarkup(
      <PlanRoute
        planId="plan-1"
        startTime="2026-09-27T18:00:00.000Z"
        stops={[
          { venueId: "pub-a", venueName: "Pub A", position: 0 },
          { venueId: "pub-b", venueName: "Pub B", position: 1 },
        ]}
        eventStop={URL_SUPPLIED_EVENT}
        eventPosition={1}
      />,
    );

    expect(html).toContain("Details supplied with this plan; not independently verified.");
    expect(html).toContain("Reported start:");
    expect(html).toContain("Admission stated in shared details: from £12.00");
    expect(html).toContain("Open supplied source link");
    expect(html).not.toContain("Published event");
    expect(html).not.toContain("Source checked");
    expect(html).toContain("See walking route between pub stops");
    expect(html).not.toContain("eventStop=");
  });

  it("places before and after handoffs at opposite ends and labels a server-matched listing", () => {
    const stops = [
      { venueId: "pub-a", venueName: "Pub A", position: 0 },
      { venueId: "pub-b", venueName: "Pub B", position: 1 },
    ];
    const before = renderToStaticMarkup(
      <PlanRoute planId="plan-1" startTime="2026-09-27T18:00:00.000Z" stops={stops} eventStop={URL_SUPPLIED_EVENT} eventSide="before" eventStopVerified />,
    );
    const after = renderToStaticMarkup(
      <PlanRoute planId="plan-1" startTime="2026-09-27T18:00:00.000Z" stops={stops} eventStop={URL_SUPPLIED_EVENT} eventSide="after" eventStopVerified />,
    );

    expect(before.indexOf('data-stop-kind="event"')).toBeLessThan(before.indexOf('data-stop-kind="pub"'));
    expect(after.indexOf('data-stop-kind="event"')).toBeGreaterThan(after.lastIndexOf('data-stop-kind="pub"'));
    expect(after).toContain("Matched to a current PUBMAXX event listing; not a pub stop.");
    expect(after).not.toContain("Details supplied with this plan; not independently verified.");
    expect(after).toContain("Listing states admission: from £12.00");
  });
});
