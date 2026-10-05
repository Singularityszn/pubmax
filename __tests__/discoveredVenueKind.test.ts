import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { defined } from "@/__tests__/helpers/defined";
import { assembleCityDiscoveries, discoveredKind, gateVenueEvidence, parseTaskVenues } from "../scripts/lib/parallelVenueDiscovery.mjs";

const city = { id: "birmingham", displayName: "Birmingham", bbox: [52.42, -1.98, 52.55, -1.8] as [number, number, number, number] };
const quoted = (name: string, kind: string, ...excerpts: string[]) => ({ name, kind, evidence: excerpts.map((excerpt) => ({ url: "https://camra.org.uk/pubs/x", excerpt })) });
const ownSite = (name: string, kind: string, ...excerpts: string[]) => ({ name, kind, evidence: excerpts.map((excerpt) => ({ url: "https://example-venue.co.uk/", excerpt })) });
const allowed = async () => ({ outcome: "allowed" });

describe("discovered venue kind", () => {
  it.each([
    ["the evidence says it is a members' club", quoted("Pickle Club", "bar", "Pickle Club, Birmingham (Pickled Cabbage)", "This is a club, which means that the bar may be only open to members.")],
    ["CAMRA labels it a club", quoted("Dunelm Club", "bar", "Dunelm Club Club , in Durham", "55 Old Elvet, Durham, DH1 3HN")],
    ["CAMRA's label follows the name", quoted("Sacred Heart Club", "bar", "Sacred Heart Sacred Heart Club, in Birmingham Cask Ale 28 Grange Road, Aston, Birmingham, B6 6LA")],
    ["a pub's evidence says it is a members' club", quoted("Grange Social Club", "pub", "Real ale in the members' bar")],
  ])("is a club when %s", (_, row) => {
    expect(discoveredKind(row)).toBe("club");
  });

  it.each([
    ["a bar brand only carries the word", quoted("Cosy Club Birmingham", "bar", "Standing proudly on Bennett’s Hill, you’ll find Cosy Club Birmingham.", "expertly crafted cocktails")],
    ["a restaurant only carries the word", quoted("The Oyster Club by Adam Stokes", "restaurant", "The Oyster Club by Adam Stokes.", "Our newly launched Drinks List features Premium Cocktails")],
    ["a darts bar only carries the word", quoted("The Rectory 180 Club", "bar", "This two-floor Birmingham darts bar combines cutting-edge gameplay with expertly crafted cocktails")],
    ["a golf bar brand only carries a sport and the word", quoted("Junkyard Golf Club", "bar", "Crazy golf and a cocktail bar with DJs every weekend")],
    ["only its name says it is a sports club", quoted("Edgbaston Golf Club", "bar", "Both the Restaurant and the Bar Menu are available all day.")],
    ["only its name says it is a working men's club", quoted("Tyseley Working Mens Club", "bar", "we also show many of the major sporting events in our bar")],
    ["its own site writes the name before a comma and in", ownSite("Cosy Club", "bar", "Cosy Club, in the old bank on Bennetts Hill, serves cocktails")],
    ["CAMRA labels it a pub", quoted("Ukrainian Club", "pub", "[### Ukrainian Club  Pub, in Manchester]  **Cask Ale not available**")],
    ["the word club is not in its name or evidence", quoted("Copper Rooms", "bar", "Copper Rooms social cocktail bar, members welcome")],
    ["the bar only hosts club nights", quoted("The Copper Rooms", "bar", "club nights every Friday with cocktails")],
    ["the evidence only describes a social bar", quoted("Hall Green H.G. Club", "bar", "Join us to enjoy the social bar area")],
    ["the evidence only mentions a nightclub", quoted("The Loft", "bar", "The Loft is a late-night bar and nightclub with cocktails")],
    ["research names it a restaurant", quoted("Harborne Cricket Club", "restaurant", "Harborne Cricket Club clubhouse restaurant", "Our wine list pairs with every dish")],
  ])("keeps its kind when %s", (_, row) => {
    expect(discoveredKind(row)).toBe(row.kind);
  });

  it("files a stored club that its evidence no longer supports back as a bar", () => {
    expect(discoveredKind(quoted("Hall Green H.G. Club", "club", "Join us to enjoy the social bar area"))).toBe("bar");
    expect(discoveredKind(quoted("Ward End Social Club", "club", "This is a club with cask ales in our bar"))).toBe("club");
  });

  it("files fresh research and stored rows as clubs at publication", async () => {
    const excerpts = ["Ward End Social Club, 10 St. Margarets Road, Ward End, Birmingham, B8 2BA", "This is a club, which means that the bar may only be open to club members."];
    const raw = { output: { type: "json", content: { venues: [{ name: "Ward End Social Club", kind: "bar", address: "10 St. Margarets Road, Ward End, Birmingham, B8 2BA", website: null, lat: null, lng: null,
      evidence: excerpts.map((excerpt) => ({ url: "https://camra.org.uk/pubs/ward-end", excerpt })) }] },
      basis: [{ field: "venues.0", confidence: "high", citations: [{ url: "https://camra.org.uk/pubs/ward-end", excerpts }] }] } };
    const [candidate] = parseTaskVenues(raw, city, "2026-10-04T10:00:00Z").candidates;
    const found = { ...defined(candidate, "the parsed candidate"), lat: 52.49, lng: -1.83, coordinatePrecision: "postcode-centroid" as const };
    expect((await gateVenueEvidence([found], city, allowed)).venues.map((row) => row.kind)).toEqual(["club"]);
    const assembled = assembleCityDiscoveries({ found: [], previous: [{ ...found, id: "venue-bhm-ward" }], existing: [], city }).venues;
    expect((await gateVenueEvidence(assembled, city, allowed)).venues.map((row) => row.kind)).toEqual(["club"]);
  });

  it("judges the kind from the evidence permission leaves", async () => {
    const camra = "https://camra.org.uk/pubs/pickle";
    const site = "https://pickleclub.co.uk/";
    const row = { name: "Pickle Club", kind: "bar" as const, address: "12 Test Street, Birmingham, B1 1AA", postcode: "B1 1AA", locality: city.displayName, website: site,
      lat: 52.48, lng: -1.9, coordinatePrecision: "postcode-centroid" as const, sourceUrls: [camra, site], observedAt: "2026-10-04T10:00:00Z",
      evidence: [{ url: camra, excerpt: "Pickle Club, 12 Test Street, Birmingham, B1 1AA. A friendly bar with cask ale." }, { url: site, excerpt: "This is a club, open to members." }] };
    expect((await gateVenueEvidence([row], city, allowed)).venues.map((venue) => venue.kind)).toEqual(["club"]);
    const gated = await gateVenueEvidence([row, { ...row, kind: "club" as const }], city, async (url) => ({ outcome: url === camra ? "allowed" : "refused" }));
    expect(gated.venues.map((venue) => [venue.kind, venue.sourceUrls])).toEqual([["bar", [camra]], ["bar", [camra]]]);
  });

  it("keeps a club-named restaurant that only its restaurant evidence admits", async () => {
    const url = "https://camra.org.uk/pubs/harborne";
    const stored = { name: "Harborne Cricket Club", kind: "restaurant" as const, address: "Old Church Avenue, Harborne, Birmingham, B17 0BB", postcode: "B17 0BB",
      locality: city.displayName, website: null, lat: 52.46, lng: -1.95, coordinatePrecision: "postcode-centroid" as const, sourceUrls: [url], observedAt: "2026-10-04T10:00:00Z",
      evidence: [{ url, excerpt: "Harborne Cricket Club, Old Church Avenue, Harborne, Birmingham, B17 0BB" }, { url, excerpt: "Our clubhouse wine list pairs with every dish" }] };
    const assembled = assembleCityDiscoveries({ found: [], previous: [stored], existing: [], city }).venues;
    expect((await gateVenueEvidence(assembled, city, allowed)).venues.map((row) => row.kind)).toEqual(["restaurant"]);
  });

  it("leaves no committed discovery under a kind its evidence contradicts", () => {
    const cities = path.join(__dirname, "..", "data/cities");
    const rows = readdirSync(cities).flatMap((id) => {
      const file = path.join(cities, id, "parallel_venues.json");
      if (!existsSync(file)) return [];
      const pack = JSON.parse(readFileSync(file, "utf8")) as { venues: Array<{ name: string; kind: string; evidence: Array<{ url: string; excerpt: string }> }> };
      return pack.venues.map((row) => ({ ...row, city: id }));
    });
    expect(rows.filter((row) => row.kind === "club").length).toBeGreaterThan(0);
    expect(rows.filter((row) => discoveredKind(row) !== row.kind).map((row) => `${row.city}: ${row.name}`)).toEqual([]);
  });
});
