// Open crawls (launch review 4.5, E1 and E2): the rules in lib/openCrawl.ts,
// the "Open it up" route, and the store's two new calls.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  OPEN_CRAWL_CAPACITY_LINE,
  OPEN_CRAWL_CAPACITY_MAX,
  OPEN_CRAWL_CAPACITY_MIN,
  OPEN_CRAWL_DESCRIPTION_CONTACT_LINE,
  OPEN_CRAWL_DESCRIPTION_LONG_LINE,
  OPEN_CRAWL_DESCRIPTION_WORD_LINE,
  OPEN_CRAWL_MEETING_LINE,
  checkOpenCrawlDescription,
  defaultMeetingVenueId,
  hostOnDateBounds,
  hostOnDatePlanBody,
  hostOnDateStartIso,
  joinableThisWeek,
  openCrawlJoinWindow,
  openCrawlPlacesLeft,
  parseOpenCrawlListing,
  parseStillTrueField,
  planStopsFromStory,
  STILL_TRUE_EMPTY_LINE,
  stillTrueHeadcountLines,
  stillTrueListedLine,
  stillTrueVenueId,
  stillTrueListedPint,
  stillTrueSaidYesCount,
  validateOpenCrawlInput,
  type OpenCrawlListing,
} from "@/lib/openCrawl";
import { CREW_MAX_MEMBERS } from "@/lib/crew";
import { PLAN_STOP_MAX, type PlanState } from "@/lib/plan";
import type { SocialPostActor } from "@/lib/socialPostStore";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-10-30T12:00:00.000Z");

const STOPS = [
  { venueId: "venue-b", venueName: "The Second", position: 1 },
  { venueId: "venue-a", venueName: "The First", position: 0 },
  { venueId: "venue-c", venueName: "The Third", position: 2 },
];

describe("Open it up: the host's three answers", () => {
  it("uses the existing crew cap and refuses a capacity outside 4 to 20", () => {
    expect(OPEN_CRAWL_CAPACITY_MIN).toBe(4);
    expect(OPEN_CRAWL_CAPACITY_MAX).toBe(CREW_MAX_MEMBERS);
    for (const capacity of [3, 21, 0, 4.5, "8", null]) {
      const result = validateOpenCrawlInput(
        { capacity, meetingVenueId: "venue-a", description: "Old boozers round Holborn." },
        STOPS,
      );
      expect(result).toEqual({ ok: false, field: "capacity", line: OPEN_CRAWL_CAPACITY_LINE });
    }
    for (const capacity of [4, 12, 20]) {
      expect(
        validateOpenCrawlInput({ capacity, meetingVenueId: "venue-a", description: "A quiet one." }, STOPS).ok,
      ).toBe(true);
    }
  });

  it("only meets at one of the plan's own stops, and offers Stop 1 first", () => {
    expect(defaultMeetingVenueId(STOPS)).toBe("venue-a");
    expect(
      validateOpenCrawlInput({ capacity: 8, meetingVenueId: "venue-elsewhere", description: "A quiet one." }, STOPS),
    ).toEqual({ ok: false, field: "meetingVenueId", line: OPEN_CRAWL_MEETING_LINE });
    expect(
      validateOpenCrawlInput({ capacity: 8, meetingVenueId: "venue-c", description: "A quiet one." }, STOPS),
    ).toEqual({ ok: true, value: { capacity: 8, meetingVenueId: "venue-c", description: "A quiet one." } });
  });

  it("keeps the line to one clean line of 140 characters", () => {
    expect(checkOpenCrawlDescription("  Old   boozers\n round Holborn  ")).toEqual({
      ok: true,
      text: "Old boozers round Holborn",
    });
    expect(checkOpenCrawlDescription("x".repeat(140)).ok).toBe(true);
    expect(checkOpenCrawlDescription("x".repeat(141))).toEqual({ ok: false, line: OPEN_CRAWL_DESCRIPTION_LONG_LINE });
    expect(checkOpenCrawlDescription("   ").ok).toBe(false);
  });

  it("refuses a way to be reached off the app", () => {
    for (const text of [
      "Details at https://example.com",
      "see www.mynight.co",
      "join via mynight.co.uk",
      "email me at host@example.com",
      "text 07700 900123",
      "ask @someone first",
    ]) {
      expect(checkOpenCrawlDescription(text), text).toEqual({ ok: false, line: OPEN_CRAWL_DESCRIPTION_CONTACT_LINE });
    }
  });

  it("refuses the words that sell quantity, as whole words only", () => {
    for (const text of ["Proper carnage", "Big sesh", "A long session in Soho", "Bottomless brunch then pubs"]) {
      expect(checkOpenCrawlDescription(text), text).toEqual({ ok: false, line: OPEN_CRAWL_DESCRIPTION_WORD_LINE });
    }
    expect(checkOpenCrawlDescription("Sessions of quiz at the Lamb").ok).toBe(true);
  });
});

