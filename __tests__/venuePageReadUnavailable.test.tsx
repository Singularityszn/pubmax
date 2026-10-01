// A DETAIL ARTIFACT WE COULD NOT READ IS NOT A PUB THAT DOES NOT EXIST.
// Issue #1646: both pages spend the shared three-state venue-detail seam.
// These faults sit at its real filesystem boundary, not a mocked lookup result.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requestHeaders = vi.hoisted(() => vi.fn(async () => new Headers()));
const artifacts = vi.hoisted(() => ({
  manifest: "",
  details: "",
  failManifest: false,
  failDetails: false,
  manifestReads: 0,
  detailReads: 0,
  datasetReads: 0,
  failAliases: false,
  aliasReads: 0,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: requestHeaders }));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/components/venue/VenuePhotoWall", () => ({
  default: ({ venueId, venueName }: { venueId: string; venueName: string }) => (
    <div data-photo-venue-id={venueId} data-photo-venue-name={venueName} />
  ),
}));
vi.mock("@/lib/supabase", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase")>()),
  isSupabaseConfigured: () => false,
}));
vi.mock("@/lib/venueMenuEnrichment", () => ({
  enrichVenueForDetail: async (venue: import("@/lib/venues").Venue) => ({
    ...venue,
    address: "Detail artifact address fixture",
    primaryBorough: "Detail fixture borough",
    curation: {
      ...venue.curation,
      heritageNote: "Heritage note supplied by the detail enrichment fixture.",
    },
  }),
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  const readFile = actual.promises.readFile;
  const open = actual.promises.open;
  const promises = {
    ...actual.promises,
    readFile: async (file: unknown, ...rest: unknown[]) => {
      if (typeof file === "string" && file.endsWith("venue_detail_index.json")) {
        artifacts.manifestReads += 1;
        if (artifacts.failManifest) throw new Error("EIO: i/o error, read");
        return artifacts.manifest;
      }
      if (typeof file === "string" && file.endsWith("pint_prices_app_dataset.json")) {
        artifacts.datasetReads += 1;
      }
      if (typeof file === "string" && file.endsWith("venue_id_aliases.json")) {
        artifacts.aliasReads += 1;
        if (artifacts.failAliases) throw new Error("EIO: i/o error, read");
      }
      return (readFile as (...args: unknown[]) => Promise<unknown>)(file, ...rest);
    },
    open: async (file: unknown, ...rest: unknown[]) => {
      if (typeof file === "string" && file.endsWith("venue_details.jsonl")) {
        artifacts.detailReads += 1;
        if (artifacts.failDetails) throw new Error("EIO: i/o error, open");
        return {
          read: async (buffer: Buffer, offset: number, length: number, position: number) => {
            const bytes = Buffer.from(artifacts.details, "utf8");
            const bytesRead = bytes.copy(buffer, offset, position, position + length);
            return { bytesRead, buffer };
          },
          close: async () => {},
        };
      }
      return (open as (...args: unknown[]) => Promise<unknown>)(file, ...rest);
    },
  };
  return { ...actual, promises, default: { ...actual, promises } };
});

import BarTabPage, { generateMetadata as barTabMetadata } from "@/app/bar-tab/[id]/page";
import LedgerPage, { generateMetadata as ledgerMetadata } from "@/app/ledger/[id]/page";
import { __resetPintDrops, addPintDrop } from "@/lib/pintDrops";
import { resetVenueAliasesForTests } from "@/lib/venueAliases";
import { resetVenueDetailCachesForTests } from "@/lib/venueDetailIndex";
import { resetVenueIndexForTests } from "@/lib/venueIndex";
import { groupVenuePrices, type VenuePrice } from "@/lib/venues";

const ROOT = process.cwd();
const read = (file: string): string => readFileSync(join(ROOT, file), "utf8");
const rows = JSON.parse(read("public/data/pint_prices_app_dataset.json")) as VenuePrice[];
const venues = groupVenuePrices(rows);
const venue = venues[0];
const aliasDoc = JSON.parse(read("public/data/venue_id_aliases.json")) as {
  aliases: Record<string, string>;
};
const mergedId = Object.keys(aliasDoc.aliases)[0];
const mergedCanonical = venues.find((row) => row.id === aliasDoc.aliases[mergedId])!;

// Build an in-memory range-readable artifact from committed rows. No generated
// file is written, and the pages still use the real lookup/cache/alias code.
const fixtureVenues = new Map([venue, mergedCanonical].map((row) => [row.id, row]));
const manifestEntries: Record<string, { offset: number; length: number; rowCount: number }> = {};
let details = "";
for (const row of fixtureVenues.values()) {
  const line = `${JSON.stringify({ id: row.id, rows: row.prices })}\n`;
  manifestEntries[row.id] = {
    offset: Buffer.byteLength(details, "utf8"),
    length: Buffer.byteLength(line, "utf8"),
    rowCount: row.prices.length,
  };
  details += line;
}

async function render(page: (props: { params: Promise<{ id: string }> }) => Promise<unknown>, id: string) {
  const element = await page({ params: Promise.resolve({ id }) });
  return renderToStaticMarkup(createElement(() => element as React.ReactElement));
}

beforeEach(() => {
  // Exercise deployment semantics: failed manifests cannot fall back to the
  // raw development dataset and conceal unavailable detail reads.
  vi.stubEnv("NODE_ENV", "production");
  artifacts.manifest = JSON.stringify({
    version: 1,
    detailsFile: "venue_details.jsonl",
    count: fixtureVenues.size,
    venues: manifestEntries,
  });
  artifacts.details = details;
  artifacts.failManifest = false;
  artifacts.failDetails = false;
  artifacts.manifestReads = 0;
  artifacts.detailReads = 0;
  artifacts.datasetReads = 0;
  artifacts.failAliases = false;
  artifacts.aliasReads = 0;
  requestHeaders.mockClear();
  resetVenueAliasesForTests();
  resetVenueDetailCachesForTests();
  resetVenueIndexForTests();
  __resetPintDrops();
});

afterEach(() => {
  __resetPintDrops();
  resetVenueDetailCachesForTests();
  resetVenueAliasesForTests();
  resetVenueIndexForTests();
  vi.unstubAllEnvs();
});

describe.each([
  {
    surface: "the Bar Tab",
    page: BarTabPage,
    metadata: barTabMetadata,
    route: "bar-tab",
    notFoundLine: "on the tab",
    titleClass: "barTabEmptyTitle",
    priceClass: "barTabTileReceiptPrice",
  },
  {
    surface: "the Ledger",
    page: LedgerPage,
    metadata: ledgerMetadata,
    route: "ledger",
    notFoundLine: "in the ledger",
    titleClass: "ledgerEmptyTitle",
    priceClass: "ledgerEntryPriceValue",
  },
])("$surface over the shared detail read", ({ page, metadata, route, notFoundLine, titleClass, priceClass }) => {
  function expectUnavailable(markup: string, id: string) {
    expect(markup).toMatch(new RegExp(`<h1 class="${titleClass}">We could not load this pub</h1>`));
    expect(markup).toContain("could not answer just now");
    expect(markup).toContain(`href="/${route}/${encodeURIComponent(id)}"`);
    expect(markup).toContain("Try again");
    expect(markup).not.toContain(notFoundLine);
    expect(markup).not.toContain("moved");
    expect(markup).not.toMatch(/check back later|try again later|please try again/i);
  }

  it("retries a failed artifact manifest and caches only successful detail", async () => {
    artifacts.failManifest = true;
    expectUnavailable(await render(page, venue.id), venue.id);
    expect(requestHeaders).toHaveBeenCalled();
    expect(artifacts.manifestReads).toBe(1);
    expect(artifacts.datasetReads).toBe(0);

    const failed = await metadata({ params: Promise.resolve({ id: venue.id }) });
    expect(JSON.stringify(failed)).not.toContain(venue.name);
    expect(failed.robots).toEqual({ index: false, follow: false });
    expect(artifacts.manifestReads).toBe(2);

    artifacts.failManifest = false;
    const found = await metadata({ params: Promise.resolve({ id: venue.id }) });
    expect(String(found.title)).toContain(venue.name);
    expect(found.description).toContain("Detail fixture borough");
    expect(artifacts.manifestReads).toBe(3);
    expect(artifacts.detailReads).toBe(1);

    artifacts.failManifest = true;
    artifacts.failDetails = true;
    const held = await metadata({ params: Promise.resolve({ id: venue.id }) });
    expect(String(held.title)).toContain(venue.name);
    expect(artifacts.manifestReads).toBe(3);
    expect(artifacts.detailReads).toBe(1);
    expect(artifacts.datasetReads).toBe(0);
  });

  it("retries a failed per-venue row read without calling the raw dataset", async () => {
    artifacts.failDetails = true;
    expectUnavailable(await render(page, venue.id), venue.id);
    expect(artifacts.detailReads).toBe(1);
    expectUnavailable(await render(page, venue.id), venue.id);
    expect(artifacts.detailReads).toBe(2);
    artifacts.failDetails = false;
    const recovered = await render(page, venue.id);
    expect(recovered).toContain(venue.name);
    expect(recovered).not.toContain("We could not load this pub");
    expect(artifacts.detailReads).toBe(3);
    expect(artifacts.datasetReads).toBe(0);
  });

  it("renders the existing missing card without holding the missing document", async () => {
    const id = "venue-missing1646";
    const markup = await render(page, id);
    expect(markup).toContain(notFoundLine);
    expect(markup).not.toContain("We could not load this pub");
    expect(markup).toContain('href="/map"');
    expect(requestHeaders).toHaveBeenCalled();
    const missing = await metadata({ params: Promise.resolve({ id }) });
    expect(missing.robots).toEqual({ index: false, follow: false });
    expect(JSON.stringify(missing)).not.toContain(venue.name);
    expect(artifacts.datasetReads).toBe(0);
  });

  it("retries an unavailable alias and then uses the surviving photo identity", async () => {
    artifacts.failAliases = true;
    expectUnavailable(await render(page, mergedId), mergedId);
    expect(artifacts.aliasReads).toBe(1);
    expectUnavailable(await render(page, mergedId), mergedId);
    expect(artifacts.aliasReads).toBe(2);
    artifacts.failAliases = false;
    const resolved = await render(page, mergedId);
    expect(resolved).toContain(mergedCanonical.name);
    expect(resolved).toContain(`data-photo-venue-id="${mergedCanonical.id}"`);
    expect(resolved).toContain(`href="/${route === "bar-tab" ? "ledger" : "bar-tab"}/${mergedCanonical.id}"`);
    expect(resolved).not.toContain("We could not load this pub");
    expect(artifacts.datasetReads).toBe(0);
  });

  it("renders enriched header content while keeping contributor prices and photo identity", async () => {
    addPintDrop({
      id: "drop-detail-convergence",
      venueId: mergedCanonical.id,
      handle: "detail_fixture_reader",
      drink: "Fixture pint",
      priceGbp: 4.2,
      passedDownNote: "Contributor receipt fixture, separate from listed menu rows.",
      era: "",
      provenance: "contributor",
      status: "visible",
      createdAt: "2026-09-01T20:00:00.000Z",
    });
    const markup = await render(page, mergedId);
    expect(markup).toContain(mergedCanonical.name);
    expect(markup).toContain("Detail artifact address fixture");
    expect(markup).toContain("Detail fixture borough");
    expect(markup).toContain(`class="${priceClass}">£4.20</span>`);
    expect(markup).toContain(`data-photo-venue-id="${mergedCanonical.id}"`);
    if (route === "ledger") {
      expect(markup).toContain("Heritage note supplied by the detail enrichment fixture.");
    }
    const found = await metadata({ params: Promise.resolve({ id: mergedId }) });
    expect(String(found.title)).toContain(mergedCanonical.name);
    expect(found.description).toContain("Detail fixture borough");
    if (route === "ledger") {
      expect(found.alternates?.canonical).toBe(`/ledger/${mergedCanonical.id}`);
    }
    expect(artifacts.datasetReads).toBe(0);
  });
});
