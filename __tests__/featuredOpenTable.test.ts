import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// One selected night on empty Social. The selection pins the crew, its host, its
// one pub and its start. The public preview is the authority, and any drift from
// the selection falls back to the general crawl link.

const CREW_ID = "50000000-0000-4000-8000-000000000001";
const OTHER_CREW_ID = "50000000-0000-4000-8000-000000000002";
const LAMB = "venue-1yd70c7";
const OTHER_PUB = "venue-1abc234";
const NOW = Date.parse("2026-11-17T12:00:00Z");
const DAY_MS = 86_400_000;
const STARTS_AT = "2026-11-19T20:00:00.000Z";
const SOURCE = "https://www.pint-prices.com/pub/1%20Conduit%20Street/The%20Lamb";

const SELECTION = { crewId: CREW_ID, hostHandle: "lambhost", meetingVenueId: LAMB, startsAt: STARTS_AT };

const shareSource = {
  crewId: CREW_ID,
  title: "Thursday at The Lamb",
  hostHandle: "lambhost",
  startsAt: STARTS_AT,
  capacity: 8,
  memberCount: 3,
  meetingVenueId: LAMB,
  meetingVenueName: "The Lamb",
  stopVenueIds: [LAMB],
};

function priceRow(overrides: Record<string, unknown> = {}) {
  return {
    app_price_id: "app_price_lamb_1",
    pub_name: "The Lamb",
    pint_name: "Amstel",
    measure: "pint",
    price_gbp: 5.5,
    price_text: "£5.50",
    pub_url: SOURCE,
    source_datasets: "individual_pub_page",
    data_quality_notes: "",
    estimated_average_price_text: "",
    scraped_at_values: "2026-11-09T13:07:13+00:00",
    ...overrides,
  };
}

function lambDetail(rows = [priceRow()]) {
  return { status: "found", venue: { id: LAMB, name: "The Lamb", kind: "pub", prices: rows } };
}

const store = vi.hoisted(() => ({ readShareCard: vi.fn() }));
const resolveMeeting = vi.hoisted(() => ({ resolveOpenMeetingPoint: vi.fn() }));
const venues = vi.hoisted(() => ({ lookupVenueDetail: vi.fn() }));
const index = vi.hoisted(() => ({ lookupCanonicalVenue: vi.fn() }));

vi.mock("@/lib/socialCrewStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/socialCrewStore")>()),
  createSocialCrewStore: () => store,
}));
vi.mock("@/lib/openSocialCrew.server", () => resolveMeeting);
vi.mock("@/lib/venueDetailIndex", () => venues);
vi.mock("@/lib/venueIndex", () => index);

import { SocialCrewStoreError } from "@/lib/socialCrewStore";
import { stillTrueCountReader } from "@/lib/openCrawlShareCard.server";
import { loadFeaturedOpenTable } from "@/lib/featuredOpenTable.server";
import { FEATURED_OPEN_TABLE_SELECTION } from "@/lib/featuredOpenTableSelection";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(stillTrueCountReader, "read").mockResolvedValue(null);
  vi.stubEnv("PUBMAX_SOCIAL_FRIENDS_LAUNCH", "1");
  store.readShareCard.mockResolvedValue(shareSource);
  resolveMeeting.resolveOpenMeetingPoint.mockResolvedValue({
    ok: true,
    meetingPoint: { kind: "venue", name: "The Lamb", lat: 51.5226, lng: -0.1188, cityId: "london" },
  });
  venues.lookupVenueDetail.mockResolvedValue(lambDetail());
  index.lookupCanonicalVenue.mockImplementation(async (id: string) => ({
    status: "found",
    canonicalId: id,
    venue: { id, name: "The Lamb" },
    slimVenue: { kind: "pub" },
  }));
});

describe("featured open table selection", () => {
  it("ships with no selection", () => {
    expect(FEATURED_OPEN_TABLE_SELECTION).toBeNull();
  });

  it("reads nothing when no night is selected", async () => {
    await expect(loadFeaturedOpenTable(null, NOW)).resolves.toEqual({ status: "not-configured" });
    expect(store.readShareCard).not.toHaveBeenCalled();
  });

  it("refuses a malformed crew id", async () => {
    await expect(loadFeaturedOpenTable({ ...SELECTION, crewId: "crew-1" }, NOW)).resolves.toEqual({ status: "missing" });
  });

  it.each([
    ["an empty crew id", { crewId: "" }],
    ["an empty host", { hostHandle: "" }],
    ["an empty pub", { meetingVenueId: "" }],
    ["an unparseable start", { startsAt: "next Thursday" }],
  ])("refuses %s without a read", async (_label, overrides) => {
    await expect(loadFeaturedOpenTable({ ...SELECTION, ...overrides }, NOW)).resolves.toEqual({ status: "missing" });
    expect(store.readShareCard).not.toHaveBeenCalled();
  });
});

