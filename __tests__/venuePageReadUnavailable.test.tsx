// A DETAIL ARTIFACT WE COULD NOT READ IS NOT A PUB THAT DOES NOT EXIST.
// Issue #1646: both pages spend the shared three-state venue-detail seam.
// These faults sit at its real filesystem boundary, not a mocked lookup result.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const venueLookup = vi.hoisted(() => ({
  throwNext: false,
  calls: [] as Array<{ id: string; includeHarvestOverlay: boolean | undefined }>,
}));
const requestHeaders = vi.hoisted(() => vi.fn(async () => new Headers()));
const artifacts = vi.hoisted(() => ({
  manifest: "",
  details: "",
  failManifest: false,
  failDetails: false,
  manifestReads: 0,
  detailReads: 0,
  datasetReads: 0,
  osmReads: 0,
  failAliases: false,
  aliasReads: 0,
}));

import { VENUE_ALIAS_FILES } from "@/lib/venueAliasesFile.mjs";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/venueDetailIndex", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/venueDetailIndex")>();
  return {
    ...actual,
    lookupVenueDetail: (id: string, options?: Parameters<typeof actual.lookupVenueDetail>[1]) => {
      venueLookup.calls.push({ id, includeHarvestOverlay: options?.includeHarvestOverlay });
      if (venueLookup.throwNext) {
        venueLookup.throwNext = false;
        return Promise.reject(new Error("venue read threw"));
      }
      return actual.lookupVenueDetail(id, options);
    },
  };
});
vi.mock("next/og", () => ({
  ImageResponse: class ImageResponse {
    element: unknown;
    constructor(element: unknown) {
      this.element = element;
    }
  },
}));
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
      if (typeof file === "string" && file.endsWith("uk_osm_pubs.json")) {
        artifacts.osmReads += 1;
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

import BarTabCard from "@/app/bar-tab/[id]/opengraph-image";
import { clampOgText } from "@/lib/ogCardText";
import type { VenueDetailArtifact } from "@/lib/venueDetailIndex";
import BarTabPage, { generateMetadata as barTabMetadata } from "@/app/bar-tab/[id]/page";
import LedgerPage, { generateMetadata as ledgerMetadata } from "@/app/ledger/[id]/page";
import { __resetPintDrops, addPintDrop, type PintDrop } from "@/lib/pintDrops";
import { harvestOverlayStore } from "@/lib/harvestOverlayStore";
import { memoryPintDropStore } from "@/lib/pintDropsStore";
import { resetVenueAliasesForTests } from "@/lib/venueAliases";
import { lookupVenueDetail, resetVenueDetailCachesForTests } from "@/lib/venueDetailIndex";
import { resetVenueIndexForTests } from "@/lib/venueIndex";
import { groupVenuePrices, type VenuePrice } from "@/lib/venues";

const ROOT = process.cwd();
const read = (file: string): string => readFileSync(join(ROOT, file), "utf8");
const rows = JSON.parse(read("public/data/pint_prices_app_dataset.json")) as VenuePrice[];
const venues = groupVenuePrices(rows);
const venue = venues[0];
// Committed OSM pack maps this pub to way/204148499. A default detail read
// therefore exercises the optional overlay seam instead of vacuously skipping it.
const overlayVenue = venues.find((row) => row.id === "venue-16pnwmm")!;
if (!overlayVenue) throw new Error("Committed OSM-linked pub fixture is missing");
const FAMOUS_BAR_ID = "bar-american-bar-savoy";
const FAMOUS_BAR_NAME = "American Bar at The Savoy";
const famousSeeds = JSON.parse(read("data/famous_venues/bars.json")) as NonNullable<
  VenueDetailArtifact["famous"]
>["seed"][];
const famousSeed = famousSeeds.find((seed) => seed.id === FAMOUS_BAR_ID);
if (!famousSeed) throw new Error("Committed famous-bar fixture is missing");
const aliasDoc = JSON.parse(read("public/data/venue_id_aliases.json")) as {
  aliases: Record<string, string>;
};
const mergedId = Object.keys(aliasDoc.aliases)[0];
const mergedCanonical = venues.find((row) => row.id === aliasDoc.aliases[mergedId])!;

// Build an in-memory range-readable artifact from committed rows. No generated
// file is written, and the pages still use the real lookup/cache/alias code.
const fixtureVenues = new Map([venue, mergedCanonical, overlayVenue].map((row) => [row.id, row]));
const manifestEntries: Record<string, { offset: number; length: number; rowCount: number }> = {};
const fixtureArtifacts: VenueDetailArtifact[] = [
  ...Array.from(fixtureVenues.values(), (row) => ({ id: row.id, rows: row.prices })),
  {
    id: famousSeed.id,
    famous: {
      seed: famousSeed,
      slim: {
        id: famousSeed.id,
        name: famousSeed.name,
        lat: famousSeed.lat,
        lng: famousSeed.lng,
        cheapestPrice: famousSeed.anchor.price,
        borough: famousSeed.borough,
        kind: famousSeed.kind,
      },
    },
  },
];
let details = "";
for (const artifact of fixtureArtifacts) {
  const line = `${JSON.stringify(artifact)}\n`;
  manifestEntries[artifact.id] = {
    offset: Buffer.byteLength(details, "utf8"),
    length: Buffer.byteLength(line, "utf8"),
    rowCount: artifact.rows?.length ?? 1,
  };
  details += line;
}

async function render(page: (props: { params: Promise<{ id: string }> }) => Promise<unknown>, id: string) {
  const element = await page({ params: Promise.resolve({ id }) });
  return renderToStaticMarkup(createElement(() => element as React.ReactElement));
}

function visibleText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(visibleText).join("");
  if (typeof node === "object" && "props" in node) {
    return visibleText((node as { props?: { children?: ReactNode } }).props?.children);
  }
  return "";
}

