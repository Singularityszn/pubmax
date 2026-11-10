import { Children, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));

import LedgerPage from "@/app/ledger/[id]/page";
import { lookupVenueDetail } from "@/lib/venueDetailIndex";
import { LedgerPriceRecord } from "@/components/ledger/LedgerLive";
import type { VenueBundlePrices } from "@/lib/venuePriceLane";

function priceRecordBundle(node: ReactNode): VenueBundlePrices | undefined {
  let bundle: VenueBundlePrices | undefined;
  Children.forEach(node, (child) => {
    if (!isValidElement<{ children?: ReactNode; bundle?: VenueBundlePrices }>(child)) return;
    if (child.type === LedgerPriceRecord) bundle = child.props.bundle;
    else bundle ??= priceRecordBundle(child.props.children);
  });
  return bundle;
}

async function ledgerSchema(id: string): Promise<Array<Record<string, unknown>>> {
  const document = renderToStaticMarkup(await LedgerPage({ params: Promise.resolve({ id }) }));
  return Array.from(
    document.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g),
    (match) => JSON.parse(match[1]!),
  );
}

describe("the Ledger's price inputs", () => {
  it("retains an empty beer bundle for a bar with no recorded beer price", async () => {
    const page = await LedgerPage({ params: Promise.resolve({ id: "venue-1vycgfn" }) });
    expect(priceRecordBundle(page)).toEqual({ listed: null, estimate: null });
  });

  it("still gives an unpriced pub its zone estimate", async () => {
    const page = await LedgerPage({ params: Promise.resolve({ id: "venue-60y3sa" }) });
    expect(priceRecordBundle(page)?.estimate).toMatchObject({
      priceGbp: 5.7, basis: "zone_median", zone: 2, sampleSize: 290,
    });
  });
});

describe("the canonical venue document's structured data", () => {
  it("keeps the real pub's name, address, coordinates and canonical URL", async () => {
    const records = await ledgerSchema("venue-1vle947");

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      "@context": "https://schema.org",
      "@type": "BarOrPub",
      name: "The Sir Christopher Hatton",
      url: "https://pubmaxxing.com/ledger/venue-1vle947",
      address: { "@type": "PostalAddress", addressLocality: "Hatton Garden", addressCountry: "GB" },
      geo: { "@type": "GeoCoordinates", latitude: 51.51816, longitude: -0.1089 },
    });
    for (const field of ["priceRange", "aggregateRating", "review", "openingHours", "openingHoursSpecification"]) {
      expect(records[0]).not.toHaveProperty(field);
    }
  });

  it.each([
    ["restaurant-rules", "restaurant"],
    ["food-best-turkish-kebab", "food"],
  ])("does not label %s as a pub", async (id, kind) => {
    const read = await lookupVenueDetail(id);
    expect(read.status).toBe("found");
    if (read.status !== "found") throw new Error(`Missing fixture venue: ${id}`);
    expect(read.venue.kind).toBe(kind);
    expect(await ledgerSchema(id)).toEqual([]);
  });

  it("keeps BarOrPub for an explicitly classified bar", async () => {
    const read = await lookupVenueDetail("bar-american-bar-savoy");
    expect(read.status).toBe("found");
    if (read.status !== "found") throw new Error("Missing bar fixture");
    expect(read.venue.kind).toBe("bar");
    expect(await ledgerSchema(read.venue.id)).toEqual([
      expect.objectContaining({ "@type": "BarOrPub", name: "American Bar at The Savoy" }),
    ]);
  });
});