function listing(overrides: Partial<OpenCrawlListing> = {}): OpenCrawlListing {
  return {
    crewId: "50000000-0000-4000-8000-000000000001",
    title: "Holborn heritage",
    startTime: new Date(NOW + 2 * DAY).toISOString(),
    hostHandle: "alice",
    memberCount: 3,
    capacity: 8,
    meetingVenueId: "venue-a",
    meetingVenueName: "The First",
    description: "Old boozers round Holborn.",
    ...overrides,
  };
}

describe("Crawls you can join this week", () => {
  it("lists a start inside the next seven days only", () => {
    const rows = [
      listing({ crewId: "50000000-0000-4000-8000-000000000002", startTime: new Date(NOW - 60_000).toISOString() }),
      listing({ crewId: "50000000-0000-4000-8000-000000000003", startTime: new Date(NOW + 7 * DAY).toISOString() }),
      listing({ crewId: "50000000-0000-4000-8000-000000000004", startTime: new Date(NOW + 7 * DAY - 60_000).toISOString() }),
      listing({ crewId: "50000000-0000-4000-8000-000000000005", startTime: new Date(NOW + DAY).toISOString() }),
    ];
    expect(joinableThisWeek(rows, NOW).map((row) => row.crewId)).toEqual([
      "50000000-0000-4000-8000-000000000005",
      "50000000-0000-4000-8000-000000000004",
    ]);
    const window = openCrawlJoinWindow(NOW);
    expect(Date.parse(window.until) - Date.parse(window.from)).toBe(7 * DAY);
  });

  it("counts places left and drops a full crawl", () => {
    expect(openCrawlPlacesLeft({ capacity: 8, memberCount: 3 })).toBe(5);
    expect(openCrawlPlacesLeft({ capacity: 4, memberCount: 6 })).toBe(0);
    const full = listing({ crewId: "50000000-0000-4000-8000-000000000006", memberCount: 8 });
    const room = listing({ crewId: "50000000-0000-4000-8000-000000000007", memberCount: 7 });
    expect(joinableThisWeek([full, room], NOW).map((row) => row.crewId)).toEqual([room.crewId]);
  });

  it("parses a row strictly", () => {
    expect(parseOpenCrawlListing(listing())).toEqual(listing());
    expect(parseOpenCrawlListing({ ...listing(), capacity: 30 })).toBeNull();
    expect(parseOpenCrawlListing({ ...listing(), crewId: "nope" })).toBeNull();
    expect(parseOpenCrawlListing({ ...listing(), description: "" })).toBeNull();
  });
});

