// THE CHEAPEST PINT WE CAN FIND, AND ONE OWNER FOR IT.
//
// Captain decisions 2 and 3, 1 Nov 2026 (docs/plans/LAUNCH_PLAN_2026-11-01.md):
// the launch story is the hunt for the UK's cheapest drink, framed "UK hunt,
// London deep". Every claim shows a real, dated price, a city with no prices
// says so, and London stays the deep, complete city. The landing hero, the
// city-by-city list and London's dearest pint all read THIS module, so the
// three can never name two different winners for one question.
//
// WHAT MAY WIN. Only a price the one decider (lib/priceTier.ts) calls `listed`
// or `confirmed`, carrying a named publisher and the day that publisher's own
// row was read. An estimate is never called cheapest: nothing here reads the
// modelling engine, and the bundle is narrowed by `authoritativeBundleRows`
// before anything else looks at it. A row without a date or a publisher cannot
// win, because a figure nobody can check is not a claim we make.
//
// TWO LANES, EACH READ BY ITS OWN EXISTING READER, NEVER RE-DECIDED HERE.
//
//   - London: the pubs in our London pub list with a listed cheapest pint
//     (`listedPriceCohort`, lib/pricedPubCount.ts, the same set an average is
//     taken over), each judged by `answerEvidenceFor` (lib/landingHero.ts), the
//     reading the landing's own pub card makes. Not counted again.
//   - The UK price bundle (public/data/uk_prices/rows.json): beer rows only,
//     each pub's figure being the one its own venue sheet quotes
//     (`bundlePricesForCategory`), after the measure law
//     (lib/drinkMeasure.ts) has held out any row whose own words or serving
//     name a half, a third or a bottle. Nothing is ever scaled.
//
// THE WETHERSPOON UK DATA IS NOT A LANE. The chain's directory carries no
// per-pub price (lib/wetherspoons.ts), and the SpoonMe import is units per
// tenner, which by law may never become a price. London's Wetherspoon pints
// reach this module through the London lane like any other listed pint.
//
// THE HEADLINE BAR: A WINNER NAMES ITS DRINK (`huntRowNamesItsDrink`). The map
// reads an unstated measure as a pint, and that is right for a pin. It is not
// enough for "the cheapest pint in Britain": the first build of this module
// crowned a £2.00 taplist "beer" row (Enid Street Tavern, read 18 Oct 2026)
// that stated no drink and no serving, from a harvest whose other labels read
// "/" and "13.0% (", which is the shape of a third-pint price parsed loose.
// So a figure may stand in ANY line here (Britain's cheapest, a city's
// cheapest, London's dearest) only on a row whose own label names a drink in
// real words, or whose own serving field states a pint. The London list holds
// no serving field, so its row must name its pint (`pint_name`), and a row that
// names none cannot win. The measure law still holds out a half or a third
// first, and nothing is ever scaled.
//
// A bar the public cannot walk into never wins (`isPublicRankablePub`, which
// also reads a students' union from its initials).
//
// THE FRONT DOOR NAMES ONLY THE PLACES THE PAGE NAMES. Britain's cheapest is
// taken from London and the named cities on the map and from nothing else: a
// pub outside every map city is not placed at all (the resolver answers null),
// and `buildCheapestHunt` refuses an unplaced row a second time, so a row with
// no city can never reach the hero. The first build kept an "Elsewhere in
// Britain" row, and on 1 Nov 2026 its winner was a misfiled shot, "(red bull +
// Jägermeister) Baby Guinness" at £2.20, placed at "St Pauls Road" by the
// nearest-town guess. Outside the map cities we hold no review of the rows
// and no city page to check them against, so they make no claim here.
//
// Pure: no fs, no React. lib/cheapestHunt.server.ts wires the real reads.

import type { Route } from "next";

import { CITIES, enabledCityContainingPoint, listEnabledCities, type CityId } from "@/lib/cities";
import { cityAwareMapPath } from "@/lib/cityMapHref";
import { cityIdFromVenueId, isNationalBaseVenueId } from "@/lib/cityVenueIds";
import { measureFromServingSize, measureNamedInDrinkText } from "@/lib/drinkMeasure";
import { answerEvidenceFor } from "@/lib/landingHero";
import { formatSelectionHint } from "@/lib/mapSelectionHistory";
import { listedPriceCohort } from "@/lib/pricedPubCount";
import { priceStandingFor } from "@/lib/priceTier";
import {
  authoritativeBundleRows,
  BUNDLE_DEFAULT_CATEGORY,
  bundlePricesForCategory,
  type UkPriceBundleRow,
} from "@/lib/ukPriceBundle";
import { isPublicRankablePub } from "@/lib/venueKindFilters";
import { venueMapUrl } from "@/lib/venueMapUrl";
import type { Venue } from "@/lib/venues";

