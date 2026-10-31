// The Year in Pints card and the shared page behind a "Share my year" link.
// Both read the link and nothing else, and both name a pub only from the venue
// dataset, so a link cannot put words of its own on either.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { lookupCanonicalVenue, lookupRetiredIndexedVenue } = vi.hoisted(() => ({
  lookupCanonicalVenue: vi.fn(),
  lookupRetiredIndexedVenue: vi.fn(),
}));

vi.mock("@/lib/venueIndex", () => ({ lookupCanonicalVenue, lookupRetiredIndexedVenue }));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});

import { GET } from "@/app/api/year-card/route";
import { generateMetadata } from "@/app/year-in-pints/[year]/page";
import { __resetPintDrops } from "@/lib/pintDrops";
import { yearShareVenueNames } from "@/lib/yearInPints.server";

function found(id: string, name: string) {
  return { status: "found", canonicalId: id, venue: { id, name, borough: "Camden", lat: 51.5, lng: -0.1 }, slimVenue: {} };
}

beforeEach(() => {
  lookupCanonicalVenue.mockReset();
  lookupRetiredIndexedVenue.mockReset();
  __resetPintDrops();
});

describe("yearShareVenueNames", () => {
  it("names a pub from the dataset, keeps a closed pub's name, and leaves an unknown id out", async () => {
    lookupCanonicalVenue.mockImplementation(async (id: string) => {
      if (id === "venue-crown") return found(id, "The Crown");
      return { status: "unknown", canonicalId: id };
    });
    lookupRetiredIndexedVenue.mockImplementation(async (id: string) =>
      id === "venue-lamb" ? { venue: { id, name: "The Lamb" }, slimVenue: {} } : null,
    );
    const names = await yearShareVenueNames({
      year: 2026,
      through: 10,
      favourite: { venueId: "venue-crown", visits: 2 },
      first: { day: "2026-02-20", venueId: "venue-lamb" },
    });
    expect(names).toEqual({ "venue-crown": "The Crown", "venue-lamb": "The Lamb" });
    expect(
      await yearShareVenueNames({ year: 2026, through: 10, favourite: { venueId: "venue-gone", visits: 2 } }),
    ).toEqual({});
  });

  it("never throws on a failed read", async () => {
    lookupCanonicalVenue.mockRejectedValue(new Error("disk"));
    expect(
      await yearShareVenueNames({ year: 2026, through: 10, favourite: { venueId: "venue-crown", visits: 2 } }),
    ).toEqual({});
  });
});

describe("GET /api/year-card", () => {
  function get(query: string, ip: string) {
    return GET(new Request(`http://localhost/api/year-card?${query}`, { headers: { "x-forwarded-for": ip } }));
  }

  it("draws a PNG for a shared year", async () => {
    lookupCanonicalVenue.mockResolvedValue(found("venue-crown", "The Crown"));
    const response = await get("y=2026&to=10&n=3&m=10&s=4&fv=venue-crown&fc=2&p=12&b=3", "198.51.100.80");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toContain("s-maxage=3600");
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
    expect(lookupCanonicalVenue).toHaveBeenCalledWith("venue-crown");
  });

  it("draws the plain poster for a link it cannot read, never an error", async () => {
    expect((await get("", "198.51.100.81")).status).toBe(200);
    expect((await get("y=2099&to=1&n=3", "198.51.100.81")).status).toBe(200);
    expect(lookupCanonicalVenue).not.toHaveBeenCalled();
  });
});

describe("the shared page's preview", () => {
  function props(year: string, search: Record<string, string | string[]>) {
    return { params: Promise.resolve({ year }), searchParams: Promise.resolve(search) };
  }

  it("previews the card for the lines the link holds, and is never indexed", async () => {
    const metadata = await generateMetadata(props("2026", { to: "10", n: "3", p: "12", b: "3", handle: "old_ken" }));
    expect(metadata.title).toBe("My 2026 so far");
    expect(metadata.robots).toEqual({ index: false, follow: true });
    expect(metadata.openGraph?.images).toEqual([
      { url: "/api/year-card?y=2026&to=10&n=3&p=12&b=3", width: 1200, height: 630, alt: "My 2026 so far, a Year in Pints card" },
    ]);
    expect(JSON.stringify(metadata)).not.toContain("old_ken");
  });

  it("reads the first value of a repeated key, and falls back to the plain card", async () => {
    const repeated = await generateMetadata(props("2026", { to: ["10", "1"], n: ["3", "300"] }));
    expect(repeated.openGraph?.images).toEqual([
      expect.objectContaining({ url: "/api/year-card?y=2026&to=10&n=3" }),
    ]);
    const unreadable = await generateMetadata(props("nope", {}));
    expect(unreadable.title).toBe("A Year in Pints");
    expect(unreadable.openGraph?.images).toEqual([expect.objectContaining({ url: "/api/year-card" })]);
  });
});