describe("Host this on a date: a plan from a story", () => {
  it("keeps the story's stop order, drops unplannable stops and caps the plan", () => {
    const stops = [
      { venueId: "venue-3", venueName: "Third" },
      { venueId: "", venueName: "Hand-written stop" },
      { venueId: "venue-1", venueName: "First" },
      { venueId: "venue-3", venueName: "Third again" },
      { venueId: "venue-2", venueName: "Second" },
    ];
    expect(planStopsFromStory(stops)).toEqual([
      { venueId: "venue-3", venueName: "Third" },
      { venueId: "venue-1", venueName: "First" },
      { venueId: "venue-2", venueName: "Second" },
    ]);
    const many = Array.from({ length: 12 }, (_, index) => ({ venueId: `venue-${index}`, venueName: `Pub ${index}` }));
    expect(planStopsFromStory(many)).toHaveLength(PLAN_STOP_MAX);
    expect(planStopsFromStory(many)[0]?.venueId).toBe("venue-0");
  });

  it("builds the planner's own create body", () => {
    const startIso = new Date(NOW + DAY).toISOString();
    expect(
      hostOnDatePlanBody({
        title: "  The   Holborn heritage  ",
        creatorName: "alice",
        startIso,
        stops: [{ venueId: "venue-2", venueName: "Second" }, { venueId: "venue-1", venueName: "First" }],
      }),
    ).toEqual({
      title: "The Holborn heritage",
      startTime: startIso,
      creatorName: "alice",
      stops: [{ venueId: "venue-2", venueName: "Second" }, { venueId: "venue-1", venueName: "First" }],
    });
    expect(hostOnDatePlanBody({ title: "x", creatorName: "", startIso, stops: [{ venueId: "v", venueName: "V" }] })).toBeNull();
    expect(hostOnDatePlanBody({ title: "x", creatorName: "alice", startIso, stops: [] })).toBeNull();
  });

  it("offers today to 60 days ahead, in London time, and never a time already gone", () => {
    expect(hostOnDateBounds(NOW)).toEqual({ min: "2026-10-30", max: "2026-12-29" });
    expect(hostOnDateStartIso("2026-10-30", "19:00", NOW)).toBe("2026-10-30T19:00:00.000Z");
    expect(hostOnDateStartIso("2026-10-30", "09:00", NOW)).toBeNull();
    expect(hostOnDateStartIso("2026-12-30", "19:00", NOW)).toBeNull();
    expect(hostOnDateStartIso("2026-10-29", "19:00", NOW)).toBeNull();
    expect(hostOnDateStartIso("not-a-date", "19:00", NOW)).toBeNull();
  });
});

// --- The "Open it up" route --------------------------------------------------

const ACTOR: SocialPostActor = {
  accountId: "10000000-0000-4000-8000-000000000001",
  profileId: "20000000-0000-4000-8000-000000000001",
  handle: "alice",
};
const PLAN_ID = "60000000-0000-4000-8000-000000000001";
const CREW_ID = "50000000-0000-4000-8000-000000000001";

const routeState = vi.hoisted(() => ({
  access: null as unknown,
  plan: null as PlanState | null,
  role: "host" as "host" | "guest" | null,
}));
const routeStore = vi.hoisted(() => ({ openWithPlan: vi.fn(), listOpenCrawls: vi.fn() }));

vi.mock("@/lib/socialAccessServer", () => ({
  requireVerifiedSocialActor: vi.fn(async () => routeState.access),
}));
vi.mock("@/lib/socialCrewStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/socialCrewStore")>()),
  createSocialCrewStore: () => routeStore,
}));
vi.mock("@/lib/pintDrops", () => ({ isLimited: vi.fn(async () => false) }));
vi.mock("@/lib/supabase", () => ({
  hashActor: (value: string) => `hashed-${value}`,
  hashIp: (value: string) => `ip-${value}`,
  clientIp: () => "127.0.0.1",
}));
vi.mock("@/lib/planStore", () => ({
  hashPlanMemberToken: (token: string) => `hash-${token}`,
  planStateResult: vi.fn(async () => ({ ok: true, plan: routeState.plan })),
  planMemberIdentityResult: vi.fn(async (_id: string, token: string) => ({
    ok: true,
    identity: token === "host-seat" && routeState.role
      ? { memberId: "m1", role: routeState.role, collaborationAuthorized: true }
      : null,
  })),
}));
vi.mock("@/lib/venueIndex", () => ({
  lookupCanonicalVenue: vi.fn(async (id: string) => ({
    status: "found",
    canonicalId: id,
    venue: { id, name: "The First", lat: 51.5, lng: -0.1 },
  })),
}));
vi.mock("@/lib/cultureCrawl.server", () => ({ cultureWaypointPois: () => [] }));

const { POST: openCrew } = await import("@/app/api/plans/[id]/open-crew/route");

