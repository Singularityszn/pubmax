import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { GET } from "@/app/api/venue/[id]/route";
import {
  resetVenueDetailCachesForTests,
  setVenueDetailIndexFileForTests,
  setVenueDetailRowsFileForTests,
} from "@/lib/venueDetailIndex";
import { resetVenueAliasesForTests } from "@/lib/venueAliases";
import { resetUkPriceBundleForTests } from "@/lib/ukPriceBundle.server";
import { isValidUkPriceBundleRow } from "@/lib/ukPriceBundle";
import { venueFromDetailPayload } from "@/lib/venues";
import type { SlimVenue } from "@/lib/venuesSlim";
import { defined } from "@/__tests__/helpers/defined";

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
  it("answers a pub that left the map as not found, unless the reader asks to name it", async () => {
    // The Duck, Birmingham: retired in public/data/cities/venue_id_aliases.json.
    const id = "venue-bhm-17j3xm7";
    const plain = await GET(new Request(`http://localhost/api/venue/${id}`), ctx(id));
    expect(plain.status).toBe(404);

    const named = await GET(
      new Request(`http://localhost/api/venue/${id}?include_retired=1`),
      ctx(id),
    );
    expect(named.status).toBe(200);
    const body = (await named.json()) as { venue: { name: string; retired?: boolean } };
    expect(body.venue).toMatchObject({ name: "The Duck", retired: true });
  });

  it("returns full detail for a slim venue id", async () => {
    const seed = slim.find((venue) => venue.id === "venue-16pnwmm") ?? slim[0];
    const res = await GET(new Request(`http://localhost/api/venue/${defined(seed).id}`), ctx(defined(seed).id));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.venue.id).toBe(defined(seed).id);
    expect(body.venue.name).toBe(defined(seed).name);
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
    const res = await GET(new Request(`http://localhost/api/venue/${defined(seed).id}`), ctx(defined(seed).id));
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
    // is false.
    for (const [key, status] of Object.entries(body.venue.amenityStatus)) {
      expect(status, key).toBe("unknown");
    }
    // AND THE BOOLEANS ARE NOT ON THE WIRE. They stay on the record for the
    // filter machinery, which already reads a false as "not known to be true";
    // an API caller has no such rule, so shipping `"food": false` beside
    // `"food": "unknown"` published an invented negative about a blank column.
    expect(body.venue).not.toHaveProperty("amenities");
    expect(JSON.stringify(body)).not.toContain('"amenities"');
  });

  it("hands the browser back a record built from the status, never an invented No", async () => {
    // The map's own filters and scores read a false as "not known to be true",
    // so the browser rebuilds that record from the answer the wire carries.
    // Only a stated presence becomes true, which is why nothing is invented on
    // the way back in.
    const res = await GET(
      new Request("http://localhost/api/venue/venue-p7p18j"),
      ctx("venue-p7p18j"),
    );
    const body = await res.json();
    const venue = venueFromDetailPayload(body.venue);
    expect(venue.amenityStatus).toEqual(body.venue.amenityStatus);
    for (const [key, stated] of Object.entries(venue.amenities)) {
      expect(stated, key).toBe(false);
      expect(venue.amenityStatus?.[key as keyof typeof venue.amenities], key).toBe("unknown");
    }
    // And a stated presence survives the round trip as a true.
    const stated = venueFromDetailPayload({
      ...body.venue,
      amenityStatus: { ...body.venue.amenityStatus, beerGarden: "known-true" },
    });
    expect(stated.amenities.beerGarden).toBe(true);
    expect(stated.amenities.food).toBe(false);
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
    // The generated manifest is a gitignored build artifact. Without one the
    // route takes the dev fallback and answers 200, so this case brings its own:
    // the manifest names the pub and the rows file it points at is gone.
    const dir = mkdtempSync(path.join(tmpdir(), "venue-route-"));
    const manifest = path.join(dir, "venue_detail_index.json");
    writeFileSync(
      manifest,
      JSON.stringify({
        version: 1,
        detailsFile: "venue_details.jsonl",
        count: 1,
        venues: { [defined(seed).id]: { offset: 0, length: 64 } },
      }),
    );
    setVenueDetailIndexFileForTests(manifest);
    setVenueDetailRowsFileForTests(path.join(dir, "venue_details.jsonl"));

    const res = await GET(new Request(`http://localhost/api/venue/${defined(seed).id}`), ctx(defined(seed).id));

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: "Venue details unavailable.", code: "UNAVAILABLE", retryable: true });
  });
});
