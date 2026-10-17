// @vitest-environment jsdom

// THE FSA HYGIENE BADGE JOINS ON OSM'S OWN fhrs:id, AND SAYS WHO SAID IT AND
// WHEN (owner decision, 16 Oct 2026).
//
// Two packs, one per source and licence: public/data/osm_fhrs/london.json
// (OpenStreetMap, ODbL) says which FSA establishment a London pub IS, and
// public/data/fsa_hygiene/london.json (FSA open data, OGL v3.0) says what the
// FSA rated it. They meet at runtime in lib/fsaHygienePack.ts. A pub with no
// tag, an ambiguous tag, or no FSA row gets nothing: a missing value is never
// read as "not rated".

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildOsmFhrsLinks, parseFhrsId } from "@/scripts/lib/osmFhrsLinks.mjs";
import {
  buildFsaHygienePack,
  compactEstablishment,
  FSA_PAGE_SIZE,
  fsaGetJson,
  wantedFhrsIds,
} from "@/scripts/lib/fsaHygienePack.mjs";
import {
  fsaHygieneForVenue,
  osmRefForVenueId,
  parseFsaHygieneRatings,
  parseOsmFhrsLinks,
} from "@/lib/fsaHygienePack";
import VenueHygiene, { hygieneBadge } from "@/components/map/VenueHygiene";
import { defined } from "@/__tests__/helpers/defined";
import { READ_PHASE_DELAY_MS } from "@/lib/useStaggeredRead";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = process.cwd();
const FETCHED_AT = "2026-10-06T00:13:28.443Z";
const READ_AT = "2026-10-16T09:00:00.000Z";

function pub(type: string, id: number, lat: number, lon: number, tags: Record<string, string>) {
  return { type, id, lat, lon, tags: { amenity: "pub", ...tags } };
}