function openRequest(body: Record<string, unknown>, key = "open-crawl-key-0001"): Request {
  return new Request(`http://localhost/api/plans/${PLAN_ID}/open-crew`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify(body),
  });
}
const ctx = { params: Promise.resolve({ id: PLAN_ID }) };
const GOOD = { memberToken: "host-seat", capacity: 8, meetingVenueId: "venue-a", description: "Old boozers round Holborn." };

describe("POST /api/plans/[id]/open-crew", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeState.access = { ok: true, actor: ACTOR };
    routeState.role = "host";
    routeState.plan = {
      plan: { id: PLAN_ID, title: "Holborn", startTime: new Date(NOW + DAY).toISOString(), createdAt: "2026-10-30T10:00:00.000Z", status: "ready" },
      stops: STOPS,
      crew: [],
      context: null,
      actions: [],
      ending: null,
    } as PlanState;
    routeStore.openWithPlan.mockResolvedValue({ code: "created", replayed: false, crewId: CREW_ID, memberId: "70000000-0000-4000-8000-000000000001" });
  });

  it("opens the host's plan with the three facts and the host seat", async () => {
    const response = await openCrew(openRequest(GOOD), ctx);
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ crewId: CREW_ID });
    expect(routeStore.openWithPlan).toHaveBeenCalledWith(ACTOR, {
      planId: PLAN_ID,
      hostCapability: "host-seat",
      capacity: 8,
      meetingVenueId: "venue-a",
      description: "Old boozers round Holborn.",
      idempotencyKey: "open-crawl-key-0001",
    });
  });

  it("is the host's alone: a guest seat, no seat and a stranger's seat all answer 404 and write nothing", async () => {
    routeState.role = "guest";
    expect((await openCrew(openRequest(GOOD), ctx)).status).toBe(404);
    routeState.role = "host";
    const { memberToken: _unused, ...noSeat } = GOOD;
    void _unused;
    expect((await openCrew(openRequest(noSeat), ctx)).status).toBe(404);
    expect((await openCrew(openRequest({ ...GOOD, memberToken: "someone-else" }), ctx)).status).toBe(404);
    expect(routeStore.openWithPlan).not.toHaveBeenCalled();
  });

  it("needs the signed-in Social actor as well as the seat", async () => {
    routeState.access = { ok: false, error: "Sign in.", code: "SOCIAL_SIGN_IN_REQUIRED", status: 401 };
    expect((await openCrew(openRequest(GOOD), ctx)).status).toBe(401);
    expect(routeStore.openWithPlan).not.toHaveBeenCalled();
  });

  it("refuses a capacity out of bounds, a meeting pub off the plan and a line that fails the check", async () => {
    for (const [patch, field] of [
      [{ capacity: 21 }, "capacity"],
      [{ capacity: 3 }, "capacity"],
      [{ meetingVenueId: "venue-elsewhere" }, "meetingVenueId"],
      [{ description: "Proper carnage" }, "description"],
      [{ description: "x".repeat(141) }, "description"],
    ] as const) {
      const response = await openCrew(openRequest({ ...GOOD, ...patch }), ctx);
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ code: "OPEN_CRAWL_INVALID", details: { field } });
    }
    expect(routeStore.openWithPlan).not.toHaveBeenCalled();
  });

  it("refuses an unknown body key and a missing idempotency key", async () => {
    expect((await openCrew(openRequest({ ...GOOD, visibility: "open" }), ctx)).status).toBe(422);
    const noKey = new Request(`http://localhost/api/plans/${PLAN_ID}/open-crew`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(GOOD),
    });
    expect((await openCrew(noKey, ctx)).status).toBe(422);
  });

  it("answers a plan already held by a crew as not found", async () => {
    routeState.plan = null;
    expect((await openCrew(openRequest(GOOD), ctx)).status).toBe(404);
  });
});

// --- The store's two new calls ----------------------------------------------

