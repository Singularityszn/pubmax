import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assembleCityDiscoveries, discoveredKind, parseTaskVenues, validateDiscoveryPack } from "../scripts/lib/parallelVenueDiscovery.mjs";

const city = { id: "birmingham", displayName: "Birmingham", bbox: [52.42, -1.98, 52.55, -1.8] as [number, number, number, number] };
const quoted = (name: string, kind: string, ...excerpts: string[]) => ({ name, kind, evidence: excerpts.map((excerpt) => ({ url: "https://camra.org.uk/pubs/x", excerpt })) });

describe("discovered venue kind", () => {
  it.each([
    ["the evidence says it is a members' club", quoted("Pickle Club", "bar", "Pickle Club, Birmingham (Pickled Cabbage)", "This is a club, which means that the bar may be only open to members.")],
    ["CAMRA labels it a club", quoted("Dunelm Club", "bar", "Dunelm Club Club , in Durham", "55 Old Elvet, Durham, DH1 3HN")],
    ["CAMRA's label follows the name", quoted("Sacred Heart Club", "bar", "Sacred Heart Sacred Heart Club, in Birmingham Cask Ale 28 Grange Road, Aston, Birmingham, B6 6LA")],
    ["the name says it is a sports club", quoted("Edgbaston Golf Club", "bar", "Both the Restaurant and the Bar Menu are available all day.")],
    ["the name says it is a working men's club", quoted("Tyseley Working Mens Club", "bar", "we also show many of the major sporting events in our bar")],
    ["the evidence describes a social bar", quoted("Hall Green H.G. Club", "bar", "Join us to enjoy the social bar area")],
  ])("is a club when %s", (_, row) => {
    expect(discoveredKind(row)).toBe("club");
  });

  it.each([
    ["a bar brand only carries the word", quoted("Cosy Club Birmingham", "bar", "Standing proudly on Bennett’s Hill, you’ll find Cosy Club Birmingham.", "expertly crafted cocktails")],
    ["a restaurant only carries the word", quoted("The Oyster Club by Adam Stokes", "restaurant", "The Oyster Club by Adam Stokes.", "Our newly launched Drinks List features Premium Cocktails")],
    ["a darts bar only carries the word", quoted("The Rectory 180 Club", "bar", "This two-floor Birmingham darts bar combines cutting-edge gameplay with expertly crafted cocktails")],
    ["CAMRA labels it a pub", quoted("Ukrainian Club", "pub", "[### Ukrainian Club  Pub, in Manchester]  **Cask Ale not available**")],
    ["the word club is not in its name or evidence", quoted("Copper Rooms", "bar", "Copper Rooms social cocktail bar, members welcome")],
    ["the bar only hosts club nights", quoted("The Copper Rooms", "bar", "club nights every Friday with cocktails")],
    ["the evidence only mentions a nightclub", quoted("The Loft", "bar", "The Loft is a late-night bar and nightclub with cocktails")],
    ["research names it a restaurant", quoted("Harborne Cricket Club", "restaurant", "Harborne Cricket Club clubhouse restaurant", "Our wine list pairs with every dish")],
  ])("keeps its kind when %s", (_, row) => {
    expect(discoveredKind(row)).toBe(row.kind);
  });

  it("classifies fresh research and stored rows the same way", () => {
    const excerpts = ["Ward End Social Club, 10 St. Margarets Road, Ward End, Birmingham, B8 2BA", "This is a club, which means that the bar may only be open to club members."];
    const raw = { output: { type: "json", content: { venues: [{ name: "Ward End Social Club", kind: "bar", address: "10 St. Margarets Road, Ward End, Birmingham, B8 2BA", website: null, lat: null, lng: null,
      evidence: excerpts.map((excerpt) => ({ url: "https://camra.org.uk/pubs/ward-end", excerpt })) }] },
      basis: [{ field: "venues.0", confidence: "high", citations: [{ url: "https://camra.org.uk/pubs/ward-end", excerpts }] }] } };
    const [candidate] = parseTaskVenues(raw, city, "2026-10-04T10:00:00Z").candidates;
    expect(candidate.kind).toBe("club");
    const stored = { ...candidate, kind: "bar" as const, id: "venue-bhm-ward", lat: 52.49, lng: -1.83, coordinatePrecision: "postcode-centroid" as const };
    expect(validateDiscoveryPack({ city: city.id, venues: [{ ...stored, kind: "club" }] }, city).venues).toHaveLength(1);
    expect(assembleCityDiscoveries({ found: [], previous: [stored], existing: [], city }).venues.map((row) => row.kind)).toEqual(["club"]);
  });

  it("keeps a club-named restaurant that only its restaurant evidence admits", () => {
    const url = "https://camra.org.uk/pubs/harborne";
    const stored = { name: "Harborne Cricket Club", kind: "restaurant" as const, address: "Old Church Avenue, Harborne, Birmingham, B17 0BB", postcode: "B17 0BB",
      locality: city.displayName, website: null, lat: 52.46, lng: -1.95, coordinatePrecision: "postcode-centroid" as const, sourceUrls: [url], observedAt: "2026-10-04T10:00:00Z",
      evidence: [{ url, excerpt: "Harborne Cricket Club, Old Church Avenue, Harborne, Birmingham, B17 0BB" }, { url, excerpt: "Our wine list pairs with every dish" }] };
    expect(assembleCityDiscoveries({ found: [], previous: [stored], existing: [], city }).venues.map((row) => row.kind)).toEqual(["restaurant"]);
  });

  it("leaves no committed discovery under a kind its evidence contradicts", () => {
    const cities = path.join(__dirname, "..", "data/cities");
    const rows = readdirSync(cities).flatMap((id) => {
      const file = path.join(cities, id, "parallel_venues.json");
      if (!existsSync(file)) return [];
      const pack = JSON.parse(readFileSync(file, "utf8")) as { venues: Array<{ name: string; kind: string; evidence: Array<{ excerpt: string }> }> };
      return pack.venues.map((row) => ({ ...row, city: id }));
    });
    expect(rows.filter((row) => row.kind === "club").length).toBeGreaterThan(0);
    expect(rows.filter((row) => discoveredKind(row) !== row.kind).map((row) => `${row.city}: ${row.name}`)).toEqual([]);
  });
});