describe("the OSM link pack", () => {
  const chunks = [
    {
      elements: [
        pub("node", 1, 51.5, -0.1, { name: "The Lamb", "fhrs:id": "1026539" }),
        pub("node", 2, 51.5, -0.1, { name: "Two Ids", "fhrs:id": "70278;100386" }),
        pub("node", 3, 51.5, -0.1, { name: "No Tag" }),
        pub("node", 4, 53.48, -2.24, { name: "Manchester", "fhrs:id": "55" }),
        { type: "node", id: 5, lat: 51.5, lon: -0.1, tags: { amenity: "cafe", "fhrs:id": "66" } },
        { type: "way", id: 6, center: { lat: 51.51, lon: -0.12 }, tags: { amenity: "pub", "fhrs:id": " 77 " } },
        pub("node", 7, 51.5, -0.1, { name: "Text", "fhrs:id": "pending" }),
      ],
    },
    // The same pub in a second overlapping chunk is still one pub.
    { elements: [pub("node", 1, 51.5, -0.1, { name: "The Lamb", "fhrs:id": "1026539" })] },
  ];
  const seedPubs = [
    { osmId: "node/1", curatedRef: { source: "curated-london-slim", id: "venue-lamb" } },
    // Two OSM objects claim one curated venue: neither link is believed.
    { osmId: "way/6", curatedRef: { source: "curated-london-slim", id: "venue-twice" } },
    { osmId: "node/99", curatedRef: { source: "curated-london-slim", id: "venue-twice" } },
  ];

  it("follows a merged curated venue to the venue that kept it", () => {
    const merged = buildOsmFhrsLinks({
      chunks,
      seedPubs,
      fetchedAt: FETCHED_AT,
      venueAliases: { "venue-lamb": "venue-lamb-kept" },
    });
    expect(merged.links).toContainEqual(["n1", 1026539, "venue-lamb-kept"]);
  });

  it("keeps one row per London pub that states exactly one fhrs:id", () => {
    const pack = buildOsmFhrsLinks({ chunks, seedPubs, fetchedAt: FETCHED_AT });
    expect(pack.links).toEqual([
      ["n1", 1026539, "venue-lamb"],
      ["w6", 77, null],
    ]);
    expect(pack.counts).toMatchObject({
      londonPubs: 5,
      linked: 2,
      multiValueTag: 1,
      unreadableTag: 1,
      curatedLinked: 1,
      curatedAmbiguous: 2,
    });
    expect(pack).toMatchObject({ license: "ODbL 1.0", attribution: "© OpenStreetMap contributors", fetchedAt: FETCHED_AT });
  });

  it("reads a tag as one id or as nothing", () => {
    expect(parseFhrsId("1026539")).toBe(1026539);
    expect(parseFhrsId("70278;100386")).toBeNull();
    expect(parseFhrsId("0")).toBeNull();
    expect(parseFhrsId("")).toBeNull();
    expect(parseFhrsId(undefined)).toBeNull();
  });

  it("is committed exactly as the builder writes it from the committed snapshot", () => {
    const committed = JSON.parse(readFileSync(join(ROOT, "public/data/osm_fhrs/london.json"), "utf8"));
    const rawDir = join(ROOT, "data/osm/uk/raw");
    const rebuilt = buildOsmFhrsLinks({
      chunks: readdirSync(rawDir)
        .filter((file) => file.endsWith(".json"))
        .sort()
        .map((file) => JSON.parse(readFileSync(join(rawDir, file), "utf8"))),
      seedPubs: JSON.parse(readFileSync(join(ROOT, "data/osm/uk/uk_osm_pubs.json"), "utf8")).pubs,
      fetchedAt: JSON.parse(readFileSync(join(ROOT, "data/osm/uk/chunks.json"), "utf8")).generatedAt,
      venueAliases: JSON.parse(readFileSync(join(ROOT, "public/data/venue_id_aliases.json"), "utf8")).aliases,
    });
    expect(committed).toEqual(rebuilt);
    expect(committed.links.length).toBeGreaterThan(2000);
    const parsed = parseOsmFhrsLinks(committed);
    expect(parsed?.fhrsByRef.size).toBe(committed.links.length);
  });

  it("names only curated venues the London index ships", () => {
    const committed = JSON.parse(readFileSync(join(ROOT, "public/data/osm_fhrs/london.json"), "utf8"));
    const slim = JSON.parse(readFileSync(join(ROOT, "public/data/venues_slim.json"), "utf8"));
    const shipped = new Set((Array.isArray(slim) ? slim : slim.rows).map((row: { id: string }) => row.id));
    const named = committed.links.map((link: unknown[]) => link[2]).filter(Boolean);
    expect(named.length).toBeGreaterThan(0);
    for (const venueId of named) expect(shipped.has(venueId), venueId).toBe(true);
  });
});

const ESTABLISHMENT = {
  FHRSID: 1026539,
  BusinessName: "The Arnos Arms",
  RatingValue: "5",
  RatingDate: "2025-06-05T00:00:00",
  SchemeType: "FHRS",
  LocalAuthorityName: "Enfield",
};

describe("the FSA ratings pack", () => {
  it("keeps the FSA's rating, its day and its authority, and nothing it did not state", () => {
    expect(compactEstablishment(ESTABLISHMENT)).toEqual(["5", "2025-06-05", "Enfield"]);
    expect(compactEstablishment({ ...ESTABLISHMENT, RatingValue: "AwaitingInspection", RatingDate: null })).toEqual([
      "AwaitingInspection",
      null,
      "Enfield",
    ]);
    // Scotland's scheme and statuses outside the closed set are not carried.
    expect(compactEstablishment({ ...ESTABLISHMENT, SchemeType: "FHIS", RatingValue: "Pass" })).toBeNull();
    expect(compactEstablishment({ ...ESTABLISHMENT, RatingValue: "AwaitingPublication" })).toBeNull();
  });

  it("keeps only the establishments a London pub names, and drops one the reads disagree about", () => {
    const wanted = wantedFhrsIds({ links: [["n1", 1026539, null], ["n2", 2, null], ["n3", 3, null]] });
    const pack = buildFsaHygienePack({
      wanted,
      retrievedAt: READ_AT,
      establishments: [
        ESTABLISHMENT,
        { ...ESTABLISHMENT, FHRSID: 999 },
        { ...ESTABLISHMENT, FHRSID: 2, RatingValue: "4" },
        { ...ESTABLISHMENT, FHRSID: 2, RatingValue: "3" },
      ],
    });
    expect(pack.ratings).toEqual({ "1026539": ["5", "2025-06-05", "Enfield"] });
    expect(pack.counts).toMatchObject({ wanted: 3, kept: 1, conflicted: 1, notReturned: 1 });
    expect(pack).toMatchObject({ license: "Open Government Licence v3.0", retrievedAt: READ_AT });
    expect(() => buildFsaHygienePack({ wanted, retrievedAt: "soon", establishments: [] })).toThrow();
  });
});

