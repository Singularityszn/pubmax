// ONE BUNDLE, EVERY PRICE WE HOLD, AND EACH ROW SAYS WHAT IT IS WORTH.
//
// Prices reach this tree down several lanes: a drinker's Pint Drop, a chain's
// own published menu, a first-party harvest of a pub's own site, and a figure
// modelled here that nobody published at all. Each lane already has an owner,
// and each owner already decides its own thing. What did not exist was ONE
// place a reader could ask "what do we hold about this pub, and how good is
// it", so a coverage question could only be answered by counting four files by
// hand.
//
// THE BUNDLE INVENTS NOTHING. Every row is a row one of those lanes already
// produced, carried through with its own source URL and its own observation
// day, and stamped with the standing lib/priceTier.ts decided for it. The
// builder is scripts/build_uk_price_bundle.mjs; this module is the shape, the
// parser and the ONE rule about who may read what.
//
// THAT RULE, and it is the reason this module exists rather than a bare JSON
// read: A BUNDLE ROW IS NOT AUTOMATICALLY A PRICE A SURFACE MAY PAINT. The
// bundle deliberately carries estimates, because a coverage answer that omits
// them is not a coverage answer. An estimate may never reach pin colour, the
// cheapest-pint buckets, the price bands or the Pint Index - the fence
// __tests__/priceEstimateAuthorityFence.test.ts holds that line for the estimate
// engine, and `authoritativeBundleRows` holds it here. A caller that wants a
// figure it may treat as a fact asks for that; a caller that wants to say what
// we hold asks for the whole set and prints the standing beside every row.
//
// This module imports the standing vocabulary and nothing else, so a surface
// that needs to read the bundle does not pull the venue index in behind it.

import {
  UK_PRICE_BUNDLE_DRINK_LABEL_MAX,
  bundleRowDedupeDrinkKey,
  isValidBundleDrinkSubtypeForRow,
} from "@/lib/bundleDrinkFields";
import {
  type EstimatedPriceInput,
  type ListedPriceInput,
  type PriceStanding,
  type PriceStandingDecision,
  priceStandingFor,
  standingCarriesAuthority,
} from "@/lib/priceTier";

export const UK_PRICE_BUNDLE_VERSION = 1;

/**
 * Which lane a row came down. This is PROVENANCE, not authority: the standing
 * says how good the row is, and the lane says who produced it, so a coverage
 * report can name the lane that is thin without re-deciding what its rows are
 * worth.
 */
export const UK_PRICE_BUNDLE_LANES = [
  // A pub's or a chain's own website, read by scripts/harvest/uk-prices.
  "site-harvest",
  // The reviewed drink-price publish, public/data/drink_price_updates.
  "drink-price-update",
  // Modelled here from lib/priceEstimate.ts. Never published by anybody.
  "estimate",
] as const;
export type UkPriceBundleLane = (typeof UK_PRICE_BUNDLE_LANES)[number];

export type UkPriceBundleRow = {
  /** The venue this price is about: a curated venue id or a `venue-uk-` id. */
  venueId: string;
  /** The pub's own name as its lane stated it, for a report a human reads. */
  name: string | null;
  /** A `lib/drinks.ts` category. Kept a string here so this module stays a leaf. */
  category: string;
  priceGbp: number;
  lane: UkPriceBundleLane;
  standing: PriceStanding;
  /** The page that published the figure. Present on every `listed` row. */
  sourceUrl: string | null;
  /** The publisher's own name, where the lane recorded one. */
  publisher: string | null;
  /** The day the figure was observed, or the day an estimate was modelled. */
  observedAt: string;
  /** Present only on an estimate, and what makes it answerable. */
  basis: string | null;
  sampleSize: number | null;
  /** How many operators an estimate's basis rests on. Owed by every non-beer estimate. */
  operatorCount?: number;
  /**
   * The drink name as printed on the source page or menu line (trimmed, max
   * 80 chars). Absent when the producing lane stated category only.
   */
  drinkLabel?: string;
  /** Source-stated serving, such as 125ml or Btl; absence means unknown volume. */
  servingSize?: string;
  /** Closed subtype from lib/drinkSubtypes.ts when the label classifies; never guessed. */
  drinkSubtype?: string;
  /**
   * Where a `venue-uk-` pub with a subtype row stands, from the ledger row's own
   * point, and the London borough that point is in. All three or none, and only
   * inside London: a base pub has no curated record to place it, so this is
   * what lets a London subtype view rank it.
   */
  lat?: number;
  lng?: number;
  londonBorough?: string;
};

/**
 * Source-ledger observations with a printed item that contradicts its assigned
 * category, or a beer line whose printed measure is a half or a bottle and not a
 * pint. Keep the observations in site_harvest.jsonl for audit, but do not
 * let these exact claims become listed facts. Match the source and printed item
 * as well as category and price, so other drinks on these menus still publish.
 */
const CATEGORY_QUARANTINE: ReadonlyArray<
  Pick<UkPriceBundleRow, "sourceUrl" | "category" | "priceGbp" | "drinkLabel">
