import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { GET } from "@/app/api/venue/[id]/route";
import {
  resetVenueDetailCachesForTests,
  setVenueDetailRowsFileForTests,
} from "@/lib/venueDetailIndex";
import { resetVenueAliasesForTests } from "@/lib/venueAliases";
import { resetUkPriceBundleForTests } from "@/lib/ukPriceBundle.server";
import { isValidUkPriceBundleRow } from "@/lib/ukPriceBundle";
import type { SlimVenue } from "@/lib/venuesSlim";

const ROOT = path.resolve(__dirname, "..");
const SLIM_PATH = path.join(ROOT, "public", "data", "venues_slim.json");
const slimPayload = JSON.parse(readFileSync(SLIM_PATH, "utf8")) as { rows?: SlimVenue[] };
const slim = slimPayload.rows ?? [];

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  resetVenueDetailCachesForTests();
  resetVenueAliasesForTests();
  resetUkPriceBundleForTests();
});

describe("GET /api/venue/[id]", () => {
  it("returns full detail for a slim venue id", async () => {
    const seed = slim.find((venue) => venue.id === "venue-16pnwmm") ?? slim[0];
    const res = await GET(new Request(`http://localhost/api/venue/${seed.id}`), ctx(seed.id));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.venue.id).toBe(seed.id);
    expect(body.venue.name).toBe(seed.name);
    expect(Array.isArray(body.venue.prices)).toBe(true);
    expect(body.venue.prices.length).toBeGreaterThan(0);
    expect(body.venue.address.length).toBeGreaterThan(0);
  });

  // WHAT THE BUNDLE HOLDS RIDES ON THE DETAIL THE SHEET ALREADY FETCHES, so a
  // pub's published or modelled price costs no second request. The field is an
  // object or null and never absent, because a sheet that cannot tell "no price"
  // from "we could not look" words one as the other.
  it("carries what the UK price bundle holds about the pub", async () => {
    const bundle = JSON.parse(
      readFileSync(path.join(ROOT, "public", "data", "uk_prices", "rows.json"), "utf8"),
    ) as unknown[];
    const priced = bundle.filter(isValidUkPriceBundleRow).find((row) => row.category === "beer");
    expect(priced, "the bundle must hold a beer row for this to mean anything").toBeTruthy();

    const seed = slim.find((venue) => venue.id === priced?.venueId) ?? slim[0];
    const res = await GET(new Request(`http://localhost/api/venue/${seed.id}`), ctx(seed.id));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.venue).toHaveProperty("bundlePrices");
    expect(body.venue.bundlePrices).not.toBeUndefined();
    if (body.venue.bundlePrices?.listed) {
      expect(body.venue.bundlePrices.listed.sourceUrl).toMatch(/^https?:\/\//);
      expect(Number.isFinite(Date.parse(body.venue.bundlePrices.listed.observedAt))).toBe(true);
    }
    if (body.venue.bundlePrices?.estimate) {
      expect(body.venue.bundlePrices.estimate.sampleSize).toBeGreaterThan(0);
      expect(body.venue.bundlePrices.estimate.basis.length).toBeGreaterThan(0);
    }
  });

  // THE VENUE TRUTH CONTRACT ON THE WIRE (Astra finding F03). The response used
  // to carry four unvalidated contact columns per source row, all-false
  // amenities over blank columns, and a "likely" get-in over an unknown door.
  it("publishes a sanitized contact contract and no raw contact columns", async () => {
    // The audited pub: its phone column holds a website URL with a globe emoji.
    const res = await GET(
      new Request("http://localhost/api/venue/venue-p7p18j"),
      ctx("venue-p7p18j"),
    );
    const body = await res.json();
    expect(res.status).toBe(200);

    expect(body.venue.contacts).toBeDefined();
    expect(body.venue.contacts.phoneNumber).toBeNull();
    expect(body.venue.contacts.phoneHref).toBeNull();
    expect(body.venue.contacts.websiteHref).toBe("https://www.lsesu.com/social/three-tuns/");

    for (const row of body.venue.prices) {
      expect(row).not.toHaveProperty("phone_number");
      expect(row).not.toHaveProperty("email");
      expect(row).not.toHaveProperty("website");
      expect(row).not.toHaveProperty("booking_link");
    }
    // Nothing anywhere in the body may look like a dialable value built from
    // something that is not a telephone number.
    expect(JSON.stringify(body)).not.toContain("tel:");
  });

  it("says what the source states about each amenity, and never invents a No", async () => {
    const res = await GET(
      new Request("http://localhost/api/venue/venue-p7p18j"),
      ctx("venue-p7p18j"),
    );
    const body = await res.json();
    expect(body.venue.amenityStatus).toBeDefined();
    // Every column on this pub is blank, so every answer is unknown and not one
    // is false. The booleans stay for the filter machinery that already reads a
    // false as "not known to be true".
    for (const [key, status] of Object.entries(body.venue.amenityStatus)) {
      expect(status, key).toBe("unknown");
    }
  });

  it("will not say a group is likely to get in over an unknown door", async () => {
    const res = await GET(
      new Request("http://localhost/api/venue/venue-p7p18j?groupSize=2"),
      ctx("venue-p7p18j"),
    );
    const body = await res.json();
    // The route holds no opening hours and no door reports for any pub today,
    // so the honest answer is that we cannot say.
    expect(body.busyness.isOpen).toBe("unknown");
    expect(body.busyness.reportCount).toBe(0);
    expect(body.getIn.fit).toBe("unknown");
    expect(body.getIn.confidence).toBe("unknown");
    expect(body.getIn.label).toBe("Check before going");
    expect(body.getIn.reason).not.toContain("should get in fine");
  });

  it("returns a friendly 404 for an unknown venue id", async () => {
    const res = await GET(
      new Request("http://localhost/api/venue/venue-does-not-exist"),
      ctx("venue-does-not-exist"),
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ error: "Venue not found.", code: "NOT_FOUND", retryable: false });
  });

  it("returns 503 when a known venue cannot be checked", async () => {
    const seed = slim.find((venue) => venue.id === "venue-16pnwmm") ?? slim[0];
    setVenueDetailRowsFileForTests(path.join(ROOT, "data", "generated", "missing-details.jsonl"));

    const res = await GET(new Request(`http://localhost/api/venue/${seed.id}`), ctx(seed.id));

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: "Venue details unavailable.", code: "UNAVAILABLE", retryable: true });
  });
});
