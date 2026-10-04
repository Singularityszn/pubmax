// A READ WE COULD NOT RUN IS NOT A PUB THAT DOES NOT EXIST.
//
// astra-review P1-2. `/bar-tab/[id]` and `/ledger/[id]` call `lookupVenueDetail`,
// the same module as `/api/venue/[id]`. That module asks `lookupCanonicalVenueId`
// first. `resolveCanonicalVenueId` is the wrong door here: it turns an
// unreadable alias file into the original id, and the not-found card would
// swallow a read we could not run. An unavailable alias lookup renders the
// read-unavailable surface, and the next request reads the file again. A
// missing id still renders the not-found card. A famous-venue seed that the
// old dataset index never held still opens, because the detail module folds
// those seeds.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { VENUE_ALIAS_FILES } from "@/lib/venueAliasesFile.mjs";

vi.mock("server-only", () => ({}));
const venueLookup = vi.hoisted(() => ({ throwNext: false }));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));
vi.mock("@/lib/venueDetailIndex", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/venueDetailIndex")>();
  return {
    ...actual,
    lookupVenueDetail: (id: string) => {
      if (venueLookup.throwNext) {
        venueLookup.throwNext = false;
        return Promise.reject(new Error("venue read threw"));
      }
      return actual.lookupVenueDetail(id);
    },
  };
});
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("next/og", () => ({
  ImageResponse: class ImageResponse {
    element: unknown;

    constructor(element: unknown) {
      this.element = element;
    }
  },
}));

const aliases = vi.hoisted(() => ({
  fail: false,
  reads: 0,
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  const readFile = actual.promises.readFile;
  const promises = {
    ...actual.promises,
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

import BarTabCard from "@/app/bar-tab/[id]/opengraph-image";
import BarTabPage, { generateMetadata as barTabMetadata } from "@/app/bar-tab/[id]/page";
import LedgerPage, { generateMetadata as ledgerMetadata } from "@/app/ledger/[id]/page";
import { clampOgText } from "@/lib/ogCardText";
import { resetVenueAliasesForTests } from "@/lib/venueAliases";
import { resetVenueDetailCachesForTests } from "@/lib/venueDetailIndex";
import { groupVenuePrices, type VenuePrice } from "@/lib/venues";
import { defined } from "@/__tests__/helpers/defined";

const ROOT = process.cwd();
const read = (file: string): string => readFileSync(join(ROOT, file), "utf8");

const rows = JSON.parse(read("public/data/pint_prices_app_dataset.json")) as VenuePrice[];
const venue = defined(groupVenuePrices(rows)[0]);
const FAMOUS_BAR_ID = "bar-american-bar-savoy";
const FAMOUS_BAR_NAME = "American Bar at The Savoy";

// A real merged duplicate id (D1): the only id whose page read must consult the
// alias artifact, so it is the id that proves an unreadable alias file is not an
// absent pub.
const aliasDoc = JSON.parse(read("public/data/venue_id_aliases.json")) as {
  aliases: Record<string, string>;
};
const mergedId = Object.keys(aliasDoc.aliases)[0];
const mergedCanonical = groupVenuePrices(rows).find(
  (row) => row.id === aliasDoc.aliases[defined(mergedId)],
)!;

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

function titleVenueName(title: unknown): string {
  const named = String(title).match(/^The Bar Tab: (.+)\. PUBMAXXING$/)?.[1];
  if (!named) throw new Error(`Bar Tab title did not name a pub: ${String(title)}`);
  return named;
}

beforeEach(() => {
  aliases.fail = false;
  aliases.reads = 0;
  venueLookup.throwNext = false;
  resetVenueAliasesForTests();
  resetVenueDetailCachesForTests();
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
    aliases.fail = true;
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
    expect(aliases.reads).toBe(1);

    // The unfurl claims nothing either way.
    const failed = await metadata({ params: Promise.resolve({ id: venue.id }) });
    expect(JSON.stringify(failed)).not.toContain(venue.name);
    expect(failed.robots).toEqual({ index: false, follow: false });
    expect(aliases.reads).toBe(2);

    // The failure was not cached: the files are readable again, and this
    // request opens every alias file and finds the pub.
    aliases.fail = false;
    const found = await metadata({ params: Promise.resolve({ id: venue.id }) });
    expect(String(found.title)).toContain(venue.name);
    expect(aliases.reads).toBe(2 + VENUE_ALIAS_FILES.length);
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
    aliases.fail = true;
    const markup = await render(page, defined(mergedId));
    expect(markup).toContain("We could not load this pub");
    expect(markup).not.toContain(notFoundLine);
    expect(markup).not.toContain("moved");
    expect(aliases.reads).toBe(1);

    // Nothing was cached from that failure: the next request opens the file.
    const again = await render(page, defined(mergedId));
    expect(again).toContain("We could not load this pub");
    expect(aliases.reads).toBe(2);

    // The file is readable again: the losing id opens its surviving pub.
    aliases.fail = false;
    const resolved = await render(page, defined(mergedId));
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
    for (const id of [venue.id, defined(mergedId), FAMOUS_BAR_ID]) {
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
    aliases.fail = true;
    for (const { id, name } of [
      { id: venue.id, name: venue.name },
      { id: defined(mergedId), name: mergedCanonical.name },
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