> = [
  { sourceUrl: "https://www.theploughstjohnshill.co.uk/the-bar/", category: "gin", priceGbp: 9, drinkLabel: "0% Tropical Negroni Three Spirit Livener, Lyres Italian Spritz, Tanqueray 0.0%" },
  { sourceUrl: "https://www.theploughstjohnshill.co.uk/the-bar/", category: "shot", priceGbp: 12, drinkLabel: "1.50 Picante Spritz Altos Plata tequila, Beesou honey, green chilli, lime, soda" },
  { sourceUrl: "https://www.theploughstjohnshill.co.uk/the-bar/", category: "whisky", priceGbp: 10, drinkLabel: "ary Absolut Tabasco Vodka, Tomato Juice, Worcestershire Sauce, Spices, Rosemary" },
  { sourceUrl: "https://www.theploughstjohnshill.co.uk/the-bar/", category: "wine", priceGbp: 5.35, drinkLabel: "Pineapple & Yuzu Pineapple, coconut, apple, yuzu, soda 86kcal" },
  { sourceUrl: "https://www.theguardhousewoolwich.co.uk/food-and-drink/", category: "cocktail", priceGbp: 8, drinkLabel: "Berry Hugo 0.0% Three Spirit Livener 0.0%, Watermelon, Elderflower, Soda 93kcal" },
  { sourceUrl: "https://georgeanddragonacton.co.uk/drinks-menu", category: "wine", priceGbp: 3, drinkLabel: "Frobishers Juice (250ml)" },
  { sourceUrl: "https://www.spreadeaglewandsworth.co.uk/food-drinks/", category: "wine", priceGbp: 5.4, drinkLabel: "Raspberry Elderflower, apple juice, Fever-Tree raspberry & orange blossom soda" },
  { sourceUrl: "https://www.kingsarmsoxford.co.uk/food-drink/", category: "wine", priceGbp: 4.85, drinkLabel: ".85 Elderflower & Raspberry Orange Blossom, Raspberry, Elderflower, Soda 88kcal" },
  { sourceUrl: "https://www.owlandpussycatshoreditch.com/food-drink/", category: "wine", priceGbp: 5.5, drinkLabel: "Elderflower & Raspberry Cooler Orange Blossom, Raspberry, Elderflower, and Soda" },
  { sourceUrl: "https://www.windmillclapham.co.uk/food-drink/", category: "wine", priceGbp: 5.4, drinkLabel: ".40 Elderflower & Raspberry Orange Blossom, Raspberry, Elderflower, Soda 88kcal" },
  { sourceUrl: "https://www.tellersarmsfarnham.co.uk/food-drinks/", category: "wine", priceGbp: 5.15, drinkLabel: ".15 Elderflower & Raspberry Orange Blossom, Raspberry, Elderflower, Soda 88kcal" },
  { sourceUrl: "https://www.groveexmouth.co.uk/food-drink/", category: "wine", priceGbp: 4.85, drinkLabel: ".85 Elderflower & Raspberry Orange Blossom, Raspberry, Elderflower, Soda 88kcal" },
  { sourceUrl: "https://www.whitehart-ford.com/food-drink/", category: "wine", priceGbp: 4.6, drinkLabel: "60 Elderflower & Raspberry Orange Blossom, Raspberry, Elderflower, Soda 88 kcal" },
  { sourceUrl: "https://www.almawandsworth.com/food-drink/", category: "wine", priceGbp: 5.4, drinkLabel: "Elderflower & Raspberry Orange blossom, elderflower, raspberry, soda / 88 Kcal" },
  { sourceUrl: "https://www.thebullditchling.com/food-drink/", category: "wine", priceGbp: 5.15, drinkLabel: ".15 Elderflower & Raspberry Orange Blossom, Raspberry, Elderflower, Soda 88kcal" },
  { sourceUrl: "https://www.thedukeofwellingtonpub.com/food-and-drinks?menu=spritz", category: "wine", priceGbp: 4, drinkLabel: "om, Raspberry, Elderflower, Soda 88kcal Light & Sparkling (AF) Raspberry & Rose" },
  { sourceUrl: "https://www.cockandbottlew11.com/food-drink?menu=spritz-menu", category: "wine", priceGbp: 4.45, drinkLabel: "om, Raspberry, Elderflower, Soda 88kcal Light & Sparkling (AF) Raspberry & Rose" },
  { sourceUrl: "https://www.orangetreerichmond.co.uk/food-drink/", category: "wine", priceGbp: 5.35, drinkLabel: ".35 Elderflower & Raspberry Orange Blossom, Raspberry, Elderflower, Soda 88kcal" },
  { sourceUrl: "https://www.theprideofpaddington.co.uk/food-drink/", category: "wine", priceGbp: 3.95, drinkLabel: "50 Elderflower & Raspberry Cooler Orange Blossom, Raspbberry, Elderflower, Soda" },
  // Exa-found London sites, 2026-10-18. A spirit, a water and an energy drink
  // filed under a beer heading, and the half column of a "½ Pint Pint" pair the
  // bare-pair rule cannot see because the pair is not near two to one.
  { sourceUrl: "https://blackcapcamden.co.uk", category: "beer", priceGbp: 11, drinkLabel: "Brandy Remy Martin 1738" },
  { sourceUrl: "https://blackcapcamden.co.uk", category: "beer", priceGbp: 2.8, drinkLabel: "Draft Soft Drinks (spirit mixer) FOC Harrogate Water Sparkling" },
  // The menu prints an em dash in this label. The key is built from the code
  // point so the source's own character matches without a dash in our copy.
  { sourceUrl: "https://blackcapcamden.co.uk", category: "beer", priceGbp: 3.5, drinkLabel: `Red Bull ${String.fromCodePoint(0x2014)} All Flavours` },
  { sourceUrl: "https://theblacksmithsse16.com/drink", category: "beer", priceGbp: 4.5, drinkLabel: "Pint Pint London Pride 4.1%" },
  // The Blue Monk lists cans, 0% beers and Cantillon lambics side by side, and
  // the keyless reader filed them under the wrong heading. An unlabelled row is
  // matched by its figure: the page states that figure only for the drink named.
  { sourceUrl: "https://www.thebluemonklondon.com/bar", category: "alcohol-free", priceGbp: 5.25, drinkLabel: "Freddie's Hard Iced Tea Lemon" },
  { sourceUrl: "https://www.thebluemonklondon.com/bar", category: "alcohol-free", priceGbp: 5.5, drinkLabel: "Pabst Blue Ribbon" },
  { sourceUrl: "https://www.thebluemonklondon.com/bar", category: "alcohol-free", priceGbp: 5.5, drinkLabel: "Warsteiner Pilsener" },
  { sourceUrl: "https://www.thebluemonklondon.com/bar", category: "beer", priceGbp: 3.75 },
  { sourceUrl: "https://www.thebluemonklondon.com/bar", category: "beer", priceGbp: 4.5, drinkLabel: "Athletic Run Wild IPA" },
  { sourceUrl: "https://www.thebluemonklondon.com/bar", category: "cocktail", priceGbp: 6.5 },
  { sourceUrl: "https://www.thebluemonklondon.com/bar", category: "cocktail", priceGbp: 7.2, drinkLabel: "Newbarns Blackcurrant & Lemon Sour 1/2pint 4%" },
  { sourceUrl: "https://www.thebluemonklondon.com/bar", category: "wine", priceGbp: 16.4, drinkLabel: "Cantillon Gueuze" },
  { sourceUrl: "https://www.thebluemonklondon.com/bar", category: "wine", priceGbp: 12.15, drinkLabel: "Cantillon Rose de Gambrinus 37.5cl" },
  { sourceUrl: "https://www.thebluemonklondon.com/bar", category: "wine", priceGbp: 12.15 },
  // An 11% Aperol filed as alcohol-free. A 0.05% or 0.5% beer stays beer: only
  // an exact zero strength or alcohol-free wording files as alcohol-free.
  { sourceUrl: "https://blackcapcamden.co.uk", category: "alcohol-free", priceGbp: 6.5, drinkLabel: "Aperol 11%" },
  // A liqueur filed as coffee, a witbier as a soft drink, desserts as wine, and
  // a calorie line that is the elderflower spritz already quarantined above.
  { sourceUrl: "https://blackcapcamden.co.uk", category: "coffee", priceGbp: 5, drinkLabel: "Kahlúa Coffee Liqueur 16%" },
  { sourceUrl: "https://blackcapcamden.co.uk", category: "coffee", priceGbp: 6.5, drinkLabel: "Malibu 18%" },
  { sourceUrl: "https://blackcapcamden.co.uk", category: "soft-drink", priceGbp: 7, drinkLabel: "Queer Flowers Belgian Witbier 4%" },
  { sourceUrl: "https://watermanstw9.co.uk/menu", category: "wine", priceGbp: 7, drinkLabel: "Ice Cream Vanilla, Chocolate or Pistachio (v/gf)" },
  { sourceUrl: "https://watermanstw9.co.uk/menu", category: "wine", priceGbp: 7, drinkLabel: "Sorbet Lemon or Raspberry (v/gf)" },
  { sourceUrl: "https://www.thepaternoster.com/food-drink/", category: "wine", priceGbp: 5.45, drinkLabel: "88kcal" },
  // Shard 3. The Imperial Arms PDF reads its columns out of order, so liqueurs
  // land as coffee, gins as vodka and 0.5% beers as beer, and one £7.40 figure
  // lands under five spirits. The Greyhound page mixes its food menu in.
  { sourceUrl: "https://imperialarmschislehurst.co.uk/wp-content/uploads/2026/03/TP251592-Imperial-Drinks-Menu-Final.pdf", category: "beer", priceGbp: 4, drinkLabel: `Baby guinness` },
  { sourceUrl: "https://imperialarmschislehurst.co.uk/wp-content/uploads/2026/03/TP251592-Imperial-Drinks-Menu-Final.pdf", category: "beer", priceGbp: 4.95, drinkLabel: `Impossibrew Lager 0.5% abv` },
  { sourceUrl: "https://imperialarmschislehurst.co.uk/wp-content/uploads/2026/03/TP251592-Imperial-Drinks-Menu-Final.pdf", category: "beer", priceGbp: 4.95, drinkLabel: `NuWave Pale Ale 0.5% abv` },
  { sourceUrl: "https://imperialarmschislehurst.co.uk/wp-content/uploads/2026/03/TP251592-Imperial-Drinks-Menu-Final.pdf", category: "cocktail", priceGbp: 5, drinkLabel: `Campari` },
  { sourceUrl: "https://imperialarmschislehurst.co.uk/wp-content/uploads/2026/03/TP251592-Imperial-Drinks-Menu-Final.pdf", category: "cocktail", priceGbp: 5, drinkLabel: `Dry Martini` },
  { sourceUrl: "https://imperialarmschislehurst.co.uk/wp-content/uploads/2026/03/TP251592-Imperial-Drinks-Menu-Final.pdf", category: "coffee", priceGbp: 3.9, drinkLabel: `Tia maria` },
  { sourceUrl: "https://imperialarmschislehurst.co.uk/wp-content/uploads/2026/03/TP251592-Imperial-Drinks-Menu-Final.pdf", category: "coffee", priceGbp: 4, drinkLabel: `Pernod` },
  { sourceUrl: "https://imperialarmschislehurst.co.uk/wp-content/uploads/2026/03/TP251592-Imperial-Drinks-Menu-Final.pdf", category: "coffee", priceGbp: 4.1, drinkLabel: `Amaretto` },
  { sourceUrl: "https://imperialarmschislehurst.co.uk/wp-content/uploads/2026/03/TP251592-Imperial-Drinks-Menu-Final.pdf", category: "coffee", priceGbp: 4.9, drinkLabel: `Cazcabel Coffee` },
  { sourceUrl: "https://imperialarmschislehurst.co.uk/wp-content/uploads/2026/03/TP251592-Imperial-Drinks-Menu-Final.pdf", category: "vodka", priceGbp: 3.9, drinkLabel: `Beefeater Pink` },
  { sourceUrl: "https://imperialarmschislehurst.co.uk/wp-content/uploads/2026/03/TP251592-Imperial-Drinks-Menu-Final.pdf", category: "vodka", priceGbp: 5.2, drinkLabel: `Malfi` },
  { sourceUrl: "https://imperialarmschislehurst.co.uk/wp-content/uploads/2026/03/TP251592-Imperial-Drinks-Menu-Final.pdf", category: "vodka", priceGbp: 6.2, drinkLabel: `Monkey 47` },
  { sourceUrl: "https://imperialarmschislehurst.co.uk/wp-content/uploads/2026/03/TP251592-Imperial-Drinks-Menu-Final.pdf", category: "shot", priceGbp: 4.9, drinkLabel: `ams Vintage Port ${String.fromCodePoint(0x2013)} Quantities? Harveys Sherry TEQUILA 25ml 50ml Cazcabel Blanco` },
  { sourceUrl: "https://imperialarmschislehurst.co.uk/wp-content/uploads/2026/03/TP251592-Imperial-Drinks-Menu-Final.pdf", category: "wine", priceGbp: 4, drinkLabel: `Tequila rose` },
  { sourceUrl: "https://imperialarmschislehurst.co.uk/wp-content/uploads/2026/03/TP251592-Imperial-Drinks-Menu-Final.pdf", category: "gin", priceGbp: 7.4 },
  { sourceUrl: "https://imperialarmschislehurst.co.uk/wp-content/uploads/2026/03/TP251592-Imperial-Drinks-Menu-Final.pdf", category: "rum", priceGbp: 7.4 },
  { sourceUrl: "https://imperialarmschislehurst.co.uk/wp-content/uploads/2026/03/TP251592-Imperial-Drinks-Menu-Final.pdf", category: "shot", priceGbp: 7.4 },
  { sourceUrl: "https://imperialarmschislehurst.co.uk/wp-content/uploads/2026/03/TP251592-Imperial-Drinks-Menu-Final.pdf", category: "vodka", priceGbp: 7.4 },
  { sourceUrl: "https://imperialarmschislehurst.co.uk/wp-content/uploads/2026/03/TP251592-Imperial-Drinks-Menu-Final.pdf", category: "whisky", priceGbp: 7.4 },
  { sourceUrl: "https://www.thegreyhoundhotel.com/food-drink/", category: "alcohol-free", priceGbp: 8 },
  { sourceUrl: "https://www.thegreyhoundhotel.com/food-drink/", category: "cocktail", priceGbp: 20, drinkLabel: `.50 Baked Camembert Youngs Sourdough, Caramelised Onion Chutney, Grapes 974Kcal` },
  { sourceUrl: "https://www.thegreyhoundhotel.com/food-drink/", category: "coffee", priceGbp: 6, drinkLabel: `Puddings Affogato Roasted arabica coffee (v) 111kcal` },
  { sourceUrl: "https://www.thegreyhoundhotel.com/food-drink/", category: "soft-drink", priceGbp: 4.5, drinkLabel: `While You Wait Mixed Pitted Olives 118Kcal` },
  { sourceUrl: "https://www.thegreyhoundhotel.com/food-drink/", category: "wine", priceGbp: 4.3, drinkLabel: `Corona Cero` },
  { sourceUrl: "https://www.thegreyhoundhotel.com/food-drink/", category: "wine", priceGbp: 5, drinkLabel: `424kcal` },
  { sourceUrl: "https://www.thegreyhoundhotel.com/food-drink/", category: "wine", priceGbp: 8, drinkLabel: `823kcal` },
  { sourceUrl: "https://www.thegreyhoundhotel.com/food-drink/", category: "wine", priceGbp: 9.65, drinkLabel: `Vanilia Vodka, Lime Juice, Pineapple Juice, Passionfruit Puree Shot of prosecco` },
  { sourceUrl: "https://www.thegreyhoundhotel.com/food-drink/", category: "wine", priceGbp: 12.5, drinkLabel: `nate Gin Fizz Plymouth Gin, Elderflower, Pomegranate, Cranberry, Prosecco, Soda` },
  { sourceUrl: "https://www.crownofmitcham.co.uk/menu?menu=menu", category: "alcohol-free", priceGbp: 4.1, drinkLabel: `Heniken` },
  { sourceUrl: "https://www.parkhotelteddington.com/food-drink/", category: "cocktail", priceGbp: 8.7, drinkLabel: `22kcal` },
  { sourceUrl: "https://www.parkhotelteddington.com/food-drink/", category: "coffee", priceGbp: 7, drinkLabel: `Apple & summerberry crumble vanilla ice cream /330Kcal / vg` },
  { sourceUrl: "https://www.parkhotelteddington.com/food-drink/", category: "coffee", priceGbp: 7, drinkLabel: `Dark chocolate mocha mousse, shortbread / 354Kcal / vg` },
  { sourceUrl: "https://www.parkhotelteddington.com/food-drink/", category: "shot", priceGbp: 12, drinkLabel: `Marg Altos Plata Tequila, Burnt Faith Triple Sec, Fever-Tree Mexican Lime Soda` },
  { sourceUrl: "https://www.parkhotelteddington.com/food-drink/", category: "wine", priceGbp: 6.9, drinkLabel: `28kcal` },
  { sourceUrl: "https://www.parkhotelteddington.com/food-drink/", category: "wine", priceGbp: 12.5, drinkLabel: `nate Gin Fizz Plymouth gin, elderflower, pomegranate, cranberry, prosecco, soda` },
  { sourceUrl: "https://www.thedysartpetersham.co.uk/wine-drink/", category: "alcohol-free", priceGbp: 3.5, drinkLabel: `Fever Tree mixers` },
  { sourceUrl: "https://www.thedysartpetersham.co.uk/wine-drink/", category: "cocktail", priceGbp: 12, drinkLabel: `Bodegas Barbadillo, Sanlucar de Barrameda Jerez, Spain 2024 15%abv 100ml glass` },
  { sourceUrl: "https://www.thedysartpetersham.co.uk/wine-drink/", category: "gin", priceGbp: 14.5, drinkLabel: `50 Organic Matcha green tea, Salcolmbe Gin, Fever Tree tonic Classic Caiparinha` },
  { sourceUrl: "https://www.thedysartpetersham.co.uk/wine-drink/", category: "gin", priceGbp: 15.5, drinkLabel: `y Gin, elderflower, lemon juice, Fever Tree soda Matcha Green Tea Gin and Tonic` },
  { sourceUrl: "https://www.thedysartpetersham.co.uk/wine-drink/", category: "whisky", priceGbp: 15, drinkLabel: `.50 Holladay Soft Red Wheat whiskey, brown sugar, Angostura bitters Tom Collins` },
  { sourceUrl: "https://www.thedysartpetersham.co.uk/wine-drink/", category: "whisky", priceGbp: 5.5, drinkLabel: `Brazil, Yellow Bourbon Single` },
  { sourceUrl: "https://www.thedysartpetersham.co.uk/wine-drink/", category: "whisky", priceGbp: 7.5, drinkLabel: `Double` },
  { sourceUrl: "https://www.thedysartpetersham.co.uk/wine-drink/", category: "whisky", priceGbp: 15, drinkLabel: `Sapling Vodka, Triple Sec, cranberry and fresh citrus Whisky, Botivo and Ginger` },
  { sourceUrl: "https://www.thedysartpetersham.co.uk/wine-drink/", category: "whisky", priceGbp: 14.5, drinkLabel: `Walker Red Label whisky, lemon, egg white, Angostura bitters Dysart Chancellor` },
  { sourceUrl: "https://www.thedysartpetersham.co.uk/wine-drink/", category: "wine", priceGbp: 5, drinkLabel: `bv £130.00 2018 Frühburgunder (Pinot Noir Précoce), Bischel, Rheinhessen 13%abv` },
  { sourceUrl: "https://www.thedysartpetersham.co.uk/wine-drink/", category: "wine", priceGbp: 12, drinkLabel: `in 25ml measures unless stated Cognac Maxim Trijol VSOP, Grand Champagne 40%abv` },
  { sourceUrl: "https://www.thedysartpetersham.co.uk/wine-drink/", category: "wine", priceGbp: 6, drinkLabel: `Lemon verbena` },
  { sourceUrl: "https://www.thedysartpetersham.co.uk/wine-drink/", category: "wine", priceGbp: 6, drinkLabel: `Roasted buckwheat` },
  { sourceUrl: "https://www.thedysartpetersham.co.uk/wine-drink/", category: "wine", priceGbp: 7, drinkLabel: `Rose bud tea, Cyprus` },
  { sourceUrl: "https://www.lambsurbiton.co.uk/bar-hire-london", category: "beer", priceGbp: 2 },
  { sourceUrl: "https://www.lambsurbiton.co.uk/bar-hire-london", category: "beer", priceGbp: 5, drinkLabel: "ge Cooling Jackets Remote Cooler 1-6 Barrels Taps Drip Buckets Product Boards \u200b" },
  { sourceUrl: "https://www.thejollycoopers.co.uk/menus/", category: "gin", priceGbp: 6.5, drinkLabel: "Martell" },
  { sourceUrl: "https://foxandduck.co.uk/our-menus/", category: "wine", priceGbp: 7.5, drinkLabel: "125ml \u2026" },
  { sourceUrl: "https://foxandduck.co.uk/our-menus/", category: "wine", priceGbp: 6.5, drinkLabel: "175ml \u2026" },
  { sourceUrl: "https://foxandduck.co.uk/our-menus/", category: "wine", priceGbp: 8.5, drinkLabel: "250ml \u2026" },
  { sourceUrl: "https://foxandduck.co.uk/our-menus/", category: "wine", priceGbp: 9, drinkLabel: "Bottle \u2026" },
  { sourceUrl: "https://www.alexanderpope.co.uk/food-and-drink/", category: "coffee", priceGbp: 6.5, drinkLabel: "Creamed Spinach & Cornish Brie Gratin v / 478 Kcal" },
  { sourceUrl: "https://www.alexanderpope.co.uk/food-and-drink/", category: "coffee", priceGbp: 5, drinkLabel: "PUDDINGS Affogato Double espresso, vanilla ice cream / vg / 80 Kcal" },
  { sourceUrl: "https://www.alexanderpope.co.uk/food-and-drink/", category: "vodka", priceGbp: 11, drinkLabel: "ait Absolut Tabasco Bloody Mary Absolut Tabasco, Pickle House Spiced Tomato Mix" },
  { sourceUrl: "https://www.alexanderpope.co.uk/food-and-drink/", category: "vodka", priceGbp: 3, drinkLabel: "Chocolate, Vanilla, Salted Caramel ice cream or Mango Sorbet 130 Kcal / 74 Kcal" },
  { sourceUrl: "https://www.alexanderpope.co.uk/food-and-drink/", category: "vodka", priceGbp: 6, drinkLabel: "sorbet / 104 Kcal Chocolate, vanilla, salted caramel ice cream / vg / 157 Kcal" },
  { sourceUrl: "https://www.alexanderpope.co.uk/food-and-drink/", category: "wine", priceGbp: 11.5, drinkLabel: "Pomegranate Gin Fizz Gin, Cranberry, Prosecco, Lime, Elderflower & Pomegranate" },
  { sourceUrl: "https://www.alexanderpope.co.uk/food-and-drink/", category: "wine", priceGbp: 12, drinkLabel: "ut Vanilla, Passoa, Lime, Pineapple, Sugar syrup, Passionfruit Puree & Prosecco" },
  { sourceUrl: "https://www.silverfoxmicropub.com/drinks", category: "alcohol-free", priceGbp: 8.5, drinkLabel: "SOUTHERN COMFORT 35% 50ml" },
  { sourceUrl: "https://www.silverfoxmicropub.com/drinks", category: "rum", priceGbp: 4.5, drinkLabel: "BAILEYS 17% 50ml" },
  { sourceUrl: "https://www.silverfoxmicropub.com/drinks", category: "rum", priceGbp: 8.5, drinkLabel: "HONEY JACK DANIELS 40% 50ml" },
  { sourceUrl: "https://www.silverfoxmicropub.com/drinks", category: "soft-drink", priceGbp: 7, drinkLabel: "SILVER TART 18% Disaronno, chambord and cranberry juice" },
  { sourceUrl: "https://www.silverfoxmicropub.com/drinks", category: "whisky", priceGbp: 8.5, drinkLabel: "One For The Road MARTELL BLUE SWIFT COGNAC 40% 50ml" },
  { sourceUrl: "https://www.silverfoxmicropub.com/drinks", category: "wine", priceGbp: 10, drinkLabel: "GRAND MIMOSA 11% Grand marnier, orange juice and prosecco" },
  { sourceUrl: "https://www.silverfoxmicropub.com/drinks", category: "wine", priceGbp: 3, drinkLabel: "Half" },
  { sourceUrl: "https://www.silverfoxmicropub.com/drinks", category: "wine", priceGbp: 8.5, drinkLabel: "KIR ROYALE 12% Chambord and prosecco" },
  { sourceUrl: "https://www.silverfoxmicropub.com/drinks", category: "wine", priceGbp: 4.5, drinkLabel: "SILQ ROSE 15%" },
  { sourceUrl: "https://www.silverfoxmicropub.com/drinks", category: "wine", priceGbp: 4, drinkLabel: "SILVER FOX 23%" },
  { sourceUrl: "https://www.silverfoxmicropub.com/drinks", category: "wine", priceGbp: 7, drinkLabel: "STRAWBERRY BELLINI 11% Strawberry syrup and prosecco" },
  { sourceUrl: "https://www.silverfoxmicropub.com/drinks", category: "wine", priceGbp: 4.5, drinkLabel: "TEQUILA ROSE 15%" },
  { sourceUrl: "https://loreoftheland.com/menu/drinks-menu/", category: "beer", priceGbp: 3.25, drinkLabel: "1/2 Pint" },
  { sourceUrl: "https://loreoftheland.com/menu/drinks-menu/", category: "beer", priceGbp: 3.7, drinkLabel: "A Refreshingly Crisp Pilsner, Full of Flavour 1/2 Pint" },
  { sourceUrl: "https://loreoftheland.com/menu/drinks-menu/", category: "beer", priceGbp: 3.75, drinkLabel: "A wonderful Thirst Quencher 1/2 Pint" },
  { sourceUrl: "https://loreoftheland.com/menu/drinks-menu/", category: "beer", priceGbp: 3.25, drinkLabel: "Anspach & Hobday Cask Session IPA 3.7% 1/2 Pint" },
  { sourceUrl: "https://loreoftheland.com/menu/drinks-menu/", category: "beer", priceGbp: 3.9, drinkLabel: "Anspach & Hobday Nitro London Porter 4.4% 1/2 Pint" },
  { sourceUrl: "https://loreoftheland.com/menu/drinks-menu/", category: "beer", priceGbp: 4.2, drinkLabel: "Citrus Notes, Elegantly Balanced By a Punchy, Refreshing Hoppy Finish 1/2 Pint" },
  { sourceUrl: "https://loreoftheland.com/menu/drinks-menu/", category: "beer", priceGbp: 4.05, drinkLabel: "Classic German Style Lager, Clean and Crisp 1/2 Pint" },
  { sourceUrl: "https://loreoftheland.com/menu/drinks-menu/", category: "beer", priceGbp: 3.7, drinkLabel: "Draught Beer & Cider Lore of The Land Lager Pilsner 4.2% 1/2 Pint" },
  { sourceUrl: "https://loreoftheland.com/menu/drinks-menu/", category: "beer", priceGbp: 3.75, drinkLabel: "ium Dry, Easy Sipping Cider With Crisp Tannic Notes And A Light Finish 1/2 Pint" },
  { sourceUrl: "https://loreoftheland.com/menu/drinks-menu/", category: "beer", priceGbp: 4.05, drinkLabel: "Paulaner Lager Helles 4.9% 1/2 Pint" },
  { sourceUrl: "https://loreoftheland.com/menu/drinks-menu/", category: "beer", priceGbp: 3.75, drinkLabel: "Pulpt Flare Cider 4.6% 1/2 Pint" },
  { sourceUrl: "https://loreoftheland.com/menu/drinks-menu/", category: "beer", priceGbp: 4.2, drinkLabel: "Sierra Nevada IPA 4.2% 1/2 Pint" },
  { sourceUrl: "https://loreoftheland.com/menu/drinks-menu/", category: "beer", priceGbp: 9.5, drinkLabel: "Jukes No.6 Sparkling Red" },
  { sourceUrl: "https://loreoftheland.com/menu/drinks-menu/", category: "coffee", priceGbp: 3.9, drinkLabel: "hfeel Balanced Perfectly Wth Subtle Roasted Coffee and Chocolate Notes 1/2 Pint" },
  { sourceUrl: "https://loreoftheland.com/menu/drinks-menu/", category: "soft-drink", priceGbp: 3.75, drinkLabel: "Stiegl Grapefruit Radler 2% 1/2 Pint" },
  { sourceUrl: "https://loreoftheland.com/menu/drinks-menu/", category: "gin", priceGbp: 16.5, drinkLabel: "Fever & Fauna" },
  { sourceUrl: "https://loreoftheland.com/menu/drinks-menu/", category: "gin", priceGbp: 16, drinkLabel: "Fitzrovia Gardens (Signature) 50ml" },
  { sourceUrl: "https://loreoftheland.com/menu/drinks-menu/", category: "whisky", priceGbp: 16, drinkLabel: "Jim Beam Bourbon, Ardbeg 10yo, Amaretto, Maraschino Cherry" },
  { sourceUrl: "https://loreoftheland.com/menu/drinks-menu/", category: "whisky", priceGbp: 20, drinkLabel: "Rosemaund 10 Year Single Malt, Angostura Bitters, Orange Bitters, Sugar" },
  { sourceUrl: "https://loreoftheland.com/menu/drinks-menu/", category: "whisky", priceGbp: 16, drinkLabel: "Smoking Barrel" },
  { sourceUrl: "https://loreoftheland.com/menu/drinks-menu/", category: "wine", priceGbp: 9.5, drinkLabel: "Organic Apple Cider Vinegar Based 0% Wine" },
  { sourceUrl: "https://venue5.com/drinks-menu/", category: "alcohol-free", priceGbp: 4.95, drinkLabel: "Corona" },
  { sourceUrl: "https://venue5.com/drinks-menu/", category: "alcohol-free", priceGbp: 4.95, drinkLabel: "Corona {4.6% ABV}" },
  { sourceUrl: "https://venue5.com/drinks-menu/", category: "alcohol-free", priceGbp: 4.95, drinkLabel: "Desperado" },
  { sourceUrl: "https://venue5.com/drinks-menu/", category: "alcohol-free", priceGbp: 4.95, drinkLabel: "Desperado {5.9% ABV}" },
  { sourceUrl: "https://venue5.com/drinks-menu/", category: "beer", priceGbp: 4.5 },
  { sourceUrl: "https://venue5.com/drinks-menu/", category: "beer", priceGbp: 4.95, drinkLabel: "Budweiser" },
  { sourceUrl: "https://venue5.com/drinks-menu/", category: "beer", priceGbp: 4.95, drinkLabel: "Budweiser {5.0% ABV}" },
  { sourceUrl: "https://venue5.com/drinks-menu/", category: "beer", priceGbp: 4.95, drinkLabel: "Peroni" },
  { sourceUrl: "https://venue5.com/drinks-menu/", category: "beer", priceGbp: 4.95, drinkLabel: "Peroni {5.1% ABV}" },
  { sourceUrl: "https://venue5.com/drinks-menu/", category: "beer", priceGbp: 5, drinkLabel: "Fresh Passion Fruit" },
  { sourceUrl: "https://venue5.com/drinks-menu/", category: "beer", priceGbp: 3.5, drinkLabel: "Guava" },
  { sourceUrl: "https://venue5.com/drinks-menu/", category: "beer", priceGbp: 3.5, drinkLabel: "Lychee" },
  { sourceUrl: "https://venue5.com/drinks-menu/", category: "beer", priceGbp: 5.25, drinkLabel: "Mixed Fruit/ Strawberry Lime" },
  { sourceUrl: "https://venue5.com/drinks-menu/", category: "beer", priceGbp: 8.95, drinkLabel: `V5 Special Shakes ${String.fromCodePoint(0x2014)} Vanilla/Strawberry/Chocolate/Oreo` },
  { sourceUrl: "https://venue5.com/drinks-menu/", category: "rum", priceGbp: 11, drinkLabel: "\u00a3 140.00 Ciroc" },
  { sourceUrl: "https://venue5.com/drinks-menu/", category: "vodka", priceGbp: 13.99, drinkLabel: "Aperol Voyage" },
  { sourceUrl: "https://venue5.com/drinks-menu/", category: "vodka", priceGbp: 13.99, drinkLabel: "French 77" },
  { sourceUrl: "https://venue5.com/drinks-menu/", category: "wine", priceGbp: 15, drinkLabel: "\u00a3 100.00 Patron Silver" },
  { sourceUrl: "https://venue5.com/drinks-menu/", category: "wine", priceGbp: 10, drinkLabel: "\u00a3 120.00 Tequila Rose" },
  { sourceUrl: "https://venue5.com/banquet-hall-menu/", category: "soft-drink", priceGbp: 2.75, drinkLabel: "Diet Coke" },
  { sourceUrl: "https://venue5.com/banquet-hall-menu/", category: "soft-drink", priceGbp: 2.75, drinkLabel: "Orange Juice" },
  { sourceUrl: "https://venue5.com/banquet-hall-menu/", category: "soft-drink", priceGbp: 3.25, drinkLabel: "Pi\u00f1a Colada {Alcoholic}" },
  { sourceUrl: "https://venue5.com/banquet-hall-menu/", category: "soft-drink", priceGbp: 2.75, drinkLabel: `Soft Drinks Package ${String.fromCodePoint(0x2014)} Non-Veg Non-Veg Coke` },
  { sourceUrl: "https://venue5.com/banquet-hall-menu/", category: "soft-drink", priceGbp: 2.75, drinkLabel: "Water" },
];

