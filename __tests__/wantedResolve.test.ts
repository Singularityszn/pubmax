import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/venueIndex", () => ({
  getVenueIndex: async () =>
    new Map([
      [
        "venue-dove",
        {
          id: "venue-dove",
          name: "The Dove",
          borough: "Hammersmith",
          lat: 51.49,
          lng: -0.23,
        },
      ],
      [
        "venue-churchill",
        {
          id: "venue-churchill",
          name: "The Churchill Arms",
          borough: "Kensington",
          lat: 51.5,
          lng: -0.19,
        },
      ],
    ]),
}));

import { __setUkNationalPubSearchIndexForTests } from "@/lib/ukNationalPubSearch.server";
import { resolveWantedPaste } from "@/lib/wantedResolve.server";

beforeEach(() => {
  __setUkNationalPubSearchIndexForTests({
    pubs: [
      ["n111", "The Village Arms", "Somewhere, UK", 51.2, -1.1],
      ["n222", "Dove Cottage Inn", "Elsewhere, UK", 52.1, -0.5],
    ],
  });
});

afterEach(() => {
  __setUkNationalPubSearchIndexForTests(null);
  vi.restoreAllMocks();
});

describe("resolveWantedPaste", () => {
  it("returns curated and uk-base candidates for a name", async () => {
    const result = await resolveWantedPaste("Dove");
    expect(result.status).toBe("ready");
    expect(result.query).toBe("Dove");
    const ids = result.candidates.map((c) => c.venueId);
    expect(ids).toContain("venue-dove");
    expect(ids.some((id) => id.startsWith("venue-uk-"))).toBe(true);
    expect(result.candidates.find((c) => c.venueId === "venue-dove")?.venueKind).toBe(
      "curated",
    );
  });

  it("resolves a bare YouTube URL through its public oEmbed title", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          title: "The Dove",
          author_name: "Pub guide",
          html: "<script>alert('must not cross the boundary')</script>",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await resolveWantedPaste("https://www.youtube.com/watch?v=abc123");

    expect(result.status).toBe("ready");
    expect(result.query).toBe("The Dove");
    expect(result.candidates.map((candidate) => candidate.venueId)).toContain("venue-dove");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("https://www.youtube.com/oembed?"),
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("does not fetch an unapproved source host", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const result = await resolveWantedPaste("https://evil.example/reel/abc");

    expect(result.status).toBe("ready");
    expect(result.candidates).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not send non-HTTPS or non-default-port provider URLs upstream", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const result = await resolveWantedPaste("http://www.youtube.com:8080/watch?v=abc123");

    expect(result.status).toBe("degraded");
    expect(result.candidates).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns degraded when provider metadata cannot be read", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("upstream unavailable", {
        status: 503,
        headers: { "content-type": "text/plain" },
      }),
    );

    const result = await resolveWantedPaste("https://www.youtube.com/watch?v=abc123");

    expect(result.status).toBe("degraded");
    expect(result.candidates).toEqual([]);
  });

  it("keeps arbitrary social URLs as provenance without server-side fetch", async () => {
    const result = await resolveWantedPaste("https://www.instagram.com/reel/abc/");
    expect(result.candidates).toEqual([]);
    expect(result.sourceUrl).toContain("instagram.com");
    expect(result.query).toBe("");
  });

  it("returns empty candidates for an unresolvable name", async () => {
    const result = await resolveWantedPaste("zzzzz-no-such-pub-xyzzy");
    expect(result.candidates).toEqual([]);
    expect(result.query.length).toBeGreaterThan(2);
  });
});
