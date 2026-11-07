import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

import { POST } from "@/app/api/plans/route";
import { loadConciergeVenues } from "@/lib/concierge/venues.server";
import { hostOnDatePlanBody } from "@/lib/openCrawl";
import { __resetPintDrops } from "@/lib/pintDrops";
import { canonicalPlanRoute, planStopResolver } from "@/lib/planRoute";
import { __resetMemoryPlans } from "@/lib/planStore";

const DISGUISED_MEMBERS_VENUE = { venueId: "venue-p7p18j", venueName: "The Three Tuns" };
const PUBLIC_STOPS = [
  { venueId: "venue-xjf3n0", venueName: "Arnos Arms" },
  { venueId: "venue-16pnwmm", venueName: "Prospect of Whitby" },
];

beforeEach(() => {
  __resetMemoryPlans();
  __resetPintDrops();
});

function createHostedPlan(stops: typeof PUBLIC_STOPS) {
  return POST(new Request("http://localhost/api/plans", {
    method: "POST",
    headers: { "idempotency-key": `public-stops-${crypto.randomUUID()}` },
    body: JSON.stringify(hostOnDatePlanBody({
      title: "A hosted night",
      creatorName: "Karan",
      startIso: "2026-11-19T19:00:00.000Z",
      stops,
    })),
  }));
}

describe("launch P0: strangers only visit public venues", () => {
  it("refuses a hosted story whose public-looking label hides a members-only venue ID", async () => {
    const venues = await loadConciergeVenues("london");
    expect(venues.find((venue) => venue.id === DISGUISED_MEMBERS_VENUE.venueId)).toMatchObject({
      name: "The Three Tuns - LSE Student Union",
    });

    const response = await createHostedPlan([...PUBLIC_STOPS, DISGUISED_MEMBERS_VENUE]);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Choose listed venues.",
      code: "PLAN_VENUES_INVALID",
      retryable: false,
    });
  });

  it.each([undefined, "london"] as const)("refuses raw and object IDs with city scope %s", async (cityId) => {
    const resolve = await planStopResolver(cityId);
    expect(resolve(DISGUISED_MEMBERS_VENUE.venueId)).toBeNull();
    expect(resolve(DISGUISED_MEMBERS_VENUE)).toBeNull();
    expect(resolve(PUBLIC_STOPS[0])).toEqual(PUBLIC_STOPS[0]);
  });

  it.each([0, 1, 2])("refuses a replacement with a disguised members-only stop at position %s", async (position) => {
    const stops = [...PUBLIC_STOPS];
    stops.splice(position, 0, DISGUISED_MEMBERS_VENUE);
    await expect(canonicalPlanRoute(stops)).resolves.toBeNull();
    await expect(canonicalPlanRoute(stops.map((stop) => stop.venueId))).resolves.toBeNull();
  });

  it("creates and replaces a public route with canonical names and the submitted order", async () => {
    const submitted = PUBLIC_STOPS.map((stop) => ({ ...stop, venueName: "Client-supplied label" }));
    const response = await createHostedPlan(submitted);
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ plan: { stops: PUBLIC_STOPS } });
    await expect(canonicalPlanRoute(submitted)).resolves.toEqual(
      PUBLIC_STOPS.map((stop, position) => ({ ...stop, position })),
    );
  });
});
