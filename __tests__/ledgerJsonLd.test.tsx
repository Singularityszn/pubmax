import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));

import LedgerPage from "@/app/ledger/[id]/page";
import { lookupVenueDetail } from "@/lib/venueDetailIndex";

async function ledgerSchema(id: string): Promise<Array<Record<string, unknown>>> {
  const document = renderToStaticMarkup(await LedgerPage({ params: Promise.resolve({ id }) }));
  return Array.from(
    document.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g),
    (match) => JSON.parse(match[1]!),
  );
}

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

  it.each([
    ["venue-liv-1xzq0ay", "McGreavy's"],
    ["venue-we2z9j", "Betty"],
    ["venue-o6ns02", "Friends Bar & Restaurant"],
  ])("withholds disputed pub classification for %s without replacing its history", async (id, name) => {
    const read = await lookupVenueDetail(id);
    expect(read.status).toBe("found");
    if (read.status !== "found") throw new Error(`Missing disputed venue: ${id}`);
    expect(read.venue.name).toBe(name);
    expect(await ledgerSchema(id)).toEqual([]);
  });

  it("uses the curated canonical schema for a historical national alias", async () => {
    const canonical = await ledgerSchema("venue-sy8k64");
    expect(canonical).toHaveLength(1);
    expect(canonical[0]).toHaveProperty("url", "https://pubmaxxing.com/ledger/venue-sy8k64");
    expect(await ledgerSchema("venue-uk-n269255191")).toEqual(canonical);
    expect(await ledgerSchema("venue-uk-n999999999999999")).toEqual([]);
  });

  it("does not claim a known area as a street address", async () => {
    const [schema] = await ledgerSchema("venue-mtvaah");
    expect(schema).toMatchObject({ address: { addressLocality: "Southwark" } });
    expect(schema?.address).not.toHaveProperty("streetAddress");
    const html = renderToStaticMarkup(await LedgerPage({ params: Promise.resolve({ id: "venue-mtvaah" }) }));
    expect(html).toContain('<p class="ledgerAddress">Southwark</p>');
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