async function renderCard(id: string): Promise<string> {
  const response = (await BarTabCard({
    params: Promise.resolve({ id }),
  })) as unknown as { element: ReactNode };
  return visibleText(response.element);
}

async function renderCardText(id: string): Promise<string> {
  const response = (await BarTabCard({
    params: Promise.resolve({ id }),
  })) as unknown as { element: React.ReactElement };
  // Render nested CardShell/StatTile components too, so public count captions
  // are observed through their output rather than inferred from component props.
  return renderToStaticMarkup(response.element).replace(/<[^>]+>/g, "");
}

function addCardDrop(id: string, overrides: Partial<PintDrop> = {}): void {
  addPintDrop({
    id,
    venueId: overlayVenue.id,
    handle: "@og_public_fixture",
    drink: "Cask bitter",
    priceGbp: 4.2,
    passedDownNote: "Public contribution fixture.",
    era: "",
    provenance: "contributor",
    status: "visible",
    visibility: "public",
    createdAt: "2026-10-02T05:00:00.000Z",
    ...overrides,
  });
}

function titleVenueName(title: unknown): string {
  const named = String(title).match(/^The Bar Tab: (.+)\. PUBMAXXING$/)?.[1];
  if (!named) throw new Error(`Bar Tab title did not name a pub: ${String(title)}`);
  return named;
}

beforeEach(() => {
  // Exercise deployment semantics: failed manifests cannot fall back to the
  // raw development dataset and conceal unavailable detail reads.
  vi.stubEnv("NODE_ENV", "production");
  artifacts.manifest = JSON.stringify({
    version: 1,
    detailsFile: "venue_details.jsonl",
    count: fixtureArtifacts.length,
    venues: manifestEntries,
  });
  artifacts.details = details;
  artifacts.failManifest = false;
  artifacts.failDetails = false;
  artifacts.manifestReads = 0;
  artifacts.detailReads = 0;
  artifacts.datasetReads = 0;
  artifacts.osmReads = 0;
  artifacts.failAliases = false;
  artifacts.aliasReads = 0;
  venueLookup.throwNext = false;
  venueLookup.calls.length = 0;
  requestHeaders.mockClear();
  resetVenueAliasesForTests();
  resetVenueDetailCachesForTests();
  resetVenueIndexForTests();
  __resetPintDrops();
});