describe("the runtime join", () => {
  const links = parseOsmFhrsLinks({
    version: 1,
    fetchedAt: FETCHED_AT,
    links: [
      ["n1", 1026539, "venue-lamb"],
      ["w6", 77, null],
      ["junk", 1, null],
    ],
  });
  const ratings = parseFsaHygieneRatings(
    buildFsaHygienePack({ wanted: new Set([1026539]), establishments: [ESTABLISHMENT], retrievedAt: READ_AT }),
  );

  it("reaches a base pub by its own id and a curated pub by its link", () => {
    expect(links && osmRefForVenueId("venue-uk-w6", links)).toBe("w6");
    expect(links && osmRefForVenueId("venue-lamb", links)).toBe("n1");
    expect(links && osmRefForVenueId("venue-unlinked", links)).toBeNull();
    expect(fsaHygieneForVenue("venue-lamb", links, ratings)).toEqual({
      fhrsid: 1026539,
      rating: "5",
      ratingDate: "2025-06-05",
      localAuthority: "Enfield",
      source: "Food Standards Agency, Food Hygiene Rating Scheme",
      sourceUrl: "https://ratings.food.gov.uk/open-data",
      license: "Open Government Licence v3.0",
      retrievedAt: READ_AT,
      linkedAt: FETCHED_AT,
    });
    expect(fsaHygieneForVenue("venue-uk-n1", links, ratings)?.fhrsid).toBe(1026539);
  });

  it("answers nothing, never a no, when a link, a row or a pack is missing", () => {
    // Linked, but the FSA pack holds no row for establishment 77.
    expect(fsaHygieneForVenue("venue-uk-w6", links, ratings)).toBeNull();
    expect(fsaHygieneForVenue("venue-unlinked", links, ratings)).toBeNull();
    expect(fsaHygieneForVenue("venue-lamb", links, null)).toBeNull();
    expect(fsaHygieneForVenue("venue-lamb", null, ratings)).toBeNull();
  });

  it("refuses a pack that is not one", () => {
    expect(parseOsmFhrsLinks({ version: 2, fetchedAt: FETCHED_AT, links: [] })).toBeNull();
    expect(parseOsmFhrsLinks({ version: 1, fetchedAt: "soon", links: [] })).toBeNull();
    expect(parseFsaHygieneRatings({ version: 1, retrievedAt: READ_AT, ratings: {} })).toBeNull();
    const odd = parseFsaHygieneRatings({
      version: 1,
      retrievedAt: READ_AT,
      source: "FSA",
      sourceUrl: "https://ratings.food.gov.uk/open-data",
      license: "OGL",
      ratings: { "1": ["Pass", null, null], "01": ["5", null, null], "2": ["5", "not a day", ""] },
    });
    expect([...(odd?.byFhrsId.entries() ?? [])]).toEqual([[2, ["5", null, null]]]);
  });
});

