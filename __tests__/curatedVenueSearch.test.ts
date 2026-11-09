import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VenueRef } from "@/lib/venueIndex";

const fixtures = vi.hoisted(() => {
  const branches = ["Camden", "Islington", "Hackney", "Westminster", "Brent", "Ealing", "Hounslow", "Croydon", "Sutton", "Greenwich", "Lewisham"];
  return {
    index: new Map<string, VenueRef>(branches.map((borough, index) => {
      const id = `venue-crown-${index}`;
      return [id, { id, name: "The Crown", borough, lat: 51.5, lng: -0.1 }];
    })),
    details: branches.map((_, index) => ({
      id: `venue-crown-${index}`, locality: index === 9 ? "Blackheath" : "",
      address: index === 8 ? "15 Carshalton Road" : "",
    })),
  };
});

vi.mock("@/lib/venueIndex", () => ({ getVenueIndex: async () => fixtures.index }));
vi.mock("@/lib/venuePriceIndex", () => ({ getPricedVenues: async () => fixtures.details }));
vi.mock("@/lib/ukNationalPubSearch.server", () => ({ searchUkNationalPubs: () => ({ status: "ready", hits: [] }) }));
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/pintDrops", () => ({ isLimited: vi.fn(async () => false) }));
vi.mock("@/lib/supabase", () => ({ clientIp: () => "127.0.0.1", hashIp: () => "test-hash" }));

import { GET } from "@/app/api/venue-search/route";
import { searchCuratedVenues } from "@/lib/curatedVenueSearch.server";
import { resolveWantedPaste } from "@/lib/wantedResolve.server";

beforeEach(() => {
  vi.clearAllMocks();
  for (const id of fixtures.index.keys()) {
    if (!id.startsWith("venue-crown-")) fixtures.index.delete(id);
  }
});

describe("branch search before the eight-result limit", () => {
  it("limits an unqualified name search", async () => {
    expect(await searchCuratedVenues("The Crown", 8)).toHaveLength(8);
  });

  it.each([
    ["Crown Sutton", "venue-crown-8"],
    ["Crown Greenwich", "venue-crown-9"],
    ["Lewisham Crown", "venue-crown-10"],
    ["Crown Blackheath", "venue-crown-9"],
    ["Crown Carshalton Road", "venue-crown-8"],
  ])("finds %s beyond the first eight namesakes", async (query, id) => {
    const response = await GET(new Request(`https://pubmaxxing.com/api/venue-search?q=${encodeURIComponent(query)}`));
    expect(response.status).toBe(200);
    expect((await response.json()).venues).toEqual([
      expect.objectContaining({ id, name: "The Crown" }),
    ]);
    expect((await resolveWantedPaste(query)).candidates.map((candidate) => candidate.venueId)).toEqual([id]);
  });

  it("requires every branch query word and keeps unknown branches absent", async () => {
    expect(await searchCuratedVenues("Crown Sutton Greenwich", 8)).toEqual([]);
    expect(await searchCuratedVenues("Crown Atlantis", 8)).toEqual([]);
  });

  it("excludes a bar only from comparison suggestions", async () => {
    fixtures.index.set("venue-1g9ombc", {
      id: "venue-1g9ombc", name: "All Bar One Sutton", kind: "bar", borough: "Sutton", lat: 51.36, lng: -0.19,
    });
    const url = "https://pubmaxxing.com/api/venue-search?q=All%20Bar%20One%20Sutton";
    const comparison = await GET(new Request(`${url}&scope=pub-comparison`));
    expect(comparison.status).toBe(200);
    expect((await comparison.json()).venues).toEqual([]);
    const general = await GET(new Request(url));
    expect((await general.json()).venues).toEqual([
      { id: "venue-1g9ombc", name: "All Bar One Sutton", area: "Sutton" },
    ]);
    expect((await resolveWantedPaste("All Bar One Sutton")).candidates.map((candidate) => candidate.venueId))
      .toEqual(["venue-1g9ombc"]);
  });

  it("applies comparison eligibility before limiting eight suggestions", async () => {
    const excluded = [
      ...["bar", "club", "food", "restaurant", "cafe", "hotel_lounge", "library", "coworking", "other"].map((kind, index) => ({
        id: `venue-kind-${index}`, name: "The Crown", kind: kind as NonNullable<VenueRef["kind"]>,
      })),
      { id: "venue-private", name: "The Crown Members Only Club" },
      { id: "venue-retired", name: "The Crown", retired: true as const },
      { id: "venue-mcr-abc", name: "The Crown" },
      { id: "venue-uk-n123", name: "The Crown" },
    ];
    const eligible = [...fixtures.index.entries()];
    fixtures.index.clear();
    for (const venue of excluded) fixtures.index.set(venue.id, { ...venue, borough: "Sutton", lat: 51.5, lng: -0.1 });
    for (const [id, venue] of eligible) fixtures.index.set(id, venue);
    fixtures.index.get("venue-crown-0")!.kind = "pub";
    const response = await GET(new Request("https://pubmaxxing.com/api/venue-search?q=Crown&scope=pub-comparison"));
    expect(response.status).toBe(200);
    expect((await response.json()).venues.map((venue: { id: string }) => venue.id))
      .toEqual(Array.from({ length: 8 }, (_, index) => `venue-crown-${index}`));
    const branch = await GET(new Request("https://pubmaxxing.com/api/venue-search?q=Crown%20Greenwich&scope=pub-comparison"));
    expect((await branch.json()).venues).toEqual([
      { id: "venue-crown-9", name: "The Crown", area: "Greenwich" },
    ]);
  });
});