describe("the selected upcoming night", () => {
  it.each([8, 9])("falls back when %i members leave no guest places", async (memberCount) => {
    store.readShareCard.mockResolvedValue({ ...shareSource, memberCount });
    await expect(loadFeaturedOpenTable(SELECTION, NOW)).resolves.toEqual({ status: "missing" });
  });

  it("projects only the public facts of the exact selected crew", async () => {
    const result = await loadFeaturedOpenTable(SELECTION, NOW);

    expect(result).toEqual({
      status: "upcoming",
      table: {
        crewId: CREW_ID,
        hostHandle: "lambhost",
        meetingPubName: "The Lamb",
        startsAt: STARTS_AT,
        placesLine: "5 places left",
        price: {
          sentence: "Pint Prices listed Amstel (pint) at £5.50, read 9 November 2026.",
          sourceUrl: SOURCE,
        },
      },
    });
    expect(store.readShareCard.mock.calls).toEqual([[CREW_ID]]);
    expect(index.lookupCanonicalVenue).toHaveBeenCalledWith(LAMB);
    expect(JSON.stringify(result)).not.toContain(LAMB);
  });

  it("does not substitute another crawl when the selected crew reads as another crew", async () => {
    store.readShareCard.mockResolvedValue({ ...shareSource, crewId: OTHER_CREW_ID });
    await expect(loadFeaturedOpenTable(SELECTION, NOW)).resolves.toEqual({ status: "missing" });
    expect(store.readShareCard.mock.calls).toEqual([[CREW_ID]]);
  });

  it("falls back when the host changed", async () => {
    store.readShareCard.mockResolvedValue({ ...shareSource, hostHandle: "someoneelse" });
    await expect(loadFeaturedOpenTable(SELECTION, NOW)).resolves.toEqual({ status: "missing" });
  });

  it.each([
    ["the meeting pub moved", { meetingVenueId: OTHER_PUB, stopVenueIds: [OTHER_PUB] }],
    ["the sole stop differs from the meeting pub", { stopVenueIds: [OTHER_PUB] }],
    ["the meeting pub differs from the sole stop", { meetingVenueId: OTHER_PUB }],
    ["the night has more than one stop", { stopVenueIds: [LAMB, OTHER_PUB] }],
    ["the stop list is unknown", { stopVenueIds: null }],
    ["the stop list is empty", { stopVenueIds: [] }],
  ])("falls back when %s", async (_label, overrides) => {
    store.readShareCard.mockResolvedValue({ ...shareSource, ...overrides });
    await expect(loadFeaturedOpenTable(SELECTION, NOW)).resolves.toEqual({ status: "missing" });
  });

  it("falls back when the selected pub is not the one both stored ids name", async () => {
    await expect(loadFeaturedOpenTable({ ...SELECTION, meetingVenueId: OTHER_PUB }, NOW))
      .resolves.toEqual({ status: "missing" });
  });

  it("compares pub ids, never names", async () => {
    store.readShareCard.mockResolvedValue({ ...shareSource, meetingVenueId: OTHER_PUB, stopVenueIds: [OTHER_PUB] });
    resolveMeeting.resolveOpenMeetingPoint.mockResolvedValue({
      ok: true,
      meetingPoint: { kind: "venue", name: "The Lamb", lat: 51.5226, lng: -0.1188, cityId: "london" },
    });
    await expect(loadFeaturedOpenTable(SELECTION, NOW)).resolves.toEqual({ status: "missing" });
  });

  it.each([
    ["the pub is in another city", async (id: string) => ({ status: "found", canonicalId: "venue-mcr-abc123", venue: { id } })],
    ["the selected id is an alias of another pub", async () => ({ status: "found", canonicalId: OTHER_PUB, venue: { id: OTHER_PUB } })],
    ["the London index does not list the pub", async (id: string) => ({ status: "unknown", canonicalId: id })],
  ])("falls back when %s", async (_label, lookup) => {
    index.lookupCanonicalVenue.mockImplementation(lookup);
    await expect(loadFeaturedOpenTable(SELECTION, NOW)).resolves.toEqual({ status: "missing" });
  });

  it("falls back for a non-London selected pub even when the stored ids agree", async () => {
    const mcr = "venue-mcr-abc123";
    store.readShareCard.mockResolvedValue({ ...shareSource, meetingVenueId: mcr, stopVenueIds: [mcr] });
    await expect(loadFeaturedOpenTable({ ...SELECTION, meetingVenueId: mcr }, NOW))
      .resolves.toEqual({ status: "missing" });
  });

  it("falls back when the start moved inside the valid window", async () => {
    store.readShareCard.mockResolvedValue({ ...shareSource, startsAt: "2026-11-19T20:30:00.000Z" });
    await expect(loadFeaturedOpenTable(SELECTION, NOW)).resolves.toEqual({ status: "missing" });
  });

  it("matches the same start instant written another way", async () => {
    store.readShareCard.mockResolvedValue({ ...shareSource, startsAt: "2026-11-19T20:00:00+00:00" });
    await expect(loadFeaturedOpenTable(SELECTION, NOW)).resolves.toMatchObject({ status: "upcoming" });
  });

  it.each([
    ["starts now", NOW, "upcoming"],
    ["started a moment ago", NOW - 1, "missing"],
    ["starts just inside seven days", NOW + 7 * DAY_MS - 1, "upcoming"],
    ["starts exactly seven days out", NOW + 7 * DAY_MS, "missing"],
  ])("a night that %s reads as %s", async (_label, startMs, status) => {
    const startsAt = new Date(startMs).toISOString();
    store.readShareCard.mockResolvedValue({ ...shareSource, startsAt });
    await expect(loadFeaturedOpenTable({ ...SELECTION, startsAt }, NOW)).resolves.toMatchObject({ status });
  });
});