describe("the route", () => {
  afterEach(() => {
    vi.doUnmock("@/lib/fsaHygienePack.server");
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  async function routeWith(fact: unknown, linkedFhrsId: number | null = null) {
    vi.resetModules();
    vi.doMock("@/lib/fsaHygienePack.server", () => ({
      packHygieneForVenue: vi.fn(async () => fact),
      linkedFhrsIdForVenue: vi.fn(async () => linkedFhrsId),
    }));
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    return (await import("@/app/api/hygiene/route")).GET;
  }

  it("answers from the exact join without asking the FSA", async () => {
    const fact = fsaHygieneForVenue(
      "venue-lamb",
      parseOsmFhrsLinks({ version: 1, fetchedAt: FETCHED_AT, links: [["n1", 1026539, "venue-lamb"]] }),
      parseFsaHygieneRatings(
        buildFsaHygienePack({ wanted: new Set([1026539]), establishments: [ESTABLISHMENT], retrievedAt: READ_AT }),
      ),
    );
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const GET = await routeWith(fact);
    const res = await GET(new Request("http://localhost/api/hygiene?venueId=venue-lamb&name=The%20Lamb&postcode=N11%201AN"));
    expect(await res.json()).toEqual({ rating: null, fact });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to the live name-and-postcode match when the packs know nothing", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ establishments: [ESTABLISHMENT] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const GET = await routeWith(null);
    const res = await GET(
      new Request("http://localhost/api/hygiene?venueId=venue-unlinked&name=The%20Arnos%20Arms&postcode=N11%201AN"),
    );
    const body = await res.json();
    expect(body.fact).toBeUndefined();
    expect(body.rating.fhrsid).toBe(1026539);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // A NEIGHBOUR WITH THE SAME NAME IS NOT THIS PUB. OSM names the FHRSID, so
  // the live read at the postcode keeps that establishment or nothing.
  const NEIGHBOUR = { ...ESTABLISHMENT, FHRSID: 9999001, BusinessName: "The Arnos Arms Kitchen", RatingValue: "1" };

  it("matches a linked venue by its FHRSID alone, never by a similar name", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ establishments: [NEIGHBOUR] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const GET = await routeWith(null, 1026539);
    const res = await GET(
      new Request("http://localhost/api/hygiene?venueId=venue-uk-n1&name=The%20Arnos%20Arms&postcode=N11%201AN"),
    );
    expect(await res.json()).toEqual({ rating: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("finds a linked venue at its postcode under whatever name the FSA files it", async () => {
    const filed = { ...ESTABLISHMENT, BusinessName: "Arnos Grove Hospitality Ltd" };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ establishments: [NEIGHBOUR, filed] }), { status: 200 })));
    const GET = await routeWith(null, 1026539);
    const res = await GET(
      new Request("http://localhost/api/hygiene?venueId=venue-uk-n1&name=The%20Arnos%20Arms&postcode=N11%201AN"),
    );
    const body = await res.json();
    expect(body.rating).toMatchObject({ fhrsid: 1026539, ratingValue: 5, businessName: "Arnos Grove Hospitality Ltd" });
  });
});

describe("the builder's FSA reads", () => {
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  const noSleep = vi.fn(async () => {});

  it("asks only the host the source policy registers, refuses a redirect, and pages at the FSA's ceiling", async () => {
    const fetchImpl = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => ok({ establishments: [] }));
    await fsaGetJson(`/Establishments?localAuthorityId=1&pageSize=${FSA_PAGE_SIZE}&pageNumber=1`, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
    });
    const [url, init] = defined(fetchImpl.mock.calls[0], "one read");
    expect(new URL(url).host).toBe("api.ratings.food.gov.uk");
    expect(init?.redirect).toBe("error");
    expect(FSA_PAGE_SIZE).toBeLessThanOrEqual(200);
    await expect(fsaGetJson("//example.com/Establishments", { fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toThrow(
      /is not fsa-fhrs-api/,
    );
    await expect(fsaGetJson("http://api.ratings.food.gov.uk/Authorities", { fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toThrow(
      /is not fsa-fhrs-api/,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("waits out a 429 as the FSA asks, then reads", async () => {
    const sleep = vi.fn(async () => {});
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429, headers: { "retry-after": "7" } }))
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(ok({ authorities: [] }));
    expect(await fsaGetJson("/Authorities", { fetchImpl, sleep, baseDelayMs: 100 })).toEqual({ authorities: [] });
    expect(sleep.mock.calls).toEqual([[7000], [200]]);
  });

  it("stops after a bounded number of attempts, and on any other failure at once", async () => {
    const throttled = vi.fn(async () => new Response("", { status: 429 }));
    await expect(fsaGetJson("/Authorities", { fetchImpl: throttled, sleep: noSleep, maxAttempts: 3 })).rejects.toThrow(
      /429 .* after 3 attempt/,
    );
    expect(throttled).toHaveBeenCalledTimes(3);
    const refused = vi.fn(async () => new Response("", { status: 403 }));
    await expect(fsaGetJson("/Authorities", { fetchImpl: refused, sleep: noSleep })).rejects.toThrow(/403/);
    expect(refused).toHaveBeenCalledTimes(1);
  });

  it("reads a withdrawn establishment as nothing", async () => {
    const gone = vi.fn(async () => new Response("", { status: 404 }));
    expect(await fsaGetJson("/Establishments/1", { fetchImpl: gone, sleep: noSleep })).toBeNull();
  });
});

describe("the badge says who rated it, who published it and when we read it", () => {
  const fact = {
    fhrsid: 1026539,
    rating: "5" as const,
    ratingDate: "2025-06-05",
    localAuthority: "Enfield",
    source: "Food Standards Agency, Food Hygiene Rating Scheme",
    license: "Open Government Licence v3.0",
    retrievedAt: READ_AT,
  };

  it("words each answer the FSA can give", () => {
    expect(hygieneBadge({ fact })).toMatchObject({
      score: "5",
      spoken: "5 out of 5",
      provenance: "FSA open data (Open Government Licence v3.0), read 16 Oct 2026",
    });
    expect(hygieneBadge({ fact: { ...fact, rating: "Exempt" } })).toMatchObject({ score: "Exempt", spoken: "exempt" });
    expect(hygieneBadge({ fact: { ...fact, rating: "AwaitingInspection" } })).toMatchObject({
      score: "Awaiting inspection",
    });
    expect(hygieneBadge({ rating: { fhrsid: 1, ratingValue: 4, ratingDate: null, businessName: "X", localAuthority: null } }))
      .toMatchObject({ score: "4", provenance: "FSA ratings API, read live" });
    expect(hygieneBadge({})).toBeNull();
  });

  let root: Root;
  let container: HTMLElement;
  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("prints the rating, the month it was awarded and the source line on the sheet", async () => {
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () => new Response(JSON.stringify({ rating: null, fact }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    act(() =>
      root.render(createElement(VenueHygiene, { venueId: "venue-lamb", venueName: "The Lamb", address: "N11 1AN" })),
    );
    await act(async () => {
      vi.advanceTimersByTime(READ_PHASE_DELAY_MS[2]);
      await Promise.resolve();
    });
    for (let i = 0; i < 6; i += 1) await act(async () => Promise.resolve());

    const badge = container.querySelector<HTMLAnchorElement>(".venueHygiene");
    expect(badge?.textContent).toContain("Food hygiene");
    expect(badge?.querySelector(".venueHygieneScore")?.textContent).toBe("5");
    expect(badge?.textContent).toContain("rated Jun 2025");
    expect(badge?.querySelector(".venueHygieneProvenance")?.textContent).toBe(
      "FSA open data (Open Government Licence v3.0), read 16 Oct 2026",
    );
    expect(badge?.getAttribute("href")).toBe("https://ratings.food.gov.uk/business/1026539");
    expect(badge?.getAttribute("aria-label")).toBe(
      "FSA food hygiene rating 5 out of 5, rated by Enfield, Jun 2025. FSA open data (Open Government Licence v3.0), read 16 Oct 2026.",
    );
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("venueId=venue-lamb");
  });
});
