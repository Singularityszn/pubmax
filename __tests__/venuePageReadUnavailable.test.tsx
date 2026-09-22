// A DATASET WE COULD NOT READ IS NOT A PUB THAT DOES NOT EXIST.
//
// `/bar-tab/[id]`, `/ledger/[id]` and `/api/venue/[id]` share one venue-detail
// boundary. A read that boundary could not run must render unavailable, never
// an unknown pub, and the next request must ask the boundary again.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));

const venueDetail = vi.hoisted(() => ({
  lookup: vi.fn(),
}));

vi.mock("@/lib/venueDetailIndex", () => ({
  lookupVenueDetail: venueDetail.lookup,
}));

import BarTabPage, { generateMetadata as barTabMetadata } from "@/app/bar-tab/[id]/page";
import LedgerPage, { generateMetadata as ledgerMetadata } from "@/app/ledger/[id]/page";
import { groupVenuePrices, type VenuePrice } from "@/lib/venues";

const ROOT = process.cwd();
const read = (file: string): string => readFileSync(join(ROOT, file), "utf8");

const rows = JSON.parse(read("public/data/pint_prices_app_dataset.json")) as VenuePrice[];
const venue = groupVenuePrices(rows)[0];

async function render(page: (props: { params: Promise<{ id: string }> }) => Promise<unknown>, id: string) {
  const element = await page({ params: Promise.resolve({ id }) });
  return renderToStaticMarkup(createElement(() => element as React.ReactElement));
}

beforeEach(() => {
  venueDetail.lookup.mockReset();
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
])("$surface over a venue-detail read that failed", ({ page, metadata, href, notFoundLine, titleClass }) => {
  it("answers unavailable and asks the shared boundary again on the next request", async () => {
    venueDetail.lookup
      .mockResolvedValueOnce({ status: "unavailable" })
      .mockResolvedValueOnce({ status: "unavailable" })
      .mockResolvedValue({ status: "found", venue });

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
    expect(venueDetail.lookup).toHaveBeenCalledTimes(1);
    expect(venueDetail.lookup).toHaveBeenLastCalledWith(venue.id, {
      includeHarvestOverlay: false,
    });

    // The unfurl claims nothing on the next failed read either. Reaching the
    // boundary twice proves the page did not cache the unavailable answer.
    const failed = await metadata({ params: Promise.resolve({ id: venue.id }) });
    expect(JSON.stringify(failed)).not.toContain(venue.name);
    expect(failed.robots).toEqual({ index: false, follow: false });
    expect(venueDetail.lookup).toHaveBeenCalledTimes(2);

    // The following request can recover immediately.
    const found = await metadata({ params: Promise.resolve({ id: venue.id }) });
    expect(String(found.title)).toContain(venue.name);
    expect(venueDetail.lookup).toHaveBeenCalledTimes(3);
    expect(venueDetail.lookup).toHaveBeenLastCalledWith(venue.id, {
      includeHarvestOverlay: false,
    });
  });

  it("keeps missing distinct from unavailable", async () => {
    venueDetail.lookup.mockResolvedValue({ status: "missing" });
    const markup = await render(page, "venue-does-not-exist");
    expect(markup).toContain(notFoundLine);
    expect(markup).toContain("moved");
    expect(markup).not.toContain("We could not load this pub");
  });
});