describe("reads that cannot answer", () => {
  it("shows the night when unused public attendance facts cannot answer", async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(stillTrueCountReader, "read").mockImplementation(() => new Promise(() => {}));
      const answer = vi.fn();
      void loadFeaturedOpenTable(SELECTION, NOW).then(answer);
      await vi.advanceTimersByTimeAsync(1500);
      expect(answer).toHaveBeenCalledWith(expect.objectContaining({
        status: "upcoming",
        table: expect.objectContaining({ placesLine: "5 places left" }),
      }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the night without a price when its optional detail read stalls", async () => {
    vi.useFakeTimers();
    try {
      venues.lookupVenueDetail.mockImplementation(() => new Promise(() => {}));
      const answer = vi.fn();
      void loadFeaturedOpenTable(SELECTION, NOW).then(answer);

      await vi.advanceTimersByTimeAsync(1499);
      expect(answer).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(answer).toHaveBeenCalledWith(expect.objectContaining({
        status: "upcoming",
        table: expect.objectContaining({ price: null, placesLine: "5 places left" }),
      }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("says unavailable when the crew read fails, and never substitutes a night", async () => {
    store.readShareCard.mockRejectedValue(new SocialCrewStoreError("UNAVAILABLE", 503, "down"));
    await expect(loadFeaturedOpenTable(SELECTION, NOW)).resolves.toEqual({ status: "unavailable" });
  });

  it("says missing when the crew is no longer an open upcoming crawl", async () => {
    store.readShareCard.mockRejectedValue(new SocialCrewStoreError("NOT_FOUND", 404, "gone"));
    await expect(loadFeaturedOpenTable(SELECTION, NOW)).resolves.toEqual({ status: "missing" });
  });

  it("says unavailable when Social is rolled back", async () => {
    vi.stubEnv("PUBMAX_SOCIAL_FRIENDS_LAUNCH", "0");
    await expect(loadFeaturedOpenTable(SELECTION, NOW)).resolves.toEqual({ status: "unavailable" });
    expect(store.readShareCard).not.toHaveBeenCalled();
  });

  it("says unavailable when the London index cannot be read", async () => {
    index.lookupCanonicalVenue.mockResolvedValue({ status: "unavailable", canonicalId: LAMB });
    await expect(loadFeaturedOpenTable(SELECTION, NOW)).resolves.toEqual({ status: "unavailable" });
  });

  it("keeps places left unknown when the member count is unread, and never derives it from capacity", async () => {
    store.readShareCard.mockResolvedValue({ ...shareSource, memberCount: null });
    const result = await loadFeaturedOpenTable(SELECTION, NOW);
    expect(result).toMatchObject({ status: "upcoming", table: { placesLine: null } });
  });

  it.each([
    ["the detail read fails", () => venues.lookupVenueDetail.mockRejectedValue(new Error("down"))],
    ["the detail names another pub", () => venues.lookupVenueDetail.mockResolvedValue({
      ...lambDetail(), venue: { ...lambDetail().venue, id: OTHER_PUB },
    })],
    ["the price is stale", () => venues.lookupVenueDetail.mockResolvedValue(
      lambDetail([priceRow({ scraped_at_values: "2026-10-01T12:00:00Z" })]),
    )],
    ["the price states no measure", () => venues.lookupVenueDetail.mockResolvedValue(
      lambDetail([priceRow({ measure: undefined })]),
    )],
  ])("shows the night without a price when %s", async (_label, arrange) => {
    arrange();
    const result = await loadFeaturedOpenTable(SELECTION, NOW);
    expect(result).toMatchObject({ status: "upcoming", table: { price: null, placesLine: "5 places left" } });
  });

  it("quotes a conditional listing whole", async () => {
    const conditions = "£5.50 for CAMRA members showing a card, Monday to Thursday from 5pm until 7pm";
    venues.lookupVenueDetail.mockResolvedValue(lambDetail([priceRow({ price_text: conditions })]));
    const result = await loadFeaturedOpenTable(SELECTION, NOW);
    expect(result).toMatchObject({
      status: "upcoming",
      table: { price: { sentence: `Pint Prices listed Amstel (pint) as "${conditions}", read 9 November 2026.` } },
    });
  });
});
