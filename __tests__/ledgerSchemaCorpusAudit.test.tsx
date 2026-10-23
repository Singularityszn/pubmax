import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));

import LedgerPage from "@/app/ledger/[id]/page";
import schemaWithheld from "@/data/bar_or_pub_schema_withheld.json";
import { getVenueIndexSnapshot } from "@/lib/venueIndex";

function text(value: string) {
  return renderToStaticMarkup(<>{value}</>);
}

describe("every indexed Ledger document", () => {
  it("emits only supported pub classifications with visible required fields", async () => {
    const snapshot = await getVenueIndexSnapshot();
    expect(snapshot.complete).toBe(true);
    expect(snapshot.index.size).toBeGreaterThan(0);
    const withheld = new Set(schemaWithheld.venues.map((row) => row.venueId));
    for (const [id, venue] of snapshot.index) {
      const html = renderToStaticMarkup(await LedgerPage({ params: Promise.resolve({ id }) }));
      const schemas = Array.from(
        html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g),
        (match) => JSON.parse(match[1]!),
      );
      const eligibleKind = ["pub", "bar"].includes(venue.kind ?? "pub");
      expect(schemas, id).toHaveLength(Number(eligibleKind && !withheld.has(id)));
      for (const schema of schemas) {
        expect(schema["@type"], id).toBe("BarOrPub");
        expect(schema.name.trim(), id).not.toBe("");
        expect(html, id).toContain(`>${text(schema.name)}</h1>`);
        expect(schema.url, id).toBe(`https://pubmaxxing.com/ledger/${encodeURIComponent(id)}`);
        expect(schema.address?.["@type"], id).toBe("PostalAddress");
        const address = /<p class="ledgerAddress">([\s\S]*?)<\/p>/.exec(html)?.[1] ?? "";
        const knownParts = [schema.address.streetAddress, schema.address.addressLocality]
          .filter((part): part is string => typeof part === "string" && part.trim().length > 0);
        expect(knownParts.length, id).toBeGreaterThan(0);
        for (const part of knownParts) expect(address, id).toContain(text(part));
        if (schema.description) expect(html, id).toContain(text(schema.description));
        if (schema.additionalProperty) expect(html, id).toContain(`href="${text(schema.additionalProperty.url)}"`);
        if (schema.geo) {
          expect(Number.isFinite(schema.geo.latitude), id).toBe(true);
          expect(Number.isFinite(schema.geo.longitude), id).toBe(true);
          expect(Math.abs(schema.geo.latitude), id).toBeLessThanOrEqual(90);
          expect(Math.abs(schema.geo.longitude), id).toBeLessThanOrEqual(180);
        }
      }
    }
  });
});
