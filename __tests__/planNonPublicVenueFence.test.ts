import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// A STRANGER IS NEVER SENT TO A MEMBERS-ONLY DOOR (launch plan P0 #1). Every
// door that builds a night other people may walk (plan generation and its swap
// options, and "Host this on a date"; Pal's draft crawl is in
// palProposePlanNonPublicVenue.test.ts) leaves out a bar whose
// name says the public cannot use it. The launch scout saw "The Three Tuns -
// LSE Student Union" (venue-p7p18j, Aldwych) as a Soho stop. The generator
// runs for real, keyless, on the shipped venue record.

const { isLimitedMock } = vi.hoisted(() => ({ isLimitedMock: vi.fn(async () => false) }));

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/public/data/weather/latest.json", () => ({
  default: { version: 1, generatedAt: "2026-01-01T00:00:00.000Z", observations: [] },
}));
vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return { ...actual, isLimited: isLimitedMock };
});
vi.mock("@/lib/walkRouteProvider", () => ({
  fetchWalkLegRoute: vi.fn(async () => null),
  orsApiKey: () => null,
}));
vi.mock("@/lib/walkRouteStore", () => ({
  walkRouteStore: () => ({ getLeg: async () => null, putLeg: async () => undefined }),
}));

import { POST } from "@/app/api/plans/generate/route";
import { planStopsFromStory } from "@/lib/openCrawl";

const THREE_TUNS = { venueId: "venue-p7p18j", venueName: "The Three Tuns - LSE Student Union" };
// The words that name a door for members, students or staff
// (lib/venueKindFilters.ts holds the full rule; these are the shapes in the
// shipped London record).
const MEMBERS_ONLY = /student|\bSU\b|members|social club|working men|british legion|\bmess\b/i;

type Named = { venueId?: string; venueName?: string; name?: string; title?: string };

function names(rows: readonly Named[] | undefined): string[] {
  return (rows ?? []).map((row) => row.venueName ?? row.name ?? row.title ?? "");
}

describe("plan generation", () => {
  it("never puts a members-only bar in a Soho plan, its swap options or its extra stops", async () => {
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({ query: "Cheap pints in Soho Thursday 7pm for 8 people" }),
    }));
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.stops).toHaveLength(3);

    const stops = body.stops as (Named & { alternatives?: Named[] })[];
    const extensions = (body.endingRecommendations?.extensions ?? []) as Named[];
    const everyVenue = [...stops, ...stops.flatMap((stop) => stop.alternatives ?? []), ...extensions];
    expect(everyVenue.map((venue) => venue.venueId)).not.toContain(THREE_TUNS.venueId);
    expect(names(everyVenue).filter((name) => MEMBERS_ONLY.test(name))).toEqual([]);
  });
});

describe("Host this on a date", () => {
  it("leaves a members-only stop out of the hosted plan and keeps the rest in order", () => {
    expect(planStopsFromStory([
      { venueId: "venue-a", venueName: "The Lamb" },
      THREE_TUNS,
      { venueId: "venue-b", venueName: "Fulham Constitutional Club" },
      { venueId: "venue-c", venueName: "The Harp" },
    ])).toEqual([
      { venueId: "venue-a", venueName: "The Lamb" },
      { venueId: "venue-c", venueName: "The Harp" },
    ]);
  });
});
