import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { inGreaterLondon } from "../scripts/build_london_venue_shards.mjs";
import {
  drinkLinks,
  drinksEvidence,
  restaurantCandidate,
  searchBindsSite,
  statesRestaurantDrinks,
  taggedOwnSite,
  validateRestaurantDrinksPack,
} from "../scripts/lib/londonRestaurantDrinks.mjs";
import { statesAlcohol } from "../scripts/lib/ukOsmVenueSeed.mjs";

const observedAt = "2026-10-04T22:10:00.000Z";
const robots = { outcome: "allowed", checkedAt: "2026-10-04T22:09:00.000Z" };
const row = (overrides: Record<string, unknown> = {}) => ({
  osmId: "node/101",
  kind: "restaurant",
  name: "Trattoria Example",
  address: "12, Old Compton Street, W1D 4TQ",
  lat: 51.5133,
  lng: -0.1316,
  website: "https://www.trattoriaexample.co.uk/",
  siteFrom: "osm-website",
  evidence: [{ url: "https://www.trattoriaexample.co.uk/drinks", excerpt: "Our wine list runs to forty Italian bottles", observedAt, robots }],
  ...overrides,
});

describe("London restaurant drinks evidence", () => {
  it("reads a drinking line from the restaurant's own page and prefers the line that says most", () => {
    const page = "# Trattoria Example\n\nFresh pasta every day.\nPerfect with a glass of prosecco.\nCocktails, an Italian wine list and craft beers at the bar.";
    expect(drinksEvidence(page, "Trattoria Example")).toEqual({ quote: "Cocktails, an Italian wine list and craft beers at the bar." });
  });

  it("never takes the venue's own name as evidence", () => {
    expect(statesRestaurantDrinks("Welcome to The Wine Library on Great Tower Street", "The Wine Library")).toBe(false);
    expect(drinksEvidence("Welcome to Gin and Pasta, a family kitchen", "Gin and Pasta")).toEqual({});
  });

  it("does not read alcohol-free drinks, ginger beer or mocktails as alcohol", () => {
    expect(statesRestaurantDrinks("We serve alcohol-free beers and fresh juices", "Example")).toBe(false);
    expect(statesRestaurantDrinks("Homemade ginger beer and lemonade", "Example")).toBe(false);
    expect(statesRestaurantDrinks("Mocktails and milkshakes for everyone", "Example")).toBe(false);
    expect(statesRestaurantDrinks("Non-alcoholic cocktails and alcohol-free wine", "Example")).toBe(false);
    expect(statesRestaurantDrinks("Cocktails and mocktails at the bar", "Example")).toBe(true);
  });

  it("does not read a drink cooked into a dish as a drink served", () => {
    expect(statesRestaurantDrinks("Pork bone soup, usukuchi, sea-salt, mirin and sake tare", "Example")).toBe(false);
    expect(statesRestaurantDrinks("Beer-battered cod with chips and mushy peas", "Example")).toBe(false);
    expect(statesRestaurantDrinks("Braised short rib in a red wine sauce", "Example")).toBe(false);
    expect(statesRestaurantDrinks("Beer-battered cod, and a pint of lager to go with it", "Example")).toBe(true);
  });

  it("settles a bring-your-own or no-alcohol restaurant as not pouring, whatever else the page says", () => {
    expect(drinksEvidence("Great curries and beers nearby.\nWe are BYOB - no corkage charge.", "Example")).toEqual({ refused: "We are BYOB - no corkage charge." });
    expect(drinksEvidence("Please note we do not serve alcohol on the premises.", "Example").refused).toBeTruthy();
    expect(drinksEvidence("No alcohol served to under 18s. Cocktails from 5pm.", "Example")).toEqual({ quote: "No alcohol served to under 18s. Cocktails from 5pm." });
  });

  it("ignores copyright footers", () => {
    expect(drinksEvidence("© 2017 Terroirs Natural Wine Group", "Terroirs")).toEqual({});
  });

  it("follows drinks pages before menus, on the same site only", () => {
    const page = "[Book](/book) [Menus](/menus) [Drinks](/drinks) [Wine list](https://www.example-trattoria.co.uk/wine) [Elsewhere](https://other.example.com/drinks) ![bar](/bar.jpg)";
    expect(drinkLinks(page, "https://www.example-trattoria.co.uk/")).toEqual([
      "https://www.example-trattoria.co.uk/drinks",
      "https://www.example-trattoria.co.uk/wine",
      "https://www.example-trattoria.co.uk/menus",
    ]);
  });

  it("takes an OSM website tag only when it names a site of the restaurant's own", () => {
    expect(taggedOwnSite("www.trattoriaexample.co.uk")).toBe("https://www.trattoriaexample.co.uk/");
    expect(taggedOwnSite("https://deliveroo.co.uk/menu/london/soho/trattoria")).toBeNull();
    expect(taggedOwnSite("https://www.facebook.com/trattoria")).toBeNull();
    expect(taggedOwnSite("")).toBeNull();
  });

  it("binds a search result only when its host carries the name and its text states this restaurant's postcode or street", () => {
    const candidate = { name: "Trattoria Fenice", postcode: "W1D 4TQ", street: "Old Compton Street", housenumber: "12" };
    expect(searchBindsSite(candidate, { url: "https://www.trattoriafenice.co.uk/", content: "Find us at 12 Old Compton Street, Soho" })).toBe("https://www.trattoriafenice.co.uk/");
    expect(searchBindsSite(candidate, { url: "https://www.trattoriafenice.co.uk/", content: "Visit us at W1D4TQ" })).toBe("https://www.trattoriafenice.co.uk/");
    expect(searchBindsSite(candidate, { url: "https://www.trattoriafenice.co.uk/", content: "Our Leeds branch, LS1 4AP" })).toBeNull();
    expect(searchBindsSite(candidate, { url: "https://www.tripadvisor.co.uk/fenice", content: "W1D 4TQ" })).toBeNull();
  });

  it("keeps OSM restaurants that state nothing about alcohol, and leaves out those that state it either way", () => {
    const element = (tags: Record<string, string>) => ({ type: "node", id: 7, lat: 51.51, lon: -0.13, tags: { amenity: "restaurant", name: "Fenice", ...tags } });
    expect(restaurantCandidate(element({ "addr:postcode": "W1D 4TQ", website: "https://fenice.co.uk" }), { statesAlcohol })).toMatchObject({ osmId: "node/7", postcode: "W1D 4TQ", website: "https://fenice.co.uk/" });
    expect(restaurantCandidate(element({ bar: "yes" }), { statesAlcohol })).toBeNull();
    expect(restaurantCandidate(element({ alcohol: "no" }), { statesAlcohol })).toBeNull();
    expect(restaurantCandidate(element({ amenity: "cafe" }), { statesAlcohol })).toBeNull();
  });

  it("refuses a published row without own-site evidence, robots permission, a read date or a London position", () => {
    const check = (rows: unknown[]) => validateRestaurantDrinksPack({ rows }, { inGreaterLondon });
    expect(check([row()])).toEqual([]);
    expect(check([row({ evidence: [{ ...row().evidence[0], url: "https://www.tripadvisor.co.uk/x" }] })])).not.toEqual([]);
    expect(check([row({ evidence: [{ ...row().evidence[0], robots: { outcome: "refused", checkedAt: observedAt } }] })])).not.toEqual([]);
    expect(check([row({ evidence: [{ ...row().evidence[0], observedAt: "yesterday" }] })])).not.toEqual([]);
    expect(check([row({ evidence: [{ ...row().evidence[0], excerpt: "Trattoria Example, Soho" }] })])).not.toEqual([]);
    expect(check([row({ lat: 53.48, lng: -2.24 })])).not.toEqual([]);
    expect(check([row(), row()])).toEqual(["node/101: repeated"]);
  });

  it("the committed pack passes its own check", () => {
    const pack = JSON.parse(readFileSync(path.join(process.cwd(), "data/london_restaurant_drinks/evidence.json"), "utf8"));
    expect(validateRestaurantDrinksPack(pack, { inGreaterLondon })).toEqual([]);
    expect(pack.rows.length).toBeGreaterThan(0);
  });
});
