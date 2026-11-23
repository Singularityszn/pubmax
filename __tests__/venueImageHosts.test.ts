import { afterEach, describe, expect, it } from "vitest";

import {
  __resetVenueImageHosts,
  allowedVenueImageHosts,
} from "@/lib/venueImageHosts.server";

// Regression guard for the /pubs 8x-400 defect: the proxy's SSRF allowlist is
// built from the app's committed datasets, and every dataset the app actually
// issues image URLs FROM must be in that build set. pint_prices_app_dataset.json
// (venue.imageUrl — Google Places photos) was missing, so /api/image-proxy
// rejected its own app-rendered photo URLs with 400.

afterEach(() => __resetVenueImageHosts());

describe("allowedVenueImageHosts", () => {
  it("covers the venue-photo host the pint-prices dataset issues (lh3.googleusercontent.com)", () => {
    const hosts = allowedVenueImageHosts();
    expect(hosts.has("lh3.googleusercontent.com")).toBe(true);
  });

  it("covers the photo host the menu enrichment tiles issue", () => {
    const hosts = allowedVenueImageHosts();
    expect(hosts.has("gkbr-p-001.sitecorecontenthub.cloud")).toBe(true);
    expect(hosts.size).toBeGreaterThan(10);
  });

  it("excludes link and free-text hosts that are not photos", () => {
    const hosts = allowedVenueImageHosts();
    // Seed snapshot links and discount text, and enrichment menu links. The
    // last one is a truncated, unregistered domain read out of free text.
    for (const host of [
      "bit.ly",
      "github.com",
      "www.facebook.com",
      "en.wikipedia.org",
      "www.theeaglew12.co.uk",
      "www.britanniakensington.co",
    ]) {
      expect(hosts.has(host), host).toBe(false);
    }
  });

  it("excludes third-party pub website/booking/pub_url hosts from pint_prices_app_dataset.json", () => {
    const hosts = allowedVenueImageHosts();
    // These are non-photo fields on the same dataset row (Delicio,
    // Bexleyheath) — the allowlist must only pick up the `image_url` field,
    // not every https URL in the file, or it becomes an SSRF allowlist for
    // ~hundreds of arbitrary pub websites.
    expect(hosts.has("www.deliciobexleyheath.co.uk")).toBe(false);
    expect(hosts.has("www.pint-prices.com")).toBe(false);
  });
});