/** The hero card's heading, the captain's own words (launch plan, section 3). */
export const HUNT_HERO_TITLE = "The cheapest pint we can find in Britain right now";

/** The city-by-city section's heading. */
export const HUNT_CITIES_TITLE = "Britain's cheapest pint, city by city";

/** What a city on the map with no listed price says, and the door it opens. */
export const HUNT_CITY_EMPTY_LINE = "No prices yet.";
export const HUNT_CITY_EMPTY_ACTION = "Log the first one.";

/**
 * What a city says when it holds published pint prices but none of them names
 * its pint, so none may stand as the city's cheapest (`huntRowNamesItsDrink`).
 * It is not "No prices yet", because that would be untrue of the city.
 */
export const HUNT_CITY_UNNAMED_LINE = "Prices listed, but none says which pint.";
export const HUNT_CITY_UNNAMED_ACTION = "Log yours.";

/** The press card's heading. Never a pin colour and never on the map. */
export const HUNT_DEAREST_TITLE = "London's dearest pint";

export type HuntStanding = "listed" | "confirmed";

/** Which reader a pint came through: our London pub list, or the UK price bundle. */
type HuntLane = "london-list" | "uk-bundle";

/** One pint that may stand in a "cheapest" line: a real figure, its source and its day. */
export type HuntPint = {
  venueId: string;
  pubName: string;
  /**
   * The map city the pub stands in. Null only for a row no lane should emit
   * (a pub outside every map city), which `buildCheapestHunt` refuses.
   */
  cityId: CityId | null;
  /** "London", "Manchester": the city the claim says the pub is in. */
  placeName: string;
  priceGbp: number;
  publisher: { label: string; url: string };
  /** ISO day (`YYYY-MM-DD`) the publisher's own row was read at its source. */
  observedOn: string;
  standing: HuntStanding;
  lane: HuntLane;
  /** Opens the pub on the map. */
  mapHref: Route;
};

/** Where a pub stands, as the claim prints it: always a city on the map. */
type HuntPlace = {
  cityId: CityId;
  placeName: string;
  /** The pub's name when the bundle row does not state one. */
  pubName: string | null;
  /** The pub's own point, for a base pub the map opens from a hint. */
  point: { lat: number; lng: number } | null;
};

export type HuntPlaceResolver = (
  venueId: string,
  rows: readonly UkPriceBundleRow[],
) => HuntPlace | null;

/** What the resolver reads, loaded by the server wiring. */
export type HuntPlaceSources = {
  /** Our London pub list, by venue id, for a row that states no name. */
  londonPubNames: ReadonlyMap<string, string>;
  /** Every open national base pub, by venue id, with its own point. */
  basePubs: ReadonlyMap<string, { name: string; lat: number; lng: number }>;
};

/** One row of the city-by-city list: the cheapest pint, or the honest empty line. */
type HuntCityRow = {
  cityId: CityId;
  cityName: string;
  pint: HuntPint | null;
  /**
   * True when the city has no winner but DOES hold a published pint price that
   * names no pint (`citiesWithUnnamedPints`), so its row may not say it has no
   * prices.
   */
  unnamedPricesHeld: boolean;
  /** The city's own price door, used when the city has no winner. */
  logHref: Route;
};

export type CheapestHunt = {
  /**
   * The cheapest pint we can find in Britain, or null: the cheapest of the
   * city rows the page names (London and the cities on the map), never an
   * unplaced row.
   */
  britain: HuntPint | null;
  /** Every city on the map, in the map's own order, priced or not. */
  cities: HuntCityRow[];
  /** The London pub whose cheapest pint is the dearest we hold, or null. */
  londonDearest: HuntPint | null;
};

function isoDay(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value.length === 10 ? `${value}T12:00:00.000Z` : value);
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null;
}

/**
 * Cheapest first; at one price the freshest read, then the pub's name, then
 * its id, so the prerendered document names the same pub on every build.
 */