describe("SocialCrewStore open crawls", () => {
  it("writes through the one atomic RPC with a hashed seat, and reads the list strictly", async () => {
    const { createSocialCrewStore } = await vi.importActual<typeof import("@/lib/socialCrewStore")>("@/lib/socialCrewStore");
    const rpc = vi.fn(async () => ({ ok: true, code: "created", crew_id: CREW_ID, member_id: "70000000-0000-4000-8000-000000000001" }));
    const snapshot = vi.fn(async () => [listing()]);
    const store = createSocialCrewStore({ rpc, snapshot, signingKey: () => Buffer.alloc(32) });
    const result = await store.openWithPlan(ACTOR, {
      planId: PLAN_ID,
      hostCapability: "host-seat",
      capacity: 8,
      meetingVenueId: "venue-a",
      description: "Old boozers.",
      idempotencyKey: "open-crawl-key-0001",
    });
    expect(result).toMatchObject({ code: "created", crewId: CREW_ID });
    const [name, input] = rpc.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(name).toBe("open_social_crew_with_plan_atomic");
    expect(input).toMatchObject({ p_actor_account_id: ACTOR.accountId, p_plan_id: PLAN_ID, p_capacity: 8, p_meeting_venue_id: "venue-a" });
    expect(input.p_host_token_hash).not.toBe("host-seat");

    const rows = await store.listOpenCrawls({ from: "a", until: "b" });
    expect(rows).toEqual([listing()]);
    expect(snapshot).toHaveBeenCalledWith("list_open_plan_crawls", { p_from: "a", p_until: "b", p_limit: 20 });

    snapshot.mockResolvedValueOnce([{ ...listing(), capacity: 99 }]);
    await expect(store.listOpenCrawls({ from: "a", until: "b" })).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });
});

describe("a one-pub night", () => {
  it("counts each person who joined or was accepted once", () => {
    expect(stillTrueVenueId(["venue-a"])).toBe("venue-a");
    expect(stillTrueVenueId(["venue-a", "venue-b"])).toBeNull();
    expect(stillTrueVenueId(null)).toBeNull();
    expect(stillTrueVenueId([" "])).toBeNull();
    expect(stillTrueSaidYesCount(["a", "b"], ["b", "c"])).toBe(3);
    expect(stillTrueSaidYesCount(["", "  "], [])).toBe(0);
  });

  it("prints a row only when that row was read, and never a zero crowd", () => {
    expect(stillTrueHeadcountLines({ saidYes: 0, markedHere: 0 })).toEqual([STILL_TRUE_EMPTY_LINE]);
    expect(stillTrueHeadcountLines({ saidYes: 2, markedHere: 1 })).toEqual([
      "2 said yes.",
      "1 marked here.",
    ]);
    expect(stillTrueHeadcountLines({ saidYes: 1, markedHere: null })).toEqual(["1 said yes."]);
    expect(stillTrueHeadcountLines({ saidYes: null, markedHere: 3 })).toEqual(["3 marked here."]);
    expect(stillTrueHeadcountLines({ saidYes: null, markedHere: 0 })).toEqual([]);
    expect(stillTrueHeadcountLines({ saidYes: 0, markedHere: 0 }).join(" ")).not.toMatch(/0 said yes|0 marked here/);
  });

  it("prints a price only when the drink, the figure, the source and the read day are all present", () => {
    const pint = stillTrueListedPint({
      priceGbp: 6.2,
      pintName: "Lager",
      publisher: { label: "pint-prices.com" },
      observedOn: "2026-08-20",
    });
    expect(stillTrueListedLine(pint)).toBe(
      "Lager listed £6.20. pint-prices.com, read 20 August 2026.",
    );
    expect(stillTrueListedPint({
      priceGbp: 6.2,
      pintName: "Lager",
      publisher: null,
      observedOn: "2026-08-20",
    })).toBeNull();
    expect(stillTrueListedLine(null)).toBeNull();
    expect(parseStillTrueField({ saidYes: -1, markedHere: 0, listedPint: null })).toEqual({ ok: false });
    expect(parseStillTrueField({ saidYes: 0, markedHere: null, listedPint: null })).toEqual({
      ok: true,
      facts: { saidYes: 0, markedHere: null, listedPint: null },
    });
  });
});
