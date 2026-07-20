import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

// Plain ESM build-time script. Its exported normalisers are exercised only
// with fixtures; these tests never contact Exa or Firecrawl.
import {
  ProviderHaltError,
  buildPlaceRows,
  classifyProviderFailure,
  fetchDiscoveries,
  mergePlaceRows,
  normalizeSourceUrl,
  parseJsonLdBlocks,
  sourcePageToPlace,
} from "@/scripts/ingest_night_out_places.mjs";

const OBSERVED_AT = "2026-07-20T12:00:00.000Z";

function jsonLdPage(value: unknown): string {
  return `<html><head><script type="application/ld+json">${JSON.stringify(value)}</script></head></html>`;
}

const restaurant = {
  "@context": "https://schema.org",
  "@type": "Restaurant",
  name: "The Test Kitchen",
  description: "A neighbourhood restaurant serving a short seasonal menu from an open kitchen.",
  url: "https://example.com/london/test-kitchen",
  address: {
    "@type": "PostalAddress",
    streetAddress: "1 Test Street",
    addressLocality: "Soho",
    postalCode: "W1D 3QF",
  },
  geo: { "@type": "GeoCoordinates", latitude: 51.513, longitude: -0.131 },
};

describe("night-out place ingestion", () => {
  it("normalises attributable HTTPS source URLs", () => {
    expect(normalizeSourceUrl("https://example.com/london/test-kitchen/?utm=x#menu")).toBe(
      "https://example.com/london/test-kitchen",
    );
    expect(normalizeSourceUrl("http://example.com/place")).toBeNull();
    expect(normalizeSourceUrl("https://user:pass@example.com/place")).toBeNull();
    expect(normalizeSourceUrl("https://localhost/place")).toBeNull();
    expect(normalizeSourceUrl("https://127.0.0.1/place")).toBeNull();
  });

  it("extracts JSON-LD blocks and ignores malformed neighbours", () => {
    const html = `<script type="application/ld+json">{broken}</script>${jsonLdPage({
      "@graph": [restaurant],
    })}`;
    expect(parseJsonLdBlocks(html).some((row: { name?: string }) => row.name === restaurant.name)).toBe(true);
  });

  it("publishes only source-page facts with source, observation and expiry", () => {
    const row = sourcePageToPlace(
      {
        url: "https://example.com/london/test-kitchen?utm_source=exa",
        rawHtml: jsonLdPage(restaurant),
      },
      { category: "restaurant", discoveredVia: "exa", observedAt: OBSERVED_AT },
    );
    expect(row).toMatchObject({
      category: "restaurant",
      job: "near_pub_food",
      name: restaurant.name,
      sourceUrl: "https://example.com/london/test-kitchen",
      sourceName: "example.com",
      observedAt: OBSERVED_AT,
      discoveredVia: "exa",
      extractedVia: "firecrawl",
    });
    if (!row) throw new Error("fixture row should pass the ingest contract");
    expect(Date.parse(row.expiresAt) - Date.parse(row.observedAt)).toBe(30 * 24 * 60 * 60 * 1_000);
  });

  it("drops slop, incomplete provenance, missing coordinates and out-of-London rows", () => {
    const cases = [
      { ...restaurant, description: "Welcome to our vibrant hidden gem!" },
      { ...restaurant, geo: undefined },
      { ...restaurant, geo: { latitude: 53.48, longitude: -2.24 } },
    ];
    for (const value of cases) {
      expect(
        sourcePageToPlace(
          { url: "https://example.com/london/test-kitchen", rawHtml: jsonLdPage(value) },
          { category: "restaurant", discoveredVia: "firecrawl", observedAt: OBSERVED_AT },
        ),
      ).toBeNull();
    }
    expect(
      sourcePageToPlace(
        { url: null, rawHtml: jsonLdPage(restaurant) },
        { category: "restaurant", discoveredVia: "exa", observedAt: OBSERVED_AT },
      ),
    ).toBeNull();
  });

  it("keeps restaurant and attraction jobs separate and dedupes stable source rows", () => {
    const attraction = {
      ...restaurant,
      "@type": "Museum",
      name: "The Test Museum",
      description: "A small public collection documenting the area's printing history since 1890.",
      url: "https://museum.example/visit",
    };
    const rows = buildPlaceRows(
      [
        { category: "restaurant", discoveredVia: "exa", url: restaurant.url, rawHtml: jsonLdPage(restaurant) },
        { category: "restaurant", discoveredVia: "exa", url: restaurant.url, rawHtml: jsonLdPage(restaurant) },
        { category: "attraction", discoveredVia: "firecrawl", url: attraction.url, rawHtml: jsonLdPage(attraction) },
      ],
      { observedAt: OBSERVED_AT },
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((row: { job: string }) => row.job).sort()).toEqual([
      "near_pub_food",
      "pre_pub_attraction",
    ]);
  });

  it("does not replace current trusted rows when a refresh yields nothing", () => {
    const existing = buildPlaceRows(
      [{ category: "restaurant", discoveredVia: "exa", url: restaurant.url, rawHtml: jsonLdPage(restaurant) }],
      { observedAt: OBSERVED_AT },
    );
    expect(mergePlaceRows(existing, [])).toEqual(existing);
  });

  it("halts loudly before any fetch when either owner-funded key is absent", async () => {
    const fetchMock = vi.fn();
    await expect(
      fetchDiscoveries({ exaKey: "", firecrawlKey: "fc-test" }, fetchMock),
    ).rejects.toMatchObject({ name: "ProviderHaltError", provider: "Exa" });
    await expect(
      fetchDiscoveries({ exaKey: "exa-test", firecrawlKey: "" }, fetchMock),
    ).rejects.toMatchObject({ name: "ProviderHaltError", provider: "Firecrawl" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("classifies authentication, credits and rate limits as owner-action halts", () => {
    for (const [status, phrase] of [
      [401, "authentication"],
      [402, "credits"],
      [429, "limit"],
    ] as const) {
      const error = classifyProviderFailure("Firecrawl", status);
      expect(error).toBeInstanceOf(ProviderHaltError);
      expect(error.message).toContain("OWNER ACTION");
      expect(error.message).toContain(phrase);
      expect(error.message).toContain("Artifact not written");
    }
  });

  it("keeps the producer registry explicit and fail-closed", () => {
    const registry = JSON.parse(
      readFileSync(join(process.cwd(), "data", "night_out_place_provenance_registry.json"), "utf8"),
    );
    expect(registry.version).toBe(1);
    expect(registry.producers.map((provider: { id: string }) => provider.id).sort()).toEqual([
      "exa",
      "firecrawl",
    ]);
    expect(registry.producers.find((provider: { id: string }) => provider.id === "exa").mayPublishFacts).toBe(false);
    expect(registry.producers.find((provider: { id: string }) => provider.id === "firecrawl").factSource).toBe(
      "source_page_json_ld_only",
    );
  });
});
