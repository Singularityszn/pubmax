import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const CREW_ID = "50000000-0000-4000-8000-000000000001";
const shareSource = {
  crewId: CREW_ID,
  title: "Friday in Camden",
  hostHandle: "host",
  startsAt: "2026-08-23T18:30:00.000Z",
  capacity: 8,
  memberCount: 3,
  meetingVenueId: "venue-london-camden-arms",
  meetingVenueName: "Camden Arms",
  stopVenueIds: ["venue-london-camden-arms", "venue-london-good-mixer"],
};

const PRICES: Record<string, number> = {
  "venue-london-camden-arms": 6.2,
  "venue-london-good-mixer": 4.5,
};

const venuePrice = (venueId: string) => ({
  name: venueId === shareSource.meetingVenueId ? "Camden Arms" : "Hidden Good Mixer",
  cheapestPrice: PRICES[venueId] ?? null,
  cheapestPint: "Lager",
  prices: [{
    app_price_id: venueId,
    pint_name: "Lager",
    price_gbp: PRICES[venueId] ?? null,
    pub_url: "https://hidden-publisher.example/hidden-good-mixer",
    scraped_at_values: venueId === shareSource.meetingVenueId ? "2026-08-20" : "2026-08-03",
  }],
});

const store = vi.hoisted(() => ({ readShareCard: vi.fn() }));
const resolveMeeting = vi.hoisted(() => ({ resolveOpenMeetingPoint: vi.fn() }));
const venues = vi.hoisted(() => ({ lookupVenueDetail: vi.fn() }));

vi.mock("@/lib/socialCrewStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/socialCrewStore")>()),
  createSocialCrewStore: () => store,
}));

vi.mock("@/lib/openSocialCrew.server", () => resolveMeeting);
vi.mock("@/lib/venueDetailIndex", () => venues);

import { SocialCrewStoreError } from "@/lib/socialCrewStore";
import { stillTrueCountReader } from "@/lib/openCrawlShareCard.server";
import { GET } from "@/app/api/social/crews/[crewId]/public/route";