afterEach(() => {
  vi.restoreAllMocks();
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

describe.each([
  {
    surface: "the Bar Tab",
    page: BarTabPage,
    metadata: barTabMetadata,
    href: `/bar-tab/${encodeURIComponent(venue.id)}`,
    notFoundLine: "on the tab",
    titleClass: "barTabEmptyTitle",
  },
  {
    surface: "the Ledger",
    page: LedgerPage,
    metadata: ledgerMetadata,
    href: `/ledger/${encodeURIComponent(venue.id)}`,
    notFoundLine: "in the ledger",
    titleClass: "ledgerEmptyTitle",
  },
])("$surface when lookupCanonicalVenueId cannot read the alias file", ({ page, metadata, href, notFoundLine, titleClass }) => {
  it("answers unavailable, reads again on the next request, and does not cache the failure", async () => {
    // This id is in the dataset under its own key. The old page returned it
    // without asking the alias file. The detail module asks first, so an
    // unreadable alias file is unavailable, never a found pub and never the
    // not-found card.
    artifacts.failAliases = true;
    const markup = await render(page, venue.id);
    expect(markup).toContain("We could not load this pub");
    // One route family, one heading structure: the not-found card on these two
    // routes ships an h1, and this document must ship one too.
    expect(markup).toMatch(
      new RegExp(`<h1 class="${titleClass}">We could not load this pub</h1>`),
    );
    expect(markup).toContain("could not answer just now");
    expect(markup).toContain(`href="${href}"`);
    expect(markup).toContain("Try again");
    expect(markup).not.toContain(notFoundLine);
    expect(markup).not.toContain("moved");
    // docs/VOICE.md: never a closed door.
    expect(markup).not.toMatch(/check back later|try again later|please try again/i);
    expect(artifacts.aliasReads).toBe(1);

    // The unfurl claims nothing either way.
    const failed = await metadata({ params: Promise.resolve({ id: venue.id }) });
    expect(JSON.stringify(failed)).not.toContain(venue.name);
    expect(failed.robots).toEqual({ index: false, follow: false });
    expect(artifacts.aliasReads).toBe(2);

    // The failure was not cached: the files are readable again, and this
    // request opens every alias file and finds the pub.
    artifacts.failAliases = false;
    const found = await metadata({ params: Promise.resolve({ id: venue.id }) });
    expect(String(found.title)).toContain(venue.name);
    expect(artifacts.aliasReads).toBe(2 + VENUE_ALIAS_FILES.length);
  });

  it("answers a missing id with the not-found card", async () => {
    const markup = await render(page, "venue-does-not-exist");
    expect(markup).toContain(notFoundLine);
    expect(markup).not.toContain("We could not load this pub");
  });

  it("answers a pub that left the map with the not-found card, never a live page", async () => {
    // Henman & Cooper, Birmingham: retired in public/data/cities/venue_id_aliases.json.
    const markup = await render(page, "venue-bhm-y7p3wr");
    expect(markup).toContain(notFoundLine);
    expect(markup).not.toContain("Henman");
    const meta = await metadata({ params: Promise.resolve({ id: "venue-bhm-y7p3wr" }) });
    expect(JSON.stringify(meta)).not.toContain("Henman");
  });

  it("opens a famous-venue seed the dataset index does not hold", async () => {
    const markup = await render(page, FAMOUS_BAR_ID);
    expect(markup).toContain(FAMOUS_BAR_NAME);
    // The found page keeps its own title class. The empty title is the
    // not-found card and the unavailable surface. "on the tab" also appears
    // in the found Bar Tab count, so that phrase is not the card.
    expect(markup).not.toContain(`class="${titleClass}"`);
    expect(markup).not.toContain("We could not load this pub");
  });

  it("answers unavailable when the alias read throws over a merged duplicate id, and reads again", async () => {
    // The dataset parses; only the alias artifact fails. A merged duplicate id
    // is not in the dataset under its own key, so the alias read decides, and a
    // read we could not run may not be worded as a pub that is not here.
    artifacts.failAliases = true;
    const markup = await render(page, mergedId);
    expect(markup).toContain("We could not load this pub");
    expect(markup).not.toContain(notFoundLine);
    expect(markup).not.toContain("moved");
    expect(artifacts.aliasReads).toBe(1);

    // Nothing was cached from that failure: the next request opens the file.
    const again = await render(page, mergedId);
    expect(again).toContain("We could not load this pub");
    expect(artifacts.aliasReads).toBe(2);

    // The file is readable again: the losing id opens its surviving pub.
    artifacts.failAliases = false;
    const resolved = await render(page, mergedId);
    expect(resolved).not.toContain("We could not load this pub");
    expect(resolved).toContain(mergedCanonical.name);
  });
});

function ledgerStructuredAddress(markup: string): { addressRegion?: string } {
  const match = markup.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
  if (!match?.[1]) throw new Error("Ledger did not emit structured data");
  const data = JSON.parse(match[1]) as { address?: { addressRegion?: string } };
  return data.address ?? {};
}

describe("the Ledger structured address", () => {
  it("names Manchester for a Manchester pub, and London for a London pub", async () => {
    const manchester = await render(LedgerPage, "venue-mcr-iy010v");
    expect(manchester).toContain("Grove Alehouse");
    expect(ledgerStructuredAddress(manchester).addressRegion).toBe("Manchester");

    const london = await render(LedgerPage, venue.id);
    expect(ledgerStructuredAddress(london).addressRegion).toBe("London");
  });
});

describe("the Bar Tab share card", () => {
  it("names the same pub the page title names", async () => {
    for (const id of [venue.id, mergedId, FAMOUS_BAR_ID]) {
      const meta = await barTabMetadata({ params: Promise.resolve({ id }) });
      const named = titleVenueName(meta.title);
      const card = await renderCard(id);
      const painted = clampOgText(named, 36, "A London pub", {
        collapseWhitespace: true,
        collapseBeforeFilter: true,
      });
      expect(painted, id).not.toBe("A London pub");
      expect(card, id).toContain(painted);
      if (id === FAMOUS_BAR_ID) expect(named).toBe(FAMOUS_BAR_NAME);
    }
  });

  it("keeps the generic poster when the pub is missing", async () => {
    const meta = await barTabMetadata({
      params: Promise.resolve({ id: "venue-does-not-exist" }),
    });
    const card = await renderCard("venue-does-not-exist");
    expect(meta.title).toBe("Bar Tab: PUBMAXXING");
    expect(card).toContain("A London pub");
    expect(card).not.toContain("the cheapest pint on the tab");
  });

  it("does not name a pub the page could not load", async () => {
    artifacts.failAliases = true;
    for (const { id, name } of [
      { id: venue.id, name: venue.name },
      { id: mergedId, name: mergedCanonical.name },
    ]) {
      const meta = await barTabMetadata({ params: Promise.resolve({ id }) });
      const card = await renderCard(id);
      expect(String(meta.title), id).not.toContain(name);
      expect(card, id).not.toContain(name);
      expect(card, id).toContain("A London pub");
      expect(card, id).not.toContain("the cheapest pint on the tab");
    }
  });

  it("keeps the generic poster when the venue read throws", async () => {
    venueLookup.throwNext = true;
    const card = await renderCard(venue.id);
    expect(card).toContain("A London pub");
    expect(card).not.toContain(venue.name);
    expect(card).not.toContain("the cheapest pint on the tab");
  });
});

describe("the Bar Tab share card public read", () => {
  beforeEach(() => {
    // This group owns exact organic counts; existing 23 cases retain their
    // previous demo-content setting and fixture behavior.
    vi.stubEnv("NEXT_PUBLIC_DEMO_CONTENT", "off");
    // Keep production artifact behavior while using the existing local QA
    // memory-store escape. Deployed Vercel production still refuses this escape.
    vi.stubEnv("PUBMAX_E2E_KEYLESS", "1");
  });

  it.each(["cold", "warm"])(
    "keeps a %s share-card lookup off optional harvest reads",
    async (cacheState) => {
      if (cacheState === "warm") {
        const meta = await barTabMetadata({ params: Promise.resolve({ id: overlayVenue.id }) });
        expect(String(meta.title)).toContain(overlayVenue.name);
        expect(artifacts.detailReads).toBe(1);
        expect(artifacts.osmReads).toBe(0);
      }
      venueLookup.calls.length = 0;
      const overlayRead = vi.spyOn(harvestOverlayStore(), "getByVenueId");
      addCardDrop("og-cold-warm-public");

      const card = await renderCardText(overlayVenue.id);
      expect(card).toContain("Recent pints dropped at");
      expect(card).toContain("£4.20the cheapest pint on the tab1pint on the tab");
      expect(card).toContain("Detail fixture borough · pints as they were poured");
      expect(artifacts.detailReads).toBe(1);
      expect(artifacts.osmReads).toBe(0);
      expect(overlayRead).not.toHaveBeenCalled();
      expect(venueLookup.calls).toEqual([
        { id: overlayVenue.id, includeHarvestOverlay: false },
      ]);

      // Positive control: the same real warm detail seam can find an OSM id
      // and read its overlay. Zero reads above cannot come from a broken fixture.
      const full = await lookupVenueDetail(overlayVenue.id);
      expect(full.status).toBe("found");
      expect(artifacts.osmReads).toBeGreaterThan(0);
      expect(overlayRead).toHaveBeenCalledWith("way/204148499");
    },
  );

  it("prices and counts only public and anonymous contributions", async () => {
    addCardDrop("og-public");
    addCardDrop("og-anonymous", {
      visibility: "anonymous",
      handle: "@og_withheld_identity",
      priceGbp: 5.6,
    });
    addCardDrop("og-friends", { visibility: "friends", priceGbp: 0.51 });
    addCardDrop("og-legacy", { visibility: "legacy", priceGbp: 0.52 });
    addCardDrop("og-hidden", { status: "hidden", priceGbp: 0.53 });
    addCardDrop("og-pending", { status: "pending", priceGbp: 0.54 });

    const publicRead = vi.spyOn(memoryPintDropStore, "listVisible");
    const card = await renderCardText(overlayVenue.id);
    expect(publicRead).toHaveBeenCalledExactlyOnceWith(overlayVenue.id);
    expect(card).toContain("£4.20the cheapest pint on the tab2pints on the tab");
    expect(card).not.toMatch(/£0\.5[1-4]/);
    expect(card).not.toContain("@og_withheld_identity");
  });

  it("keeps the singular public price caption", async () => {
    addCardDrop("og-one-public");
    const card = await renderCardText(overlayVenue.id);
    expect(card).toContain("£4.20the cheapest pint on the tab1pint on the tab");
    expect(card).not.toContain("pints on the tab");
  });

  it.each([
    { kind: "one unpriced public contribution", publicNote: true, caption: "1 pint on the tab" },
    { kind: "only private prices", publicNote: false, caption: "The tab is open" },
  ])("keeps the honest no-price caption for $kind", async ({ publicNote, caption }) => {
    addCardDrop("og-private-cheapest", { visibility: "friends", priceGbp: 0.51 });
    addCardDrop("og-legacy-cheapest", { visibility: "legacy", priceGbp: 0.52 });
    if (publicNote) addCardDrop("og-public-note", { priceGbp: null });

    const card = await renderCardText(overlayVenue.id);
    expect(card).toContain(`${caption}Photos, prices, and the stories behind them.`);
    expect(card).not.toContain("the cheapest pint on the tab");
    expect(card).not.toContain("£");
  });

  it("keeps venue identity but invents no price when the public drop read fails", async () => {
    vi.spyOn(memoryPintDropStore, "listVisible").mockRejectedValueOnce(
      new Error("public drops unavailable"),
    );
    const card = await renderCardText(overlayVenue.id);
    expect(card).toContain("Recent pints dropped at");
    expect(card).toContain("Detail fixture borough · pints as they were poured");
    expect(card).toContain("The tab is openPhotos, prices, and the stories behind them.");
    expect(card).not.toContain("A London pub");
    expect(card).not.toContain("the cheapest pint on the tab");
    expect(card).not.toContain("£");
  });
});