export function isCategoryQuarantined(row: UkPriceBundleRow): boolean {
  return row.lane === "site-harvest" && row.standing === "listed" &&
    CATEGORY_QUARANTINE.some((item) =>
      item.sourceUrl === row.sourceUrl && item.category === row.category &&
      item.priceGbp === row.priceGbp && item.drinkLabel === row.drinkLabel,
    );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFinitePrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function isUkPriceBundleLane(value: unknown): value is UkPriceBundleLane {
  return typeof value === "string" && (UK_PRICE_BUNDLE_LANES as readonly string[]).includes(value);
}

/**
 * An estimate owes its basis and sample, and only an estimate may carry an
 * operator count, because only a modelled figure rests on operators.
 */
function hasValidEstimateArgument(row: Record<string, unknown>): boolean {
  if (row.standing === "estimate") {
    if (!isNonEmptyString(row.basis)) return false;
    if (!Number.isInteger(row.sampleSize) || (row.sampleSize as number) <= 0) return false;
  }
  if (row.operatorCount === undefined) return true;
  return row.standing === "estimate" && Number.isInteger(row.operatorCount) && (row.operatorCount as number) > 0;
}

/**
 * A row is valid only if it can be cited. THE TWO THINGS EVERY ROW OWES are a
 * day and, unless it is modelled, a source URL; a row without them is a figure
 * nobody can check or correct, and validate-data refuses the file over it.
 */
export function isValidUkPriceBundleRow(value: unknown): value is UkPriceBundleRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  if (!isNonEmptyString(row.venueId)) return false;
  if (!isNonEmptyString(row.category)) return false;
  if (!isFinitePrice(row.priceGbp)) return false;
  if (!isUkPriceBundleLane(row.lane)) return false;
  if (!isNonEmptyString(row.observedAt) || !Number.isFinite(Date.parse(row.observedAt as string))) {
    return false;
  }
  if (row.standing === "listed") {
    if (!isNonEmptyString(row.sourceUrl)) return false;
    try {
      const url = new URL(row.sourceUrl as string);
      if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    } catch {
      return false;
    }
  }
  if (!hasValidEstimateArgument(row)) return false;
  if (row.drinkLabel !== undefined) {
    if (typeof row.drinkLabel !== "string" || row.drinkLabel.length === 0) return false;
    if (row.drinkLabel.length > UK_PRICE_BUNDLE_DRINK_LABEL_MAX) return false;
  }
  if (row.servingSize !== undefined) {
    if (typeof row.servingSize !== "string" || row.servingSize.trim() !== row.servingSize ||
        row.servingSize.length === 0 || row.servingSize.length > 40 ||
        /\p{Cc}/u.test(row.servingSize)) return false;
    if (row.standing !== "listed") return false;
  }
  if (row.drinkSubtype !== undefined) {
    if (!isValidBundleDrinkSubtypeForRow(row.category, row.drinkSubtype)) return false;
    if (typeof row.drinkLabel !== "string" || !row.drinkLabel.trim()) return false;
  }
  if (!hasValidLondonBasePlace(row)) return false;
  return row.standing === "confirmed" || row.standing === "listed" || row.standing === "estimate";
}

