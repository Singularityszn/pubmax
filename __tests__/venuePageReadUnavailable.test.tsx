// Failed detail reads must remain unavailable and retry on the next request.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));

const details = vi.hoisted(() => ({
  fail: false,
  reads: 0,
}));

const aliases = vi.hoisted(() => ({
  fail: false,
  reads: 0,
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  const readFile = actual.promises.readFile;
  const open = actual.promises.open;
  const promises = {
    ...actual.promises,
    open: async (...args: Parameters<typeof open>) => {
      if (String(args[0]).endsWith("venue_details.jsonl")) {
        details.reads += 1;
        if (details.fail) throw new Error("EIO: i/o error, read");
      }
      return open(...args);
    },
    readFile: async (file: unknown, ...rest: unknown[]) => {
      if (typeof file === "string" && file.endsWith("venue_id_aliases.json")) {
        aliases.reads += 1;
        if (aliases.fail) throw new Error("EIO: i/o error, read");
      }
      return (readFile as (...args: unknown[]) => Promise<unknown>)(file, ...rest);
    },
  };
  return { ...actual, promises, default: { ...actual, promises } };
});

import BarTabPage, { generateMetadata as barTabMetadata } from "@/app/bar-tab/[id]/page";
import LedgerPage, { generateMetadata as ledgerMetadata } from "@/app/ledger/[id]/page";
import { resetVenueAliasesForTests } from "@/lib/venueAliases";
import { resetVenueDetailCachesForTests, setVenueDetailIndexFileForTests, setVenueDetailRowsFileForTests } from "@/lib/venueDetailIndex";
import { resetVenueIndexForTests } from "@/lib/venueIndex";
import { groupVenuePrices, stableVenueIdFromKey, venueGroupingKey, type VenuePrice } from "@/lib/venues";

const ROOT = process.cwd();
const read = (file: string): string => readFileSync(join(ROOT, file), "utf8");

const rows = JSON.parse(read("public/data/pint_prices_app_dataset.json")) as VenuePrice[];
const venue = groupVenuePrices(rows).find((venue) => venue.id === "venue-16pnwmm")!;

// A stored duplicate ID must resolve to its canonical venue after alias recovery.
const aliasDoc = JSON.parse(read("public/data/venue_id_aliases.json")) as {
  aliases: Record<string, string>;
};
const mergedId = Object.keys(aliasDoc.aliases)[0];
const mergedCanonical = groupVenuePrices(rows).find(
  (row) => row.id === aliasDoc.aliases[mergedId],
)!;

async function render(page: (props: { params: Promise<{ id: string }> }) => Promise<unknown>, id: string) {
  const element = await page({ params: Promise.resolve({ id }) });
  return renderToStaticMarkup(createElement(() => element as React.ReactElement));
}

let fixtureDir: string;
beforeAll(() => {
  fixtureDir = mkdtempSync(join(tmpdir(), "venue-page-read-"));
  const artifacts = [venue, mergedCanonical].map((item) => ({
    id: item.id,
    rows: rows.filter((row) => stableVenueIdFromKey(venueGroupingKey(row)) === item.id),
  }));
  const venues: Record<string, { offset: number; length: number; rowCount: number }> = {};
  let contents = "";
  for (const artifact of artifacts) {
    const line = `${JSON.stringify(artifact)}\n`;
    venues[artifact.id] = { offset: Buffer.byteLength(contents), length: Buffer.byteLength(line), rowCount: artifact.rows.length };
    contents += line;
  }
  writeFileSync(join(fixtureDir, "venue_details.jsonl"), contents);
  writeFileSync(join(fixtureDir, "venue_detail_index.json"), JSON.stringify({ version: 1, detailsFile: "venue_details.jsonl", count: artifacts.length, venues }));
});
afterAll(() => rmSync(fixtureDir, { recursive: true, force: true }));

beforeEach(() => {
  details.fail = false;
  details.reads = 0;
  aliases.fail = false;
  aliases.reads = 0;
  resetVenueAliasesForTests();
  resetVenueIndexForTests();
  resetVenueDetailCachesForTests();
  setVenueDetailIndexFileForTests(join(fixtureDir, "venue_detail_index.json"));
  setVenueDetailRowsFileForTests(join(fixtureDir, "venue_details.jsonl"));
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
])("$surface over a detail read that threw", ({ page, metadata, href, notFoundLine, titleClass }) => {
  it("answers unavailable, reads again on the next request, and caches only a successful detail", async () => {
    // 1. The read throws: the unavailable surface, never the not-found document.
    details.fail = true;
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
    expect(details.reads).toBe(1);

    // The unfurl claims nothing either way.
    const failed = await metadata({ params: Promise.resolve({ id: venue.id }) });
    expect(JSON.stringify(failed)).not.toContain(venue.name);
    expect(failed.robots).toEqual({ index: false, follow: false });
    expect(details.reads).toBe(2);

    // 2. The file is readable again: the next request reads it and finds the pub.
    details.fail = false;
    const found = await metadata({ params: Promise.resolve({ id: venue.id }) });
    expect(String(found.title)).toContain(venue.name);
    expect(details.reads).toBe(3);

    // 3. Only that successful detail is cached: a later failure changes nothing
    //    and the file is not opened again.
    details.fail = true;
    const held = await metadata({ params: Promise.resolve({ id: venue.id }) });
    expect(String(held.title)).toContain(venue.name);
    expect(details.reads).toBe(3);
  });

  it.each(["venue-unknown123", "invalid/id"])("keeps a missing venue distinct for %s", async (id) => {
    const markup = await render(page, id);
    expect(markup).toContain(notFoundLine);
    expect(markup).not.toContain("We could not load this pub");
    expect((await metadata({ params: Promise.resolve({ id }) })).robots).toEqual({ index: false, follow: false });
    expect(details.reads).toBe(0);
  });

  it.each([mergedId, venue.id])("retries a failed alias read for %s", async (requestedId) => {
    aliases.fail = true;
    const markup = await render(page, requestedId);
    expect(markup).toContain("We could not load this pub");
    expect(markup).not.toContain(notFoundLine);
    expect(markup).not.toContain("moved");
    expect(aliases.reads).toBe(1);

    // Nothing was cached from that failure: the next request opens the file.
    const again = await render(page, requestedId);
    expect(again).toContain("We could not load this pub");
    expect(aliases.reads).toBe(2);

    // The file is readable again: the losing id opens its surviving pub.
    aliases.fail = false;
    const resolved = await render(page, requestedId);
    expect(resolved).not.toContain("We could not load this pub");
    expect(resolved).toContain(requestedId === mergedId ? mergedCanonical.name : venue.name);
  });
});