function context(crewId = CREW_ID): { params: Promise<{ crewId: string }> } {
  return { params: Promise.resolve({ crewId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(stillTrueCountReader, "read").mockResolvedValue(null);
  vi.stubEnv("PUBMAX_SOCIAL_FRIENDS_LAUNCH", "1");
  store.readShareCard.mockResolvedValue(shareSource);
  venues.lookupVenueDetail.mockImplementation(async (venueId: string) => ({
    status: "found",
    venue: venuePrice(venueId),
  }));
  resolveMeeting.resolveOpenMeetingPoint.mockResolvedValue({
    ok: true,
    meetingPoint: {
      kind: "venue",
      name: "Camden Arms",
      lat: 51.541,
      lng: -0.142,
      cityId: "london",
    },
  });
});

describe("GET /api/social/crews/:crewId/public", () => {
  it("hides public crew data during emergency rollback", async () => {
    vi.stubEnv("PUBMAX_SOCIAL_FRIENDS_LAUNCH", "0");

    const response = await GET(
      new Request(`https://pubmaxxing.com/api/social/crews/${CREW_ID}/public`),
      context(),
    );

    expect(response.status).toBe(503);
    expect(store.readShareCard).not.toHaveBeenCalled();
    expect(resolveMeeting.resolveOpenMeetingPoint).not.toHaveBeenCalled();
  });

  it("returns the link preview facts and never a member or a stop", async () => {
    const response = await GET(
      new Request(`https://pubmaxxing.com/api/social/crews/${CREW_ID}/public`),
      context(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toEqual({
      kind: "public",
      crewId: CREW_ID,
      title: "Friday in Camden",
      hostHandle: "host",
      startsAt: "2026-08-23T18:30:00.000Z",
      meetingPoint: {
        kind: "venue",
        name: "Camden Arms",
        lat: 51.541,
        lng: -0.142,
      },
      area: { name: "Camden", relation: "inside" },
      placesLeft: 5,
      spendBand: { minGbp: 4.5, maxGbp: 6.2, observedOn: "2026-08-03", sourceKind: "listed" },
      stillTrue: null,
    });
    expect(stillTrueCountReader.read).not.toHaveBeenCalled();
    expect(resolveMeeting.resolveOpenMeetingPoint).toHaveBeenCalledWith(
      shareSource.meetingVenueId,
    );
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("memberCount");
    expect(serialized).not.toContain("capacity");
    expect(serialized).not.toContain("visibility");
    expect(serialized).not.toContain("stopVenueId");
    expect(serialized).not.toContain("good-mixer");
    expect(serialized).not.toContain("Hidden Good Mixer");
    expect(serialized).not.toContain("hidden-publisher");
  });

  it("keeps the oldest day when the cheapest stop has the newest price", async () => {
    venues.lookupVenueDetail.mockImplementation(async (venueId: string) => ({
      status: "found",
      venue: {
        ...venuePrice(venueId),
        prices: [{
          ...venuePrice(venueId).prices[0],
          scraped_at_values: venueId === shareSource.meetingVenueId ? "2026-08-03" : "2026-08-20",
        }],
      },
    }));
    const response = await GET(new Request("https://pubmaxxing.com/api/social/crews/x/public"), context());
    expect((await response.json()).spendBand).toEqual({
      minGbp: 4.5, maxGbp: 6.2, observedOn: "2026-08-03", sourceKind: "listed",
    });
  });

  it.each(["scraped_at_values", "pub_url"] as const)("omits the band when a stop lacks %s", async (field) => {
    venues.lookupVenueDetail.mockImplementation(async (venueId: string) => ({
      status: "found",
      venue: {
        ...venuePrice(venueId),
        prices: [{
          ...venuePrice(venueId).prices[0],
          ...(venueId === shareSource.meetingVenueId ? {} : { [field]: "" }),
        }],
      },
    }));
    const response = await GET(new Request("https://pubmaxxing.com/api/social/crews/x/public"), context());
    expect(response.status).toBe(200);
    expect((await response.json()).spendBand).toBeNull();
  });

  it("prints no band when one stop has no listed price, and Full at the cap", async () => {
    store.readShareCard.mockResolvedValueOnce({
      ...shareSource,
      memberCount: 9,
      stopVenueIds: [...shareSource.stopVenueIds, "venue-london-unpriced"],
    });

    const response = await GET(new Request("https://pubmaxxing.com/api/social/crews/x/public"), context());
    const body = await response.json();

    expect(body.placesLeft).toBe(0);
    expect(body.spendBand).toBeNull();
  });

  it("answers the 0115 fallback with no places and no band", async () => {
    store.readShareCard.mockResolvedValueOnce({
      ...shareSource,
      capacity: null,
      memberCount: null,
      stopVenueIds: null,
    });

    const response = await GET(new Request("https://pubmaxxing.com/api/social/crews/x/public"), context());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.placesLeft).toBeNull();
    expect(body.spendBand).toBeNull();
    expect(venues.lookupVenueDetail).not.toHaveBeenCalled();
    expect(body.stillTrue).toBeNull();
    expect(stillTrueCountReader.read).not.toHaveBeenCalled();
  });

  it("counts real join rows and a sourced listing on a one-pub night", async () => {
    store.readShareCard.mockResolvedValueOnce({
      ...shareSource,
      stopVenueIds: ["venue-london-camden-arms"],
    });
    vi.mocked(stillTrueCountReader.read).mockResolvedValue({ saidYes: 2, markedHere: 1 });

    const response = await GET(new Request("https://pubmaxxing.com/api/social/crews/x/public"), context());
    const body = await response.json();

    expect(body.stillTrue).toEqual({
      saidYes: 2,
      markedHere: 1,
      listedPint: {
        drink: "Lager",
        priceGbp: 6.2,
        source: "hidden-publisher.example",
        readOn: "2026-08-20",
      },
    });
    const serialized = JSON.stringify(body.stillTrue);
    expect(serialized).not.toContain("https://");
    expect(serialized).not.toContain("hidden-good-mixer");
    expect(stillTrueCountReader.read).toHaveBeenCalledWith(CREW_ID);
  });

  it("does not expose a row when Stop 1 is no longer listed", async () => {
    resolveMeeting.resolveOpenMeetingPoint.mockResolvedValue({ ok: false, reason: "refused" });

    const response = await GET(new Request("https://pubmaxxing.com/api/social/crews/x/public"), context());

    expect(response.status).toBe(404);
    expect(store.readShareCard).toHaveBeenCalledWith(CREW_ID);
  });

  it.each([
    new SocialCrewStoreError("NOT_FOUND", 404, "Social Crew not found."),
    new SocialCrewStoreError("UNAVAILABLE", 503, "Social Crew is unavailable right now."),
  ])("maps public store errors without leaking authority", async (error) => {
    store.readShareCard.mockRejectedValueOnce(error);

    const response = await GET(new Request("https://pubmaxxing.com/api/social/crews/x/public"), context());

    expect(response.status).toBe(error.status);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain("hostHandle");
    expect(JSON.stringify(body)).not.toContain("member");
  });

  it("rejects a malformed crew id before reading the store", async () => {
    const response = await GET(
      new Request("https://pubmaxxing.com/api/social/crews/not-a-crew/public"),
      context("not-a-crew"),
    );

    expect(response.status).toBe(404);
    expect(store.readShareCard).not.toHaveBeenCalled();
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});