const LONDON_BOUNDS = { minLat: 51.25, maxLat: 51.75, minLng: -0.55, maxLng: 0.35 } as const;

function hasValidLondonBasePlace(row: Record<string, unknown>): boolean {
  const { lat, lng, londonBorough } = row;
  if (lat === undefined && lng === undefined && londonBorough === undefined) return true;
  if (typeof lat !== "number" || typeof lng !== "number") return false;
  if (!isNonEmptyString(londonBorough)) return false;
  if (lat < LONDON_BOUNDS.minLat || lat > LONDON_BOUNDS.maxLat) return false;
  if (lng < LONDON_BOUNDS.minLng || lng > LONDON_BOUNDS.maxLng) return false;
  return (
    row.standing === "listed" &&
    typeof row.venueId === "string" &&
    row.venueId.startsWith("venue-uk-") &&
    row.drinkSubtype !== undefined
  );
}

export function parseUkPriceBundleRows(raw: unknown): UkPriceBundleRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((row) => isValidUkPriceBundleRow(row) && !isCategoryQuarantined(row));
}

/**
 * The rows a surface may treat as a FACT about tonight's price. Everything the
 * standing vocabulary says carries authority, and nothing else, which is how an
 * estimate is kept out of pin colour and the Index without every caller having
 * to remember the rule.
 */