function compareHuntPints(left: HuntPint, right: HuntPint): number {
  return (
    left.priceGbp - right.priceGbp ||
    right.observedOn.localeCompare(left.observedOn) ||
    left.pubName.localeCompare(right.pubName, "en-GB") ||
    left.venueId.localeCompare(right.venueId)
  );
}

/** An ABV figure ("13.0%", "4,5 %"), which is a number about a drink, never its name. */
const ABV_FIGURE = /\d+(?:[.,]\d+)?\s*%/g;
/** One word of two letters or more, in any script. */
const DRINK_WORD = /\p{L}{2,}/u;

/** Whether a printed label is real words, once ABV figures and punctuation are set aside. */
function labelNamesADrink(label: unknown): boolean {
  return typeof label === "string" && DRINK_WORD.test(label.replace(ABV_FIGURE, " "));
}

/** Whether a source's own serving field states a pint (lib/drinkMeasure.ts), or 568 ml. */
function servingStatesAPint(serving: unknown): boolean {
  return (
    typeof serving === "string" &&
    (measureFromServingSize(serving) === "pint" || /^568 ?ml$/i.test(serving.trim()))
  );
}

/**
 * THE HEADLINE BAR (see the header): may this row's figure stand in a
 * "cheapest" or "dearest" line? Only when the row NAMES ITS DRINK, by a label
 * in real words (not empty, not punctuation, not an ABV fragment such as
 * "13.0% (") or by a serving field that states a pint. A row that states
 * neither may be a third, a taster or a garbled parse, and the front door does
 * not stake a national claim on it.
 */
export function huntRowNamesItsDrink(row: {
  drinkLabel?: string | null;
  servingSize?: string | null;
}): boolean {
  return servingStatesAPint(row.servingSize) || labelNamesADrink(row.drinkLabel);
}

/**
 * The London list's own evidence for the bar: a row that carries the figure
 * and names its pint, with no half or third in that name. The list states no
 * serving field, so the name is the only evidence it holds.
 */
function londonFigureNamesItsPint(venue: Venue, priceGbp: number): boolean {
  return venue.prices.some(
    (price) =>
      typeof price.price_gbp === "number" &&
      Math.abs(price.price_gbp - priceGbp) < 0.005 &&
      huntRowNamesItsDrink({ drinkLabel: price.pint_name }) &&
      measureNamedInDrinkText(price.pint_name) === null,
  );
}

/**
 * The London lane: each pub in our list with its own listed cheapest pint,
 * read the way the landing's pub card reads it. A pub whose figure does not
 * stand as `listed` with a publisher and a read day, or whose figure names no
 * pint, is not a candidate.
 */
export function londonHuntPints(venues: readonly Venue[], now: number = Date.now()): HuntPint[] {
  const pints: HuntPint[] = [];
  for (const venue of listedPriceCohort(venues)) {
    if (!isPublicRankablePub(venue)) continue;
    const priceGbp = venue.cheapestPrice as number;
    if (!londonFigureNamesItsPint(venue, priceGbp)) continue;
    const evidence = answerEvidenceFor({ priceGbp, prices: venue.prices }, now);
    const observedOn = isoDay(evidence.observedOn);
    if (evidence.standing !== "listed" || !evidence.publisher || !observedOn) continue;
    pints.push({
      venueId: venue.id,
      pubName: venue.name,
      cityId: "london",
      placeName: CITIES.london.displayName,
      priceGbp,
      publisher: evidence.publisher,
      observedOn,
      standing: "listed",
      lane: "london-list",
      mapHref: venueMapUrl(venue.id),
    });
  }
  return pints;
}

/**
 * Whether a bundle row may stand for a PINT. The measure law reads the row's
 * own words and its own serving field; a row that names a half, a third or a
 * bottle is held out, never scaled, and an unstated measure is a pint, as it
 * is on every other lane (lib/drinkMeasure.ts).
 */
function rowIsAPint(row: UkPriceBundleRow): boolean {
  if (measureNamedInDrinkText(row.drinkLabel) !== null) return false;
  if (row.servingSize === undefined) return true;
  return measureFromServingSize(row.servingSize) === "pint" || /^568 ?ml$/i.test(row.servingSize);
}

type BundleFigure = Pick<HuntPint, "priceGbp" | "publisher" | "observedOn" | "standing">;

