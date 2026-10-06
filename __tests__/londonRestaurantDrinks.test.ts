import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { inGreaterLondon } from "../scripts/build_london_venue_shards.mjs";
import {
  drinkLinks,
  drinksEvidence,
  excludedOsmIds,
  pairExtractResults,
  restaurantCandidate,
  retryableUnreadable,
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

  it("does not read a dish, an ingredient list or an idiom that names a drink as a drink served", () => {
    for (const line of [
      "Prawn Cocktail",
      "Joe's shrimp cocktail, tempura shrimp, brandy mayo",
      "Tarboush Fruit Cocktail",
      "Native Lobster Cocktail",
      "Grilled beef patty, tomato, lettuce, pickles, coleslaw, and cocktail sauce",
      "SAKE TERIYAKI",
      "Sake x 3 pcs",
      "strawberry grape, sake lees, white chocolate",
      "Steamed Seabass £17.50 Add + Sake & soya ponzu",
      "chives, yuzu, sake, soy",
      "Champagne Pearl Vintage Cake",
      "Haozhan Champagne Cod",
      "BRAISED LEEKS, WHITE CRAB AND CHAMPAGNE VINAIGRETTE 14",
      "1. Apple cider vinaigrette",
      "Meatballs in a red wine & tomato sauce",
      "Deep fried breaded olives with beef, pork and white wine filling.",
      "Creamy Arborio rice simmered with fresh seafood, white wine and saffron.",
      "Prawns, green peas, sun dried tomato, white wine and Italian herbs.",
      "Mussels, cherry tomato, garlic, chilli, parsley & white wine with pizza dough crust",
      "Feta, tomato sauce, white wine",
      "Sauté new potatoes, spring onion, samphire, white wine cream sauce",
      "Grilled whole trout in wine, capers, olives and tomato sauce served with vegetables",
      "Sweetheart cabbage wok fried with garlic, fresh chilli and rice wine.",
      "We don’t use beer in our batter.",
      "Fresh Plaice Fillets cook in Marinated Rice Wine",
      "Pork sausage marinated in full bodied red wine",
      "Chicken thighs marinated in sake and miso",
      "Influenced by restaurants such as The River Cafe, St John Bread & Wine and Spring",
      "Free Champagne Flutes with orders over £99",
      "Virgin-Gin Mule",
      "A place of abundance, high spirits and generosity.",
      "Gan gin gan yuu – As you eat, so you are",
      "The Whisky Experience at Kanishka",
    ]) {
      expect(statesRestaurantDrinks(line, "Example"), line).toBe(false);
    }
    expect(drinksEvidence("INGREDIENTS: RICE, EGGS, SOY SAUCE(WATER, SALT, SPIRITS, WHEAT), SESAME OIL", "Example")).toEqual({});
    expect(drinksEvidence("Sauces: Hollandaise (1,4,7) Pepper (1,4,7,9) Red Wine (1,7,14)", "Example")).toEqual({});
    expect(statesRestaurantDrinks("Oysters paired with wine, champagne and more", "Example")).toBe(true);
    expect(statesRestaurantDrinks("Steamed dumplings served with a glass of wine", "Example")).toBe(true);
    expect(statesRestaurantDrinks("Steamed dumplings served with chilled white wine", "Example")).toBe(true);
    expect(statesRestaurantDrinks("Grilled steak paired with a crisp red wine", "Example")).toBe(true);
    expect(statesRestaurantDrinks("Enjoy £2 off all glasses of wine and cocktails", "Example")).toBe(true);
    expect(statesRestaurantDrinks("We serve virgin and classic cocktails", "Example")).toBe(true);
    expect(statesRestaurantDrinks("We serve soft and alcoholic drinks", "Example")).toBe(true);
    expect(statesRestaurantDrinks("Prawn cocktail, and a glass of champagne", "Example")).toBe(true);
    expect(statesRestaurantDrinks("Free bottle of champagne & cake on us", "Example")).toBe(true);
    expect(statesRestaurantDrinks("Coffee, wine and cake all afternoon", "Example")).toBe(true);
    expect(statesRestaurantDrinks("Fresh sushi with a selection of sake or Japanese beer", "Example")).toBe(true);
    expect(statesRestaurantDrinks("The wine experience at Trattoria Example", "Trattoria Example")).toBe(true);
  });

  it("settles a bring-your-own or no-alcohol restaurant as not pouring, whatever else the page says", () => {
    expect(drinksEvidence("Great curries and beers nearby.\nWe are BYOB - no corkage charge.", "Example")).toEqual({ refused: "We are BYOB - no corkage charge." });
    expect(drinksEvidence("Please note we do not serve alcohol on the premises.", "Example").refused).toBeTruthy();
    expect(drinksEvidence("No alcohol served to under 18s. Cocktails from 5pm.", "Example")).toEqual({ quote: "No alcohol served to under 18s. Cocktails from 5pm." });
    expect(drinksEvidence("Our Baker Street branch does not offer alcoholic beverages. Guests may bring their own wine or spirits.", "Example").refused).toBeTruthy();
    expect(drinksEvidence("Sorry, we don’t serve alcohol but lassi is on the house.", "Example").refused).toBeTruthy();
    expect(drinksEvidence("Cocktails, wine and craft beer every night.\nWe don’t serve alcohol to anyone under 18.", "Example")).toEqual({ quote: "Cocktails, wine and craft beer every night." });
    expect(drinksEvidence("Cocktails, wine and craft beer every night.\nWe do not sell alcoholic drinks without ID.", "Example")).toEqual({ quote: "Cocktails, wine and craft beer every night." });
  });

  it("never takes a line that sells, gives, delivers or teaches a drink, or names another venue", () => {
    for (const line of [
      "BRINKLEY'S WINE SHOP",
      "You can purchase our very own pastas, wines, coffees and so much more.",
      "As a gift or special treat, nothing goes better than our house wines.",
      "Champagne, cremant or wine delivery",
      "Wine hampers to order online for Christmas",
      "Pizza and Spritz Masterclass Belsize Park",
      "From cocktail making classes to wine tasting for your event",
      "Wine Consultancy Services",
      "Part of the Woodhead Restaurant Group alongside Quality Wines",
      "Cocktails at our sister restaurant across the road",
      "Champagne Bar, Selfridges Trafford]",
      "Situated just below my restaurant, Eve bar is centred on cocktails and Champagne",
      "Add bottomless Prosecco to brunch at Darwin Brasserie",
    ]) {
      expect(drinksEvidence(line, "Example"), line).toEqual({});
    }
    expect(drinksEvidence("Happy hour: buy 1 get 1 free on all cocktails", "Example")).toEqual({ quote: "Happy hour: buy 1 get 1 free on all cocktails" });
    expect(drinksEvidence("Cocktails and Champagne at Cote Brasserie every evening", "Cote Brasserie")).toEqual({ quote: "Cocktails and Champagne at Cote Brasserie every evening" });
    expect(drinksEvidence("Wine hampers delivered nationwide.\nCocktails and wine at the bar every night.", "Example")).toEqual({ quote: "Cocktails and wine at the bar every night." });
  });

  it("ignores copyright footers", () => {
    expect(drinksEvidence("© 2017 Terroirs Natural Wine Group", "Terroirs")).toEqual({});
  });

  it("never follows a shop page, however drinks-like its link", () => {
    const page = "[Drinks](/collections/drinks) [Wine](/products/house-red) [Bar](/shop/bar-kit) [Store](/pages/stores/soho) [Drinks menu](/drinks)";
    expect(drinkLinks(page, "https://www.example-trattoria.co.uk/")).toEqual(["https://www.example-trattoria.co.uk/drinks"]);
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

  it("binds a street address only as whole words, so 1 High Street is not 221 or 11 High Street", () => {
    const candidate = { name: "Trattoria Fenice", postcode: null, street: "High Street", housenumber: "1" };
    const site = "https://www.trattoriafenice.co.uk/";
    expect(searchBindsSite(candidate, { url: site, content: "Find us at 1 High Street, Barnet" })).toBe(site);
    expect(searchBindsSite(candidate, { url: site, content: "1 High Street" })).toBe(site);
    expect(searchBindsSite(candidate, { url: site, content: "Find us at 221 High Street, Acton" })).toBeNull();
    expect(searchBindsSite(candidate, { url: site, content: "Find us at 11 High Street, Acton" })).toBeNull();
    expect(searchBindsSite(candidate, { url: site, content: "Find us at 1 High Streetly Road" })).toBeNull();
  });

  it("keeps OSM restaurants that state nothing about alcohol, and leaves out those that state it either way", () => {
    const element = (tags: Record<string, string>) => ({ type: "node", id: 7, lat: 51.51, lon: -0.13, tags: { amenity: "restaurant", name: "Fenice", ...tags } });
    expect(restaurantCandidate(element({ "addr:postcode": "W1D 4TQ", website: "https://fenice.co.uk" }), { statesAlcohol, excluded: new Set<string>() })).toMatchObject({ osmId: "node/7", postcode: "W1D 4TQ", website: "https://fenice.co.uk/" });
    expect(restaurantCandidate(element({ bar: "yes" }), { statesAlcohol, excluded: new Set<string>() })).toBeNull();
    expect(restaurantCandidate(element({ alcohol: "no" }), { statesAlcohol, excluded: new Set<string>() })).toBeNull();
    expect(restaurantCandidate(element({ amenity: "cafe" }), { statesAlcohol, excluded: new Set<string>() })).toBeNull();
    expect(restaurantCandidate(element({ website: "https://fenice.co.uk" }), { statesAlcohol, excluded: new Set(["node/7"]) })).toBeNull();
  });

  it("refuses a published row without own-site evidence, robots permission, a read date or a London position", () => {
    const exclusions = { rows: [{ osmId: "node/202", name: "Elsewhere Grill", reason: "The quote is about another venue." }] };
    const check = (rows: unknown[]) => validateRestaurantDrinksPack({ rows }, { inGreaterLondon, exclusions });
    expect(check([row()])).toEqual([]);
    expect(check([row({ evidence: [{ ...row().evidence[0], url: "https://www.tripadvisor.co.uk/x" }] })])).not.toEqual([]);
    expect(check([row({ evidence: [{ ...row().evidence[0], robots: { outcome: "refused", checkedAt: observedAt } }] })])).not.toEqual([]);
    expect(check([row({ evidence: [{ ...row().evidence[0], observedAt: "yesterday" }] })])).not.toEqual([]);
    expect(check([row({ evidence: [{ ...row().evidence[0], excerpt: "Trattoria Example, Soho" }] })])).not.toEqual([]);
    expect(check([row({ evidence: [{ ...row().evidence[0], excerpt: "Native Lobster Cocktail" }] })])).not.toEqual([]);
    expect(check([row({ lat: 53.48, lng: -2.24 })])).not.toEqual([]);
    expect(check([row(), row()])).toEqual(["node/101: repeated"]);
    expect(check([row({ osmId: "node/202" })])).toEqual(["node/202: excluded in exclusions.json"]);
    expect(check([row({ evidence: [{ ...row().evidence[0], excerpt: "Visit our wine shop on the corner" }] })])).not.toEqual([]);
    expect(check([row({ evidence: [{ ...row().evidence[0], url: "https://www.trattoriaexample.co.uk/collections/drinks" }] })])).toEqual([
      "node/101: evidence https://www.trattoriaexample.co.uk/collections/drinks is a shop page",
    ]);
    expect(check([row({ evidence: [{ ...row().evidence[0], url: "https://www.trattoriaexample.co.uk/images/store/drinks-menu.pdf" }] })])).toEqual([]);
    expect(() => validateRestaurantDrinksPack({ rows: [row()] }, { inGreaterLondon, exclusions: { rows: [{ osmId: "node/202", name: "Elsewhere Grill" }] } })).toThrow(/reason/);
  });

  const overpassCache = path.join(process.cwd(), "data-harvest/london-restaurant-drinks/overpass.json");
  it.skipIf(existsSync(overpassCache))("refuses a replay without the cached Overpass answer, and fetches and writes nothing", () => {
    const evidencePath = path.join(process.cwd(), "data/london_restaurant_drinks/evidence.json");
    const before = readFileSync(evidencePath, "utf8");
    const run = spawnSync(process.execPath, ["scripts/harvest_london_restaurant_drinks.mjs", "--replay"], { cwd: process.cwd(), encoding: "utf8", timeout: 30_000 });
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("--replay reads data-harvest/london-restaurant-drinks/overpass.json and it is missing");
    expect(existsSync(overpassCache)).toBe(false);
    expect(readFileSync(evidencePath, "utf8")).toBe(before);
  });

  it("the committed pack passes its own check", () => {
    const pack = JSON.parse(readFileSync(path.join(process.cwd(), "data/london_restaurant_drinks/evidence.json"), "utf8"));
    const exclusions = JSON.parse(readFileSync(path.join(process.cwd(), "data/london_restaurant_drinks/exclusions.json"), "utf8"));
    expect(validateRestaurantDrinksPack(pack, { inGreaterLondon, exclusions })).toEqual([]);
    expect(excludedOsmIds(exclusions).size).toBe(12);
    expect(pack.rows.some((row: { osmId: string }) => excludedOsmIds(exclusions).has(row.osmId))).toBe(false);
    expect(pack.rows.length).toBeGreaterThan(0);
  });
  it("does not take a class held at the restaurant as the restaurant pouring", () => {
    expect(drinksEvidence("Master the roll and sip on MOTH: cocktails at our exclusive adults only sushi schools.", "YO! Sushi")).toEqual({});
    expect(drinksEvidence("Join a pasta class, then cocktails at the bar.", "Example")).toEqual({});
  });

  it("pairs Extract answers with their requests when Tavily canonicalises or redirects the URL", () => {
    const answers = pairExtractResults(
      ["http://example-trattoria.co.uk/", "https://www.fenice.co.uk/menu", "https://bistro-uno.co.uk/drinks/"],
      {
        results: [
          { url: "https://www.example-trattoria.co.uk", raw_content: "Wine list" },
          { url: "https://www.fenice.co.uk/en/menu", raw_content: "Cocktails" },
          { url: "https://bistro-uno.co.uk/drinks", raw_content: "Beers" },
        ],
      },
    );
    expect(answers.get("http://example-trattoria.co.uk/")).toEqual({ landedUrl: "https://www.example-trattoria.co.uk", text: "Wine list" });
    expect(answers.get("https://www.fenice.co.uk/menu")).toEqual({ landedUrl: "https://www.fenice.co.uk/en/menu", text: "Cocktails" });
    expect(answers.get("https://bistro-uno.co.uk/drinks/")).toEqual({ landedUrl: "https://bistro-uno.co.uk/drinks", text: "Beers" });
  });

  it("settles only a gone page, and leaves any other Extract failure to be asked again", () => {
    const answers = pairExtractResults(["https://a-venue.co.uk/", "https://b-venue.co.uk/", "https://c-venue.co.uk/"], {
      failed_results: [
        { url: "https://a-venue.co.uk/", error: "Failed to fetch url" },
        { url: "https://b-venue.co.uk/", error: "HTTP 404 Not Found" },
      ],
    });
    expect(answers.get("https://a-venue.co.uk/")).toEqual({ retry: "Failed to fetch url" });
    expect(answers.get("https://b-venue.co.uk/")).toEqual({ unreadable: "HTTP 404 Not Found" });
    expect(answers.get("https://c-venue.co.uk/")).toEqual({ retry: "Extract returned nothing" });
    expect(retryableUnreadable({ unreadable: "Failed to fetch url" })).toBe(true);
    expect(retryableUnreadable({ unreadable: "HTTP 410 Gone" })).toBe(false);
    expect(retryableUnreadable({})).toBe(false);
  });
});