export function authoritativeBundleRows(rows: readonly UkPriceBundleRow[]): UkPriceBundleRow[] {
  return rows.filter((row) => standingCarriesAuthority(row.standing) && !isCategoryQuarantined(row));
}

/**
 * The strongest row the bundle holds for one pub and one drink, decided by the
 * ONE decider. A harvested listing beats a modelled estimate for the same pub
 * and drink because `priceStandingFor` says so, not because this function
 * re-decides it.
 */
export function strongestBundleRow(
  rows: readonly UkPriceBundleRow[],
  now: number = Date.now(),
): PriceStandingDecision {
  return priceStandingFor(bundlePriceInputs(rows), now);
}

/**
 * The two inputs `priceStandingFor` takes, over rows already narrowed to one
 * pub and one drink.
 *
 * WITHIN ONE STANDING, THE READ SIDE PICKS WHAT THE BUILD SIDE KEEPS: the
 * freshest reading, and the cheapest within that reading. Both sides ask
 * `bundleRowSupersedes`, so a second listed lane landing for one pub cannot
 * make the sheet quote a figure the builder itself would have superseded. The
 * two standings are gathered apart because choosing BETWEEN them is the one
 * decider's job, never this function's.
 */
function bundlePriceInputs(rows: readonly UkPriceBundleRow[]): {
  listed: ListedPriceInput | null;
  estimate: EstimatedPriceInput | null;
} {
  let listed: UkPriceBundleRow | undefined;
  let estimate: UkPriceBundleRow | undefined;
  for (const row of rows) {
    if (isCategoryQuarantined(row)) continue;
    if (row.standing === "listed" && row.sourceUrl) {
      if (bundleRowSupersedes(row, listed)) listed = row;
      continue;
    }
    if (row.standing === "estimate" && row.basis && row.sampleSize) {
      if (bundleRowSupersedes(row, estimate)) estimate = row;
    }
  }
  return {
    listed: listed
      ? {
          priceGbp: listed.priceGbp,
          sourceUrl: listed.sourceUrl as string,
          observedAt: listed.observedAt,
          publisher: typeof listed.publisher === "string" ? listed.publisher.trim() || null : null,
        }
      : null,
    estimate: estimate
      ? {
          priceGbp: estimate.priceGbp,
          basis: estimate.basis as string,
          sampleSize: estimate.sampleSize as number,
          computedAt: estimate.observedAt,
        }
      : null,
  };
}