/** The figure a pub's own venue sheet quotes, or a confirmed one, if it may win. */
function bundleFigures(rows: readonly UkPriceBundleRow[], now: number): BundleFigure[] {
  const figures: BundleFigure[] = [];
  const listed = bundlePricesForCategory(rows, BUNDLE_DEFAULT_CATEGORY).listed;
  const listedDay = isoDay(listed?.observedAt);
  if (listed?.publisher && listedDay && priceStandingFor({ listed }, now).standing === "listed") {
    figures.push({
      priceGbp: listed.priceGbp,
      publisher: { label: listed.publisher, url: listed.sourceUrl },
      observedOn: listedDay,
      standing: "listed",
    });
  }
  for (const row of rows) {
    if (row.standing !== "confirmed") continue;
    const publisher = row.publisher?.trim();
    const day = isoDay(row.observedAt);
    if (!publisher || !row.sourceUrl || !day) continue;
    const confirmed = { priceGbp: row.priceGbp, observedAt: row.observedAt };
    if (priceStandingFor({ confirmed }, now).standing !== "confirmed") continue;
    figures.push({
      priceGbp: row.priceGbp,
      publisher: { label: publisher, url: row.sourceUrl },
      observedOn: day,
      standing: "confirmed",
    });
  }
  return figures;
}

/**
 * The bundle lane: one pint per pub, the cheapest figure that pub may claim,
 * placed in a map city by `placeOf`. A pub the resolver cannot place in one is
 * left out. Only rows that clear the headline bar (`huntRowNamesItsDrink`)
 * are read.
 */
export function bundleHuntPints(
  byVenue: ReadonlyMap<string, readonly UkPriceBundleRow[]>,
  placeOf: HuntPlaceResolver,
  now: number = Date.now(),
): HuntPint[] {
  return bundlePubPints(byVenue, placeOf, now, true);
}

/**
 * The map cities where the bundle holds a published, dated pint price that
 * does NOT clear the headline bar. Such a city is not empty, so its row may
 * not say "No prices yet": it says that none of its prices names its pint.
 */
export function citiesWithUnnamedPints(
  byVenue: ReadonlyMap<string, readonly UkPriceBundleRow[]>,
  placeOf: HuntPlaceResolver,
  now: number = Date.now(),
): Set<CityId> {
  const cities = new Set<CityId>();
  for (const pint of bundlePubPints(byVenue, placeOf, now, false)) {
    if (pint.cityId) cities.add(pint.cityId);
  }
  return cities;
}

function bundlePubPints(
  byVenue: ReadonlyMap<string, readonly UkPriceBundleRow[]>,
  placeOf: HuntPlaceResolver,
  now: number,
  namedOnly: boolean,
): HuntPint[] {
  const pints: HuntPint[] = [];
  for (const [venueId, all] of byVenue) {
    // The sheet's own reading, taken over the rows that are pints by the
    // measure law and, for a winner, rows that name their drink.
    const beer = authoritativeBundleRows(all).filter(
      (row) =>
        row.category === BUNDLE_DEFAULT_CATEGORY &&
        rowIsAPint(row) &&
        (!namedOnly || huntRowNamesItsDrink(row)),
    );
    if (beer.length === 0) continue;
    const figure = bundleFigures(beer, now).sort(
      (a, b) => a.priceGbp - b.priceGbp || b.observedOn.localeCompare(a.observedOn),
    )[0];
    if (!figure) continue;
    const place = placeOf(venueId, beer);
    if (!place) continue;
    const pubName = beer.find((row) => row.name?.trim())?.name?.trim() ?? place.pubName;
    if (!pubName || !isPublicRankablePub({ name: pubName })) continue;
    // A base pub opens from its own point (`at=`, lib/mapSelectionHistory.ts),
    // the way the map's own share of a base pub does.
    const pubHref: string = venueMapUrl(venueId);
    const mapHref = (
      place.point && isNationalBaseVenueId(venueId)
        ? `${pubHref}&at=${formatSelectionHint(place.point.lat, place.point.lng)}`
        : pubHref
    ) as Route;
    pints.push({
      venueId,
      pubName,
      cityId: place.cityId,
      placeName: place.placeName,
      ...figure,
      lane: "uk-bundle",
      mapHref,
    });
  }
  return pints;
}

