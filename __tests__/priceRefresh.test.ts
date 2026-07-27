import { describe, expect, it, vi } from "vitest";

import { fetchPriceUpdates } from "@/lib/priceRefresh.server";
import {
  filterPermissiblePriceSources,
  isHttpUrl,
} from "@/scripts/price_source_fetchers.mjs";

const NOW = Date.parse("2026-07-27T07:00:00.000Z");

describe("permissible-source price collection", () => {
  it("returns an honest empty result while source parsers are stubbed", async () => {
    const result = await fetchPriceUpdates({ now: NOW });

    expect(result).toEqual({
      updates: [],
      fetchedRows: 0,
      droppedRows: 0,
      sourcesChecked: 2,
      failedSources: [],
    });
  });

  it("keeps valid retrieved rows and counts invalid rows as dropped", async () => {
    const fetchSource = vi.fn(async (source: { id: string }) => [
      {
        venueKey: `${source.id}|sw1a`,
        price: 5.5,
        source: {
          label: "Official menu",
          url: "https://example.com/menu",
        },
        observedAt: "2026-07-27T06:30:00.000Z",
      },
      {
        venueKey: `${source.id}|broken`,
        price: -1,
        source: {
          label: "Official menu",
          url: "https://example.com/menu",
        },
        observedAt: "2026-07-27T06:30:00.000Z",
      },
    ]);

    const result = await fetchPriceUpdates({ fetchSource, now: NOW });

    expect(result.sourcesChecked).toBe(2);
    expect(result.fetchedRows).toBe(4);
    expect(result.droppedRows).toBe(2);
    expect(result.updates.map((row) => row.venueKey)).toEqual([
      "example-brewery-official|sw1a",
      "example-open-data|sw1a",
    ]);
  });

  it("records malformed source payloads as failures instead of faking rows", async () => {
    const fetchSource = vi.fn(async () => null);

    const result = await fetchPriceUpdates({
      fetchSource,
      now: NOW,
    });

    expect(result.updates).toEqual([]);
    expect(result.failedSources).toEqual([
      {
        id: "example-brewery-official",
        error:
          'Price source "example-brewery-official" returned a non-array payload.',
      },
      {
        id: "example-open-data",
        error:
          'Price source "example-open-data" returned a non-array payload.',
      },
    ]);
  });

  it("isolates one source failure so remaining sources still run", async () => {
    const fetchSource = vi.fn(async (source: { id: string }) => {
      if (source.id === "example-brewery-official") {
        throw new Error("brewery unavailable");
      }
      return [
        {
          venueKey: "open-data-pub|sw1a",
          price: 5.25,
          source: {
            label: "Open dataset",
            url: "https://data.example.gov.uk/pub-prices",
          },
          observedAt: "2026-07-27T06:00:00.000Z",
        },
      ];
    });

    const result = await fetchPriceUpdates({ fetchSource, now: NOW });

    expect(fetchSource).toHaveBeenCalledTimes(2);
    expect(result.updates.map((row) => row.venueKey)).toEqual([
      "open-data-pub|sw1a",
    ]);
    expect(result.failedSources).toEqual([
      {
        id: "example-brewery-official",
        error: "brewery unavailable",
      },
    ]);
  });
});

describe("permissible-source allowlist filter", () => {
  it("drops non-http(s), malformed, and impermissible entries before any fetch", () => {
    const skipped: string[] = [];

    const permissible = filterPermissiblePriceSources(
      [
        {
          id: "local-file",
          label: "Local file",
          kind: "first-party-official",
          url: "file:///etc/passwd",
        },
        {
          id: "credentialed",
          label: "Credentialed endpoint",
          kind: "open-data",
          url: "ftp://user:secret@example.com/prices",
        },
        {
          id: "no-url",
          label: "Missing url",
          kind: "open-data",
          url: "",
        },
        {
          id: "aggregator",
          label: "Competitor aggregator",
          kind: "aggregator",
          url: "https://aggregator.example.com/prices",
        },
        null,
        {
          id: "real-official",
          label: "Official menu",
          kind: "first-party-official",
          url: "https://www.example-brewery.co.uk/taproom",
        },
      ],
      { onSkip: (message) => skipped.push(message) },
    );

    expect(permissible.map((source) => source.id)).toEqual(["real-official"]);
    expect(skipped).toHaveLength(5);
  });

  it("is the same filter the scheduled collector applies", async () => {
    const seen: string[] = [];
    const fetchSource = vi.fn(async (source: { id: string; url: string }) => {
      seen.push(source.url);
      return [];
    });

    await fetchPriceUpdates({ fetchSource, now: NOW });

    expect(seen.length).toBeGreaterThan(0);
    for (const url of seen) {
      expect(isHttpUrl(url)).toBe(true);
    }
  });
});