/** Those same two inputs, for the rows of one drink out of a whole pub's set. */
export function bundlePricesForCategory(
  rows: readonly UkPriceBundleRow[],
  category: string,
): { listed: ListedPriceInput | null; estimate: EstimatedPriceInput | null } {
  return bundlePriceInputs(rows.filter((row) => row.category === category));
}

/**
 * The drink a pub's own price area is about. Beer is the lane the map rests in
 * (lib/drinkLanes.ts), so the sheet's price claim is a beer claim, and naming
 * it once here stops a surface reaching for a different drink's figure.
 */
export const BUNDLE_DEFAULT_CATEGORY = "beer";

/**
 * Which of two rows for one pub and one drink the bundle keeps, and the ONE
 * ordering both sides of the bundle spend: the builder folding a lane's rows
 * down to what it stores, and `bundlePriceInputs` picking what a sheet reads
 * back out. A rule stated twice is a rule that drifts, and this one drifted
 * once already.
 *
 * TWO QUESTIONS, ANSWERED IN ORDER, because they are about different things.
 *
 * 1. THE FRESHEST READING WINS. A page read twice is one page answering twice,
 *    and the later answer is the one that is true now. Keeping the cheaper of
 *    two readings publishes last year's figure the moment a pub puts its prices
 *    up, and dates it to the day it was cheap.
 * 2. WITHIN ONE READING, THE CHEAPEST WINS. A menu states many lines for one
 *    pub's beer, and the figure a drinker can walk in and pay is the lowest of
 *    them. A reading is stamped once per page, so the rows of one page share an
 *    instant and land here as a tie.
 *
 * Returns true when `candidate` should replace `held`.
 */
export function bundleRowSupersedes(
  candidate: UkPriceBundleRow,
  held: UkPriceBundleRow | undefined,
): boolean {
  if (!held) return true;
  if (candidate.observedAt !== held.observedAt) return candidate.observedAt > held.observedAt;
  return candidate.priceGbp < held.priceGbp;
}

/** Shared collect key keeps named servings separate within each pub and lane. */
export function ukPriceBundleCollectKey(
  row: Pick<UkPriceBundleRow, "venueId" | "category" | "lane" | "drinkLabel" | "servingSize">,
): string {
  return `${row.venueId} ${row.category} ${bundleRowDedupeDrinkKey(row)} ${row.lane}`;
}

/** Rows grouped by the venue they are about, in the order the bundle states them. */
export function bundleRowsByVenue(
  rows: readonly UkPriceBundleRow[],
): Map<string, UkPriceBundleRow[]> {
  const byVenue = new Map<string, UkPriceBundleRow[]>();
  for (const row of rows) {
    const held = byVenue.get(row.venueId);
    if (held) held.push(row);
    else byVenue.set(row.venueId, [row]);
  }
  return byVenue;
}
