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
