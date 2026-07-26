import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  isValidNightOutPlaceSnapshot as isValidRuntimeSnapshot,
} from "@/lib/nightOutPlaces";
import {
  isValidNightOutPlaceSnapshot as isValidContractSnapshot,
} from "@/lib/nightOutPlaceContract.mjs";

// Plain ESM build-time script. Its exported normalisers are exercised only
// with fixtures; these tests never contact Exa or Firecrawl.
import {
  ProviderHaltError,
  assertAdvisoryPublicResolution,
  buildPlaceRows,
  classifyProviderFailure,
  fetchDiscoveries,
  isPublicIpAddress,
  isValidPlaceSnapshot,
  loadCurrentPlaces,
  mergePlaceRows,
  normalizeSourceUrl,
  parseJsonLdBlocks,
  runIngestion,
  sourcePageToPlace,
  writeSnapshot,
} from "@/scripts/ingest_night_out_places.mjs";

const OBSERVED_AT = "2026-07-20T12:00:00.000Z";

function jsonLdPage(value: unknown): string {
  return `<html><head><script type="application/ld+json">${JSON.stringify(value)}</script></head></html>`;
}

function firecrawlPage(url: string, rawHtml: string, metadata: Record<string, unknown> = {}) {
  return {
    url,
    rawHtml,
    metadata: {
      sourceURL: url,
      url,
      statusCode: 200,
      ...metadata,
    },
  };
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
  it("keeps ingest, runtime and authoritative snapshot validation in parity", () => {
    const [row] = buildPlaceRows(
      [{ category: "restaurant", discoveredVia: "exa", url: restaurant.url, rawHtml: jsonLdPage(restaurant) }],
      { observedAt: OBSERVED_AT },
    );
    const valid = {
      version: 1,
      generatedAt: OBSERVED_AT,
      status: "published",
      provenanceRegistryVersion: 1,
      places: [row],
    };
    const candidates = [
      valid,
      { ...valid, places: [{ ...row, job: "pre_pub_attraction" }] },
      { ...valid, places: [{ ...row, location: { lat: 53.48, lng: -2.24 } }] },
      { ...valid, places: [{ ...row, description: "Welcome to this vibrant hidden gem!" }] },
      { ...valid, places: [{ ...row, sourceName: "not-example.com" }] },
      { ...valid, places: [{ ...row, expiresAt: "2027-07-20T12:00:00.000Z" }] },
    ];

    for (const candidate of candidates) {
      const decisions = [
        isValidPlaceSnapshot(candidate),
        isValidRuntimeSnapshot(candidate),
        isValidContractSnapshot(candidate),
      ];
      expect(new Set(decisions).size, JSON.stringify(candidate)).toBe(1);
    }
    expect(isValidPlaceSnapshot(valid)).toBe(true);
    expect(isValidPlaceSnapshot(candidates[1])).toBe(false);
  });

  it("normalises attributable HTTPS source URLs", () => {
    expect(normalizeSourceUrl("https://example.com/london/test-kitchen/?utm=x#menu")).toBe(
      "https://example.com/london/test-kitchen",
    );
    expect(normalizeSourceUrl("http://example.com/place")).toBeNull();
    expect(normalizeSourceUrl("https://user:pass@example.com/place")).toBeNull();
    expect(normalizeSourceUrl("https://localhost/place")).toBeNull();
    expect(normalizeSourceUrl("https://localhost./place")).toBeNull();
    expect(normalizeSourceUrl("https://service.localhost/place")).toBeNull();
    expect(normalizeSourceUrl("https://127.0.0.1/place")).toBeNull();
    expect(normalizeSourceUrl("https://0x7f000001/place")).toBeNull();
    expect(normalizeSourceUrl("https://[::1]/place")).toBeNull();
    expect(normalizeSourceUrl("https://example.com:8443/place")).toBeNull();
    expect(normalizeSourceUrl("https://example.com/place?b=2&utm_source=x&a=1#g")).toBe(
      "https://example.com/place?a=1&b=2",
    );
    expect(normalizeSourceUrl("https://example.com/place?id=A&gclid=x&fbclid=y")).toBe(
      "https://example.com/place?id=A",
    );
    expect(normalizeSourceUrl("https://example.com/place?id=A")).not.toBe(
      normalizeSourceUrl("https://example.com/place?id=B"),
    );
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

  it("requires exact canonical JSON-LD page attribution", () => {
    for (const value of [
      { ...restaurant, url: undefined },
      { ...restaurant, url: "https://example.com/london/venue-b" },
      { ...restaurant, url: `${restaurant.url}?id=B` },
    ]) {
      expect(
        sourcePageToPlace(
          {
            url: value.url?.includes("?id=") ? `${restaurant.url}?id=A` : "https://example.com/london/venue-a",
            rawHtml: jsonLdPage(value),
          },
          { category: "restaurant", discoveredVia: "exa", observedAt: OBSERVED_AT },
        ),
      ).toBeNull();
    }
    expect(
      sourcePageToPlace(
        {
          url: restaurant.url,
          rawHtml: jsonLdPage([restaurant, { ...restaurant, name: "Another venue" }]),
        },
        { category: "restaurant", discoveredVia: "exa", observedAt: OBSERVED_AT },
      ),
    ).toBeNull();
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

  it("uses DNS as an advisory public-resolution preflight without claiming a pin", async () => {
    const lookup = vi
      .fn()
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValueOnce([{ address: "1.1.1.1", family: 4 }])
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    await expect(assertAdvisoryPublicResolution("https://example.com/venue", lookup)).resolves.toBe(
      "https://example.com/venue",
    );
    await expect(assertAdvisoryPublicResolution("https://example.com/venue", lookup)).resolves.toBe(
      "https://example.com/venue",
    );
    await expect(assertAdvisoryPublicResolution("https://example.com/venue", lookup)).rejects.toThrow(
      "OWNER ACTION",
    );
  });

  it("rejects private, loopback, link-local and mapped DNS answers", () => {
    for (const address of [
      "10.0.0.1",
      "0.0.0.0",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.1.1",
      "172.16.0.1",
      "192.168.0.1",
      "192.88.99.1",
      "192.0.2.1",
      "198.18.0.1",
      "198.51.100.1",
      "203.0.113.1",
      "224.0.0.1",
      "240.0.0.1",
      "255.255.255.255",
      "::",
      "::1",
      "fc00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
      "2001:2::1",
      "2001:10::1",
      "2001:db8::1",
      "64:ff9b::1",
      "2001::1",
      "2002::1",
      "ff00::1",
    ]) {
      expect(isPublicIpAddress(address), address).toBe(false);
    }
    expect(isPublicIpAddress("93.184.216.34")).toBe(true);
    expect(isPublicIpAddress("2606:2800:220:1:248:1893:25c8:1946")).toBe(true);
  });

  it("requires a live uncached TLS-verified Firecrawl fetch", async () => {
    const requests: Array<{
      url: string;
      body: Record<string, unknown>;
      cache?: RequestCache;
      headers: Record<string, string>;
    }> = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({
        url,
        body: JSON.parse(String(init?.body)),
        cache: init?.cache,
        headers: init?.headers as Record<string, string>,
      });
      if (url.includes("api.exa.ai")) {
        return new Response(JSON.stringify({ results: [{ url: restaurant.url }] }));
      }
      if (url.endsWith("/search")) {
        return new Response(JSON.stringify({ success: true, data: { web: [] } }));
      }
      return new Response(JSON.stringify({
        success: true,
        data: firecrawlPage(restaurant.url, jsonLdPage(restaurant)),
      }));
    });
    const lookup = vi.fn().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    await fetchDiscoveries(
      { exaKey: "exa-test", firecrawlKey: "fc-test", limit: 1 },
      fetchMock as typeof fetch,
      lookup,
      () => new Date(OBSERVED_AT),
    );
    const firecrawl = requests.filter((request) => request.url.includes("firecrawl"));
    const search = firecrawl.filter((request) => request.url.endsWith("/search"));
    const scrape = firecrawl.filter((request) => request.url.endsWith("/scrape"));
    expect(search).not.toHaveLength(0);
    expect(scrape).not.toHaveLength(0);
    for (const request of search) {
      expect(request.cache).toBe("no-store");
      expect(request.headers.authorization).toBe("Bearer fc-test");
      expect(request.headers["cache-control"]).toBe("no-cache");
      expect(request.body).toMatchObject({
        scrapeOptions: {
          maxAge: 0,
          storeInCache: false,
          skipTlsVerification: false,
          lockdown: false,
        },
      });
      expect(request.body.scrapeOptions).not.toHaveProperty("minAge");
    }
    for (const request of scrape) {
      expect(request.cache).toBe("no-store");
      expect(request.headers.authorization).toBe("Bearer fc-test");
      expect(request.headers["cache-control"]).toBe("no-cache");
      expect(request.body).toMatchObject({
        maxAge: 0,
        storeInCache: false,
        skipTlsVerification: false,
        lockdown: false,
      });
      expect(request.body).not.toHaveProperty("minAge");
    }
  });

  it("derives source observation time from the authenticated Firecrawl response", async () => {
    const responseAt = "2026-07-20T12:34:56.000Z";
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("api.exa.ai")) return new Response(JSON.stringify({ results: [] }));
      return new Response(JSON.stringify({
        success: true,
        data: { web: [firecrawlPage(restaurant.url, jsonLdPage(restaurant))] },
      }));
    });
    const lookup = vi.fn().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    const discoveries = await fetchDiscoveries(
      { exaKey: "exa-test", firecrawlKey: "fc-test", limit: 1 },
      fetchMock as typeof fetch,
      lookup,
      () => new Date(responseAt),
    );
    expect(discoveries).not.toHaveLength(0);
    expect(discoveries.every((discovery: { observedAt?: string }) => discovery.observedAt === responseAt)).toBe(true);
  });

  it.each([
    ["cross-host redirect", "https://redirected.example/venue", {}],
    ["cross-path redirect", "https://example.com/other", {}],
    ["identity-query redirect", `${restaurant.url}?id=B`, {}],
    ["source URL mismatch", restaurant.url, { sourceURL: "https://other.example/venue" }],
    ["missing source URL", restaurant.url, { sourceURL: undefined }],
    ["missing final URL", restaurant.url, { url: undefined }],
    ["cache marker", restaurant.url, { cached: true }],
    ["stale provider timestamp", restaurant.url, { scrapedAt: "2026-07-19T00:00:00.000Z" }],
  ])("rejects Firecrawl %s metadata", async (_label, finalUrl, extraMetadata) => {
    const requested = finalUrl.includes("?id=") ? `${restaurant.url}?id=A` : restaurant.url;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("api.exa.ai")) return new Response(JSON.stringify({ results: [] }));
      return new Response(JSON.stringify({
        success: true,
        data: {
          web: [{
            ...firecrawlPage(requested, jsonLdPage(restaurant), {
              url: finalUrl,
              ...extraMetadata,
            }),
            url: requested,
          }],
        },
      }));
    });
    const lookup = vi.fn().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    await expect(fetchDiscoveries(
      { exaKey: "exa-test", firecrawlKey: "fc-test", limit: 1 },
      fetchMock as typeof fetch,
      lookup,
      () => new Date(OBSERVED_AT),
    )).rejects.toThrow("OWNER ACTION");
  });

  it.each([
    ["malformed Exa search", "exa"],
    ["Firecrawl search result without raw HTML", "firecrawl-search"],
    ["Firecrawl scrape result without raw HTML", "firecrawl-scrape"],
  ])("leaves the artifact byte-identical for %s", async (_label, failure) => {
    const dir = mkdtempSync(join(tmpdir(), "night-out-ingest-"));
    const outputPath = join(dir, "latest.json");
    cpSync(join(process.cwd(), "public", "data", "night_out_places", "latest.json"), outputPath);
    const before = readFileSync(outputPath);
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("api.exa.ai")) {
        const payload = failure === "exa"
          ? { unexpected: [] }
          : { results: failure === "firecrawl-scrape" ? [{ url: restaurant.url }] : [] };
        return new Response(JSON.stringify(payload));
      }
      if (url.endsWith("/search")) {
        const web = failure === "firecrawl-search"
          ? [{ url: restaurant.url }]
          : [];
        return new Response(JSON.stringify({ success: true, data: { web } }));
      }
      return new Response(JSON.stringify({ success: true, data: {} }));
    });
    const lookup = vi.fn().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    await expect(
      runIngestion({
        outputPath,
        observedAt: OBSERVED_AT,
        exaKey: "exa-test",
        firecrawlKey: "fc-test",
        fetchImpl: fetchMock as typeof fetch,
        lookupImpl: lookup,
      }),
    ).rejects.toThrow("OWNER ACTION");
    expect(readFileSync(outputPath)).toEqual(before);
    rmSync(dir, { recursive: true, force: true });
  });

  it("publishes the live Firecrawl response receipt time, not the discovery time", async () => {
    const dir = mkdtempSync(join(tmpdir(), "night-out-live-ingest-"));
    const outputPath = join(dir, "latest.json");
    cpSync(join(process.cwd(), "public", "data", "night_out_places", "latest.json"), outputPath);
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("api.exa.ai")) {
        return new Response(JSON.stringify({ results: [{ url: restaurant.url }] }));
      }
      if (url.endsWith("/search")) {
        return new Response(JSON.stringify({ success: true, data: { web: [] } }));
      }
      return new Response(JSON.stringify({
        success: true,
        data: firecrawlPage(restaurant.url, jsonLdPage(restaurant)),
      }));
    });
    const lookup = vi.fn().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    const snapshot = await runIngestion({
      outputPath,
      exaKey: "exa-test",
      firecrawlKey: "fc-test",
      fetchImpl: fetchMock as typeof fetch,
      lookupImpl: lookup,
      nowImpl: () => new Date(OBSERVED_AT),
    }) as { generatedAt: string; places: Array<{ observedAt: string }> };
    expect(snapshot.generatedAt).toBe(OBSERVED_AT);
    expect(snapshot.places).toHaveLength(1);
    expect(snapshot.places[0]?.observedAt).toBe(OBSERVED_AT);
    expect(JSON.parse(readFileSync(outputPath, "utf8"))).toEqual(snapshot);
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects invalid existing and post-merge snapshots before rename", () => {
    const dir = mkdtempSync(join(tmpdir(), "night-out-snapshot-"));
    const outputPath = join(dir, "latest.json");
    const original = '{"version":1,"places":[{"id":"broken"}]}\n';
    writeFileSync(outputPath, original);
    expect(() => loadCurrentPlaces(Date.parse(OBSERVED_AT), outputPath)).toThrow("OWNER ACTION");
    expect(readFileSync(outputPath, "utf8")).toBe(original);
    const invalidCandidate = {
      version: 1,
      generatedAt: OBSERVED_AT,
      status: "published",
      provenanceRegistryVersion: 1,
      places: [{ id: "broken" }],
    };
    expect(isValidPlaceSnapshot(invalidCandidate)).toBe(false);
    expect(() => writeSnapshot(invalidCandidate, outputPath)).toThrow("OWNER ACTION");
    expect(readFileSync(outputPath, "utf8")).toBe(original);
    rmSync(dir, { recursive: true, force: true });
  });

  it("leaves the artifact byte-identical when the provenance registry is invalid", () => {
    const dir = mkdtempSync(join(tmpdir(), "night-out-provenance-"));
    const outputPath = join(dir, "latest.json");
    const registryPath = join(dir, "registry.json");
    const original = '{"version":1,"status":"empty","places":[]}\n';
    writeFileSync(outputPath, original);
    writeFileSync(registryPath, JSON.stringify({ version: 2, producers: [] }));
    const [row] = buildPlaceRows(
      [{ category: "restaurant", discoveredVia: "exa", url: restaurant.url, rawHtml: jsonLdPage(restaurant) }],
      { observedAt: OBSERVED_AT },
    );
    const candidate = {
      version: 1,
      generatedAt: OBSERVED_AT,
      status: "published",
      provenanceRegistryVersion: 1,
      places: [row],
    };

    expect(isValidPlaceSnapshot(candidate)).toBe(true);
    expect(() => writeSnapshot(candidate, outputPath, registryPath)).toThrow("OWNER ACTION");
    expect(readFileSync(outputPath, "utf8")).toBe(original);
    rmSync(dir, { recursive: true, force: true });
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
      "manual",
    ]);
    expect(registry.producers.find((provider: { id: string }) => provider.id === "exa").mayPublishFacts).toBe(false);
    expect(registry.producers.find((provider: { id: string }) => provider.id === "firecrawl").factSource).toBe(
      "source_page_json_ld_only",
    );
    expect(registry.producers.find((provider: { id: string }) => provider.id === "firecrawl")).toMatchObject({
      liveRequest: {
        maxAge: 0,
        storeInCache: false,
        lockdown: false,
        skipTlsVerification: false,
      },
      observedAtBasis: "authenticated_firecrawl_response_receipt",
    });
  });
});