/**
 * Where a bundle pub stands: always a city on the map, or nowhere. A curated
 * id names its own city; a national base pub is placed by its own point, and
 * only inside a map city. A base id on its own says nothing about where the
 * pub is (lib/cityVenueIds.ts), so a base pub with no point, or one outside
 * every map city, is not placed and makes no claim.
 */
export function huntPlaceResolver(sources: HuntPlaceSources): HuntPlaceResolver {
  return (venueId, rows) => {
    if (isNationalBaseVenueId(venueId)) {
      const own = rows.find((row) => typeof row.lat === "number" && typeof row.lng === "number");
      const base = sources.basePubs.get(venueId);
      // The catalogue only holds open pubs, so a pub it does not know is not named.
      if (!base) return null;
      const point = own ? { lat: own.lat as number, lng: own.lng as number } : { lat: base.lat, lng: base.lng };
      const city = enabledCityContainingPoint(point.lat, point.lng);
      return city ? { cityId: city.id, placeName: city.displayName, pubName: base.name, point } : null;
    }
    const cityId = cityIdFromVenueId(venueId);
    if (cityId) return { cityId, placeName: CITIES[cityId].displayName, pubName: null, point: null };
    const londonName = sources.londonPubNames.get(venueId) ?? null;
    return { cityId: "london", placeName: CITIES.london.displayName, pubName: londonName, point: null };
  };
}

/** One pint per pub: where both lanes hold the same pub, its cheaper claim. */
function cheapestPerPub(pints: readonly HuntPint[]): HuntPint[] {
  const byVenue = new Map<string, HuntPint>();
  for (const pint of pints) {
    const held = byVenue.get(pint.venueId);
    if (!held || compareHuntPints(pint, held) < 0) byVenue.set(pint.venueId, pint);
  }
  return [...byVenue.values()];
}

function cheapestOf(pints: readonly HuntPint[]): HuntPint | null {
  return [...pints].sort(compareHuntPints)[0] ?? null;
}

/**
 * The whole hunt from both lanes: every map city's cheapest (or its honest
 * empty line), Britain's cheapest taken from those city winners alone, and
 * the London pub whose cheapest pint is the dearest we hold.
 *
 * THE DEAREST IS A PUB'S CHEAPEST PINT, READ FROM OUR LONDON PUB LIST ALONE.
 * "The dearest pint" over every row would crown a cocktail or a bottle; the
 * pub where even the cheapest pint costs the most is a claim the data can
 * stand behind, and it is the dearest the borough fact blocks already print
 * (lib/pintFacts.ts), over the same list. The bundle stays out of it on
 * evidence: its dearest London "beer" on 1 Nov 2026 was an £11 line that read
 * "Fish Finger haddock, tartare sauce", which a press card may never quote.
 */
export function buildCheapestHunt(
  pints: readonly HuntPint[],
  /** Cities holding a published pint price that names no pint (`citiesWithUnnamedPints`). */
  unnamedPriceCities: ReadonlySet<CityId> = new Set(),
): CheapestHunt {
  const perPub = cheapestPerPub(pints);
  const cities = listEnabledCities().map((city): HuntCityRow => {
    const pint = cheapestOf(perPub.filter((candidate) => candidate.cityId === city.id));
    return {
      cityId: city.id,
      cityName: city.displayName,
      pint,
      unnamedPricesHeld: pint === null && unnamedPriceCities.has(city.id),
      logHref: cityAwareMapPath(city.id, "log=1"),
    };
  });
  const londonList = pints.filter((pint) => pint.lane === "london-list" && pint.cityId === "london");
  const londonDearest =
    [...londonList].sort(
      (a, b) =>
        b.priceGbp - a.priceGbp ||
        b.observedOn.localeCompare(a.observedOn) ||
        a.pubName.localeCompare(b.pubName, "en-GB") ||
        a.venueId.localeCompare(b.venueId),
    )[0] ?? null;
  // The hero names only what the page names: the winner of a city row. A row
  // with no city, from any lane, never reaches the front door.
  const britain = cheapestOf(
    cities.flatMap((row) => (row.pint ? [row.pint] : [])),
  );
  return { britain, cities, londonDearest };
}

/** "Listed by" or "Confirmed by", the verb the standing has earned. */
export function huntSourceVerb(standing: HuntStanding): string {
  return standing === "confirmed" ? "Confirmed by" : "Listed by";
}
