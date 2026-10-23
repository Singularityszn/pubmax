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
    ["venue-liv-1xzq0ay", "McGreavy's", "Shirin cafe", "CafeOrCoffeeShop", "business-shirin-cafe-1985141", "3-4 Williamson Square", "L1 1EQ"],
    ["venue-we2z9j", "Betty", "Lil' Nashville", "BarOrPub", "business-lil-nashville-490209", "11 Barley Mow Passage", "W4 4PH"],
    ["venue-o6ns02", "Friends Bar & Restaurant", "Cinco Coffee Lounge", "CafeOrCoffeeShop", "business-cinco-coffee-lounge-1937073", "202 High Road Leytonstone", "E11 3HU"],
  ])("describes the evidenced business at %s separately from its earlier record", async (id, oldName, name, type, anchor, streetAddress, postalCode) => {
    const read = await lookupVenueDetail(id);
    expect(read.status).toBe("found");
    if (read.status !== "found") throw new Error(`Missing earlier venue: ${id}`);
    expect(read.venue.name).toBe(oldName);
    const records = await ledgerSchema(id);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      "@type": type,
      "@id": `https://pubmaxxing.com/ledger/${id}#${anchor}`,
      name,
      url: `https://pubmaxxing.com/ledger/${id}#${anchor}`,
      address: { "@type": "PostalAddress", streetAddress, postalCode, addressCountry: "GB" },
    });
    const html = renderToStaticMarkup(await LedgerPage({ params: Promise.resolve({ id }) }));
    expect(html).toContain('Earlier venue record');
    expect(html).toContain(`id="${anchor}"`);
    expect(html).toContain('Current business listed at this address');
    expect(html).toContain('23 October 2026');
    expect(html).toContain('Food Standards Agency');
    expect(html.indexOf(`id="${anchor}"`)).toBeLessThan(html.indexOf('id="ledgerPriceHeading"'));
    for (const field of ["geo", "priceRange", "aggregateRating", "review", "openingHours", "openingHoursSpecification", "alternateName", "image"]) {
      expect(records[0]).not.toHaveProperty(field);
    }
    expect(records[0]?.name).not.toBe(oldName);
  });

  it("uses the curated canonical schema for a historical national alias", async () => {
    const canonical = await ledgerSchema("venue-sy8k64");
    expect(canonical).toHaveLength(1);
    expect(canonical[0]).toHaveProperty("url", "https://pubmaxxing.com/ledger/venue-sy8k64");
    expect(await ledgerSchema("venue-uk-n269255191")).toEqual(canonical);
    expect(await ledgerSchema("venue-uk-n999999999999999")).toEqual([]);
  });

  it("shows sourced optional facts for the current business without filling unknown fields", async () => {
    for (const fact of [
      { id: "venue-we2z9j", telephone: "+442046198285", display: "020 4619 8285", cuisine: "Southern American", source: "https://www.lilnashville.co.uk/contact" },
      { id: "venue-o6ns02", telephone: "+447955555404", display: "079 55555 404", cuisine: null, source: "https://coffeelounge.uk/" },
      { id: "venue-liv-1xzq0ay", telephone: null, display: null, cuisine: null, source: null },
    ]) {
      const [schema] = await ledgerSchema(fact.id);
      const html = renderToStaticMarkup(await LedgerPage({ params: Promise.resolve({ id: fact.id }) }));
      const panel = /<section class="ledgerIdentity"[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
      if (fact.telephone) {
        expect(schema).toHaveProperty("telephone", fact.telephone);
        expect(panel).toContain(`href="tel:${fact.telephone}"`);
        expect(panel).toContain(fact.display);
        expect(panel).toContain(`href="${fact.source}"`);
      } else {
        expect(schema).not.toHaveProperty("telephone");
        expect(panel).not.toContain('href="tel:');
      }
      if (fact.cuisine) {
        expect(schema).toHaveProperty("servesCuisine", fact.cuisine);
        expect(panel).toContain(fact.cuisine);
        expect(panel).toContain('href="https://www.lilnashville.co.uk/post/things-to-do-in-chiswick-lil-nashville"');
      } else {
        expect(schema).not.toHaveProperty("servesCuisine");
      }
      expect(schema).not.toHaveProperty("priceRange");
      expect(schema).not.toHaveProperty("image");
    }
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
