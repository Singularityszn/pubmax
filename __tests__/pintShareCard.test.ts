// The pint share card and the /map document behind a "Share this pint" link
// (P2-C). The card reads the pint from the dataset, never from the link, and a
// figure is drawn only with its publisher and read day.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { lookupVenueDetail } = vi.hoisted(() => ({ lookupVenueDetail: vi.fn() }));

vi.mock("@/lib/venueDetailIndex", () => ({
  lookupVenueDetail,
  isVenueDetailId: (id: string) => /^venue-[a-z0-9-]+$/.test(id),
}));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});

import { GET } from "@/app/api/pint-card/route";
import { __resetPintDrops } from "@/lib/pintDrops";
import { pintShareMetadata, resolvePintShare } from "@/lib/pintShare.server";

const READ = "2026-10-02T10:00:00.000Z";

function pub(overrides: Record<string, unknown> = {}) {
  return {
    id: "venue-crosse-keys",
    name: "The Crosse Keys",
    locality: "City of London",
    primaryBorough: "City of London",
    cheapestPrice: 2.99,
    prices: [
      {
        app_price_id: "p1",
        pint_name: "Lager",
        price_gbp: 2.99,
        pub_url: "https://www.pint-prices.com/pub/crosse-keys",
        scraped_at_values: READ,
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  lookupVenueDetail.mockReset();
  __resetPintDrops();
});

describe("resolvePintShare", () => {
  it("reads the figure, its publisher and its day from the dataset", async () => {
    lookupVenueDetail.mockResolvedValue({ status: "found", venue: pub() });
    const { venue, share } = await resolvePintShare("venue-crosse-keys");
    expect(venue).toEqual({ id: "venue-crosse-keys", name: "The Crosse Keys", area: "City of London" });
    expect(share).toEqual({
      venueId: "venue-crosse-keys",
      name: "The Crosse Keys",
      area: "City of London",
      priceGbp: 2.99,
      publisher: "Pint Prices",
      readDay: "2 Oct",
    });
  });

  it("keeps the pub but drops the figure when its row records no read", async () => {
    lookupVenueDetail.mockResolvedValue({
      status: "found",
      venue: pub({ prices: [{ price_gbp: 2.99, pub_url: "https://www.pint-prices.com/pub/x" }] }),
    });
    const { venue, share } = await resolvePintShare("venue-crosse-keys");
    expect(venue?.name).toBe("The Crosse Keys");
    expect(share).toBeNull();
  });

  it("answers nothing for an unknown, malformed or unreadable id", async () => {
    lookupVenueDetail.mockResolvedValueOnce({ status: "missing" });
    expect(await resolvePintShare("venue-gone")).toEqual({ venue: null, share: null });
    expect(await resolvePintShare("../../etc")).toEqual({ venue: null, share: null });
    lookupVenueDetail.mockRejectedValueOnce(new Error("disk"));
    expect(await resolvePintShare("venue-crosse-keys")).toEqual({ venue: null, share: null });
  });
});

describe("pintShareMetadata", () => {
  it("previews the pub's own card and states the price with its source", async () => {
    lookupVenueDetail.mockResolvedValue({ status: "found", venue: pub() });
    const metadata = await pintShareMetadata("venue-crosse-keys");
    expect(metadata?.title).toBe("The Crosse Keys, City of London");
    expect(metadata?.description).toBe(
      "£2.99 a pint at The Crosse Keys (listed by Pint Prices, 2 Oct).",
    );
    expect(metadata?.openGraph).toMatchObject({
      url: "/map?sel=venue-crosse-keys&card=pint",
      images: [{ url: "/api/pint-card?venue=venue-crosse-keys", width: 1200, height: 630 }],
    });
  });

  it("names the pub with no figure when the price cannot carry its source", async () => {
    lookupVenueDetail.mockResolvedValue({
      status: "found",
      venue: pub({ prices: [{ price_gbp: 2.99, pub_url: "", scraped_at_values: READ }] }),
    });
    const metadata = await pintShareMetadata("venue-crosse-keys");
    expect(metadata?.description).toBe("The Crosse Keys on the PUBMAXX pub map.");
    expect(String(metadata?.description)).not.toContain("£");
  });

  it("leaves the plain map card in place for an id that names no pub", async () => {
    lookupVenueDetail.mockResolvedValue({ status: "missing" });
    expect(await pintShareMetadata("venue-gone")).toBeNull();
  });
});

describe("GET /api/pint-card", () => {
  function get(query: string, ip: string) {
    return GET(
      new Request(`http://localhost/api/pint-card?${query}`, {
        headers: { "x-forwarded-for": ip },
      }),
    );
  }

  it("draws a PNG for a listed pint", async () => {
    lookupVenueDetail.mockResolvedValue({ status: "found", venue: pub() });
    const response = await get("venue=venue-crosse-keys", "198.51.100.70");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toContain("s-maxage=3600");
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  it("still draws a poster for an unknown pub or no id, never an error", async () => {
    lookupVenueDetail.mockResolvedValue({ status: "missing" });
    expect((await get("venue=venue-gone", "198.51.100.71")).status).toBe(200);
    expect((await get("", "198.51.100.71")).status).toBe(200);
  });

  it("asks the dataset for the pub and ignores any price in the query", async () => {
    lookupVenueDetail.mockResolvedValue({ status: "found", venue: pub() });
    await get("venue=venue-crosse-keys&price=0.50", "198.51.100.72");
    expect(lookupVenueDetail).toHaveBeenCalledWith("venue-crosse-keys");
  });
});
