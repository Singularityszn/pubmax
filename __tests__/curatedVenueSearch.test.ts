import { beforeEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => {
  const branches = ["Camden", "Islington", "Hackney", "Westminster", "Brent", "Ealing", "Hounslow", "Croydon", "Sutton", "Greenwich", "Lewisham"];
  return {
    index: new Map(branches.map((borough, index) => {
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

beforeEach(() => { vi.clearAllMocks(); });

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
});
