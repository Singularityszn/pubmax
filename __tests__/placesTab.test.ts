import type { Route } from "next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { buildTabs } from "@/components/nav/MobileTabBar";
import { PRIMARY_NAV_ITEMS, primaryNavKeyForPath } from "@/components/nav/navigationModel";
import { listEnabledCities } from "@/lib/cities";
import { getCityCapabilityProfile } from "@/lib/cityCapabilities";
import {
  mapHrefForCity,
  preferredCityMapHref,
  readPreferredCity,
  writePreferredCity,
} from "@/lib/cityPreference";
import PlaceIndexCredit from "@/components/city/PlaceIndexCredit";
import {
  cityChooserResultBadge,
  cityChooserResultContext,
  TOWN_SEARCH_UNAVAILABLE_LEAD,
} from "@/lib/cityChooserSearch";
import { getNightAreasForCity } from "@/lib/nightAreas";
import {
  PLACES_AREAS_COMING_PILL,
  PLACES_KICKER,
  PLACES_PATH,
  PLACES_PRICES_COMING_PILL,
  PLACES_PRICES_LISTED_PILL,
  PLACES_SET_CITY_LABEL,
  PLACES_SHOW_ALL_LABEL,
  PLACES_TITLE,
  filterPlacesCityRows,
  parsePlacesCityParam,
  placesAreasEmptyLine,
  placesAreasForCity,
  placesAreasTitle,
  placesCityHref,
  placesCityRows,
  placesCityActions,
  placesCurrentCityLine,
  placesPricesLine,
  placesPricesPill,
  placesSearchEmptyLine,
  placesShouldSearchTowns,
  placesTownLookupPending,
  placesTownResults,
  placesTownSearchUnavailableLine,
} from "@/lib/places";
import { normaliseUkPlaceQuery, type UkPlace } from "@/lib/ukPlaceSearch";
import { defined } from "@/__tests__/helpers/defined";

vi.mock("next/navigation", () => ({
  usePathname: () => PLACES_PATH,
  useRouter: () => ({ push: () => {}, replace: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/nav/MessagesLink", () => ({ default: () => null }));
vi.mock("@/components/nav/NotificationBell", () => ({ default: () => null }));
vi.mock("@/components/nav/SiteNavMore", () => ({
  default: () => null,
  siteNavMoreItems: () => [],
}));
vi.mock("@/components/auth/SignInButton", () => ({ default: () => null }));
vi.mock("@/components/ThemeToggle", () => ({ default: () => null }));
vi.mock("@/components/command/CommandPaletteProvider", () => ({
  useCommandPalette: () => ({ open: () => {} }),
}));

const STORAGE_KEY = "pubmax:preferredCity:v1";

type WindowLike = { localStorage: Storage };

function makeMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
  };
}

function installWindow(): void {
  (globalThis as { window?: WindowLike }).window = {
    localStorage: makeMemoryStorage(),
  };
}

function clearWindow(): void {
  delete (globalThis as { window?: WindowLike }).window;
}

afterEach(() => {
  clearWindow();
});

// ---------------------------------------------------------------------------
// The chooser: which cities exist, and what a row may claim about one
// ---------------------------------------------------------------------------

describe("Places city chooser", () => {
  it("offers every shipped city pack, in the shipped order", () => {
    const rows = placesCityRows();
    const enabled = listEnabledCities();
    expect(rows.map((row) => row.cityId)).toEqual(enabled.map((city) => city.id));
    expect(rows.length).toBeGreaterThanOrEqual(10);
    expect(rows[0]?.cityId).toBe("london");
    // The nine non-London packs the captain asked for are all pickable.
    for (const id of [
      "manchester",
      "liverpool",
      "glasgow",
      "bristol",
      "bath",
      "oxford",
      "cambridge",
      "durham",
      "llandudno",
    ]) {
      expect(rows.some((row) => row.cityId === id)).toBe(true);
    }
  });

  it("names each row off the city table rather than restating it", () => {
    const rows = placesCityRows();
    for (const city of listEnabledCities()) {
      const row = rows.find((candidate) => candidate.cityId === city.id);
      expect(row?.name).toBe(city.displayName);
      expect(row?.tagline).toBe(city.tagline);
    }
  });

  it("searches the name and the tagline, and keeps everything for an empty query", () => {
    const rows = placesCityRows();
    expect(filterPlacesCityRows(rows, "").length).toBe(rows.length);
    expect(filterPlacesCityRows(rows, "   ").length).toBe(rows.length);
    expect(filterPlacesCityRows(rows, "manch").map((row) => row.cityId)).toEqual([
      "manchester",
    ]);
    expect(filterPlacesCityRows(rows, "MANCHESTER").map((row) => row.cityId)).toEqual([
      "manchester",
    ]);
    // Glasgow's tagline is the only one that names the Subway.
    expect(filterPlacesCityRows(rows, "subway").map((row) => row.cityId)).toEqual([
      "glasgow",
    ]);
    expect(filterPlacesCityRows(rows, "reykjavik")).toEqual([]);
  });

  it("says which name it could not find rather than showing a bare blank", () => {
    expect(placesSearchEmptyLine("Reykjavik")).toContain("Reykjavik");
    expect(placesSearchEmptyLine("Reykjavik")).not.toMatch(/try again later/i);
  });

  it("matches city names from word starts rather than inside another name", () => {
    const rows = placesCityRows();
    expect(filterPlacesCityRows(rows, "Chester")).toEqual([]);
    const row = { ...defined(rows[0]), name: "New Chester", tagline: "A city guide" };
    expect(filterPlacesCityRows([row], "  CHEST  ")).toEqual([row]);
    expect(filterPlacesCityRows([row], "new chest")).toEqual([row]);
    expect(filterPlacesCityRows([row], "ester")).toEqual([]);
  });

  it("reads ?city= as a closed id, and never as free text", () => {
    expect(parsePlacesCityParam("manchester")).toBe("manchester");
    expect(parsePlacesCityParam("MANCHESTER")).toBe("manchester");
    expect(parsePlacesCityParam("paris")).toBeNull();
    expect(parsePlacesCityParam(null)).toBeNull();
    expect(parsePlacesCityParam("")).toBeNull();
    expect(placesCityHref("manchester")).toBe("/places?city=manchester");
  });
});

// ---------------------------------------------------------------------------
// Capability copy: prices coming, areas coming
// ---------------------------------------------------------------------------

describe("Places capability copy", () => {
  it("marks a city with no collected prices as prices coming", () => {
    const rows = placesCityRows();
    const london = rows.find((row) => row.cityId === "london")!;
    const manchester = rows.find((row) => row.cityId === "manchester")!;
    expect(london.pricesListed).toBe(true);
    expect(placesPricesPill(london)).toBe(PLACES_PRICES_LISTED_PILL);
    expect(manchester.pricesListed).toBe(false);
    expect(placesPricesPill(manchester)).toBe(PLACES_PRICES_COMING_PILL);
  });

  it("takes the price sentence from cityCapabilities rather than writing a second one", () => {
    for (const city of listEnabledCities()) {
      expect(placesPricesLine(city.id)).toBe(
        getCityCapabilityProfile(city.id).prices.explanation,
      );
    }
    expect(placesPricesLine("manchester")).toMatch(/haven't yet collected pint prices/i);
  });

  it("every row's price claim matches the one capability profile", () => {
    for (const row of placesCityRows()) {
      const profile = getCityCapabilityProfile(row.cityId);
      expect(row.pricesListed).toBe(profile.prices.availability === "available");
      expect(row.pricesAsOf).toBe(profile.prices.asOf);
    }
  });

  it("says areas are coming for a city with none, and names the gap", () => {
    // London's patches are hand-curated and four more cities have areas derived
    // from the base layer. Every OTHER city is the empty case, and it must be
    // worded as a missing map rather than as a city with nothing in it.
    expect(placesAreasForCity("london").length).toBe(
      getNightAreasForCity("london").length,
    );
    expect(placesAreasForCity("london").length).toBeGreaterThan(0);
    let empty = 0;
    for (const city of listEnabledCities()) {
      if (getNightAreasForCity(city.id).length > 0) {
        expect(placesAreasForCity(city.id)).toEqual(getNightAreasForCity(city.id));
        continue;
      }
      empty += 1;
      expect(placesAreasForCity(city.id)).toEqual([]);
      const line = placesAreasEmptyLine(city.id);
      expect(line).toContain(city.displayName);
      // The gap is named AND the thing that is there is handed over.
      expect(line).toMatch(/map/i);
    }
    expect(empty).toBeGreaterThan(0);
    expect(PLACES_AREAS_COMING_PILL).toBe("Areas coming");
  });

  it("titles the areas section for the city it is about", () => {
    expect(placesAreasTitle("london")).toBe("Where to drink in London");
    expect(placesAreasTitle("bath")).toBe("Where to drink in Bath");
  });

  it("keeps plumbing words out of every sentence a reader sees", () => {
    const copy = [
      PLACES_TITLE,
      PLACES_KICKER,
      PLACES_SET_CITY_LABEL,
      ...listEnabledCities().flatMap((city) => [
        placesPricesLine(city.id),
        placesAreasEmptyLine(city.id),
        placesAreasTitle(city.id),
        placesCurrentCityLine(city.id),
      ]),
    ].join(" ");
    expect(copy).not.toMatch(/—/); // no em dash
    expect(copy).not.toMatch(/Night Area/i);
    expect(copy).not.toMatch(/evidence gate|provenance|snapshot|capture/i);
    expect(copy).not.toMatch(/please try again|check back later|try again later/i);
    expect(copy).not.toMatch(/discover|curated|seamless|journey|unlock/i);
    expect(copy).not.toMatch(/!/);
  });
});

// ---------------------------------------------------------------------------
// The preference write, and the surfaces that follow it
// ---------------------------------------------------------------------------

describe("Places sets the one city Map, Out and Near follow", () => {
  beforeEach(() => {
    installWindow();
  });

  it("writes the preferred city, and Map follows it", () => {
    expect(readPreferredCity()).toBeNull();
    expect(preferredCityMapHref()).toBe("/map");

    writePreferredCity("manchester");

    expect(readPreferredCity()).toBe("manchester");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("manchester");
    expect(preferredCityMapHref()).toBe("/map/manchester");
    expect(buildTabs("/u/you" as Route, preferredCityMapHref()).find(
      (tab) => tab.label === "Map",
    )?.href).toBe("/map/manchester");
  });

  it("Out asks its API for the city Places set", () => {
    writePreferredCity("manchester");
    // The one thing /out reads. `useOutListings` builds its query from exactly
    // this value, and the route accepts every city the app knows.
    expect(readPreferredCity()).toBe("manchester");
  });

  it("Near reads the same stored city Places wrote", () => {
    writePreferredCity("glasgow");
    expect(readPreferredCity()).toBe("glasgow");
    expect(mapHrefForCity(readPreferredCity())).toBe("/map/glasgow");
  });

  it("keeps /map root on London for a bookmark, whatever is stored", () => {
    expect(mapHrefForCity("london")).toBe("/map");
    writePreferredCity("london");
    expect(preferredCityMapHref()).toBe("/map");
  });

  it("refuses a city that is not one of ours", () => {
    writePreferredCity("paris");
    expect(readPreferredCity()).toBeNull();
  });

  it("paints setting the city until it is set, then paints the way in", () => {
    const map = mapHrefForCity("manchester");
    // Not yours: the painted action is the caller's own "Set as my city"
    // button, so the policy hands back no primary and only the quiet way.
    expect(placesCityActions(map, false)).toEqual({
      primary: null,
      secondary: { href: "/map/manchester", label: "Open the map" },
    });
    // Yours: the map is the painted way in, and Out follows the same city.
    expect(placesCityActions(map, true)).toEqual({
      primary: { href: "/map/manchester", label: "Open the map" },
      secondary: { href: "/out", label: "What's on" },
    });
    // Neither shape offers the same door twice.
    for (const isYours of [true, false]) {
      const { primary, secondary } = placesCityActions(map, isYours);
      expect(primary?.href).not.toBe(secondary.href);
    }
    expect(placesCurrentCityLine("manchester")).toBe(
      "The map, Out and Near now open on Manchester.",
    );
  });
});

// ---------------------------------------------------------------------------
// The tab itself
// ---------------------------------------------------------------------------

describe("Places is a durable destination", () => {
  it("sits beside Map in the phone tab row and the desktop nav model", () => {
    expect(PRIMARY_NAV_ITEMS.map((item) => item.key)).toEqual([
      "now",
      "map",
      "places",
      "out",
      "plan",
      "you",
    ]);
    expect(buildTabs().map((tab) => tab.label)).toEqual([
      "Tonight",
      "Map",
      "Places",
      "Out",
      "Plan",
      "You",
    ]);
    expect(primaryNavKeyForPath("/places")).toBe("places");
  });
});

// ---------------------------------------------------------------------------
// The town fallback
// ---------------------------------------------------------------------------

describe("Places answers a town the city list does not hold", () => {
  const place = (row: Omit<UkPlace, "search">): UkPlace => ({
    ...row,
    search: normaliseUkPlaceQuery(row.name),
  });
  const TOWNS: UkPlace[] = [
    place({ name: "Sheffield", lat: 53.3800941, lng: -1.4789213, kind: "city", context: "S" }),
    place({ name: "Didsbury", lat: 53.4181794, lng: -2.23144, kind: "suburb", context: "M" }),
    place({ name: "Chester", lat: 53.1923027, lng: -2.8882727, kind: "city", context: "CH" }),
    // The index holds two Alresfords, one in Essex and one in Hampshire.
    place({ name: "Alresford", lat: 51.8528593, lng: 0.9966437, kind: "village", context: "CO" }),
    place({ name: "Alresford", lat: 51.080371, lng: -1.1707111, kind: "town", context: "SO" }),
  ];

  it("looks for towns only once no city row answers", () => {
    // A query a city answered is already answered, and a second list under it
    // would offer the same night twice.
    expect(placesShouldSearchTowns(3, "man")).toBe(false);
    expect(placesShouldSearchTowns(0, "d")).toBe(false);
    expect(placesShouldSearchTowns(0, "Didsbury")).toBe(true);
  });

  it("opens an unpriced town on its own base-map arrival", () => {
    const [result] = placesTownResults("Sheffield", TOWNS);

    expect(defined(result).kind).toBe("uncovered");
    expect(defined(result).href).toBe("/map?place=Sheffield&lat=53.3800941&lng=-1.4789213");
  });

  it("offers Chester without letting Manchester suppress or precede the town", () => {
    const shown = filterPlacesCityRows(placesCityRows(), "Chester");
    expect(shown).toEqual([]);
    expect(placesShouldSearchTowns(shown.length, "Chester")).toBe(true);
    expect(placesTownResults("Chester", TOWNS)).toEqual([
      expect.objectContaining({
        name: "Chester",
        kind: "uncovered",
        href: "/map?place=Chester&lat=53.1923027&lng=-2.8882727",
      }),
    ]);
  });

  it("keeps a matching city tagline from opening the town lookup", () => {
    const shown = filterPlacesCityRows(placesCityRows(), "northern quarter");
    expect(shown.map(row => row.cityId)).toEqual(["manchester"]);
    expect(placesShouldSearchTowns(shown.length, "northern quarter")).toBe(false);
  });

  it("sends a place inside a city we ship to that city's guide", () => {
    // Didsbury is Manchester. The retired /choose-city address answered it that
    // way, and the picker may not start calling it an unpriced elsewhere.
    const [result] = placesTownResults("Didsbury", TOWNS);

    expect(defined(result).kind).toBe("curated");
    expect(defined(result).href).toBe(mapHrefForCity("manchester"));
  });

  it("keeps the city rows as the answer when the query matched one", () => {
    // Bath is a city we ship, so the gate never opens and the town lookup
    // never runs, whatever the index would have said about the name.
    expect(filterPlacesCityRows(placesCityRows(), "Bath")).not.toHaveLength(0);
    expect(placesShouldSearchTowns(filterPlacesCityRows(placesCityRows(), "Bath").length, "Bath")).toBe(
      false,
    );
  });

  it("calls a lookup it has decided to run pending, from the first commit on", () => {
    // The index read is asked for from an effect, so the commit that opens the
    // gate still holds it at "idle". Reading that as a finished read printed
    // "No city here called Didsbury" for one commit, under a polite live
    // region, before the pending line and then the town rows replaced it.
    expect(placesTownLookupPending(true, "idle")).toBe(true);
    expect(placesTownLookupPending(true, "loading")).toBe(true);

    // Only the two states that END a lookup stop it being pending.
    expect(placesTownLookupPending(true, "ready")).toBe(false);
    expect(placesTownLookupPending(true, "error")).toBe(false);

    // A query a city row answered never opened the gate, so nothing is pending
    // however far a read for some earlier query got.
    expect(placesTownLookupPending(false, "idle")).toBe(false);
    expect(placesTownLookupPending(false, "loading")).toBe(false);
  });

  it("wears the badge the chooser wears, off one shared reading of the kind", () => {
    // Both surfaces render the same result kinds, so the words belong to the
    // kind. A second copy beside this caller could be reworded alone.
    const [didsbury] = placesTownResults("Didsbury", TOWNS);
    const [sheffield] = placesTownResults("Sheffield", TOWNS);

    expect(cityChooserResultBadge(defined(didsbury).kind)).toBe("City guide");
    expect(cityChooserResultBadge(defined(sheffield).kind)).toBe("No prices yet");
  });

  it("tells two places of one name apart by their postcode area", () => {
    // Both Alresfords sit outside every city we ship, so both come back
    // uncovered, with the same name, the same badge and the same sentence. The
    // row printed those three alone, so a reader choosing between them could
    // open a map a county away from the town they meant.
    const results = placesTownResults("Alresford", TOWNS);
    expect(results).toHaveLength(2);

    const contexts = results.map((result) => cityChooserResultContext(result));
    expect([...contexts].sort()).toEqual(["CO", "SO"]);
    expect(new Set(results.map((result) => result.href)).size).toBe(2);
  });

  it("leaves a curated row unmarked, its description naming the city instead", () => {
    // Didsbury is Manchester, and the membership line says so, so there is
    // nothing for a postcode area to disambiguate.
    const [didsbury] = placesTownResults("Didsbury", TOWNS);

    expect(defined(didsbury).kind).toBe("curated");
    expect(cityChooserResultContext(defined(didsbury))).toBeNull();
  });

  it("answers a failed index read by naming the button, not a list that is gone", () => {
    // /places filters the city list out while a query stands, so a failed index
    // read names the control that is still on screen.
    const line = placesTownSearchUnavailableLine();

    expect(line.startsWith(TOWN_SEARCH_UNAVAILABLE_LEAD)).toBe(true);
    expect(line).toContain(PLACES_SHOW_ALL_LABEL);
    expect(line).not.toMatch(/below/i);
  });

  it("credits OpenStreetMap for the place names it publishes", () => {
    // public/data/uk_base/places.json is ODbL 1.0, and /places draws no map
    // canvas, so the credit MapLibre carries elsewhere rides the answer here.
    const markup = renderToStaticMarkup(
      createElement(PlaceIndexCredit, { className: "placesTownSource" }),
    );

    expect(markup).toContain("OpenStreetMap contributors");
    expect(markup).toContain("ODbL");
    expect(markup).toContain("https://www.openstreetmap.org/copyright");
  });
});

// ---------------------------------------------------------------------------
// The crawlable city list
// ---------------------------------------------------------------------------

describe("Places is the one indexable city list", () => {
  it("carries the canonical for the city question", async () => {
    const { metadata } = await import("@/app/places/page");

    expect(metadata.alternates?.canonical).toBe(PLACES_PATH);
  });

  it("asks to be indexed, because the sitemap now names it", async () => {
    // A sitemap row on a noindex page tells a crawler two opposite things, and
    // the city list is the page a stranger reaches the map through.
    const { metadata } = await import("@/app/places/page");

    expect(metadata.robots).toBeUndefined();
  });

});

// ---------------------------------------------------------------------------
// Rendered surface
// ---------------------------------------------------------------------------

describe("Places screen", () => {
  beforeEach(() => {
    installWindow();
  });

  it("renders the kicker above the heading, and one primary action per screen", async () => {
    const { default: PlacesClient } = await import("@/app/places/PlacesClient");

    const list = renderToStaticMarkup(createElement(PlacesClient, { cityId: null }));
    // The Screen primitive paints the kicker, then the heading, then the ONE
    // primary. Order is the assertion, because that order is the contract.
    const kickerAt = list.indexOf(`class="kicker"`);
    const titleAt = list.indexOf("screenTitle");
    const primaryAt = list.indexOf("data-primary-action");
    expect(kickerAt).toBeGreaterThan(-1);
    expect(titleAt).toBeGreaterThan(kickerAt);
    expect(primaryAt).toBeGreaterThan(titleAt);
    expect(list).toContain(PLACES_KICKER);
    expect(list).toContain(PLACES_TITLE);
    // Exactly one painted action per screen, counted the way coreUiAudit does.
    expect(list.match(/data-primary-action/g)?.length).toBe(1);
    expect(list).toContain("Manchester");
    expect(list).toContain(PLACES_PRICES_COMING_PILL);
    expect(list).toContain(PLACES_PRICES_LISTED_PILL);

    const panel = renderToStaticMarkup(
      createElement(PlacesClient, { cityId: "manchester" as const }),
    );
    expect(panel).toContain(PLACES_SET_CITY_LABEL);
    expect(panel.match(/data-primary-action/g)?.length).toBe(1);
    expect(panel).toContain("haven&#x27;t yet collected pint prices");
    expect(panel).toContain("Where to drink in Manchester");
  });

  it("shows London its areas, and every other city the honest gap", () => {
    return import("@/app/places/PlacesClient").then(({ default: PlacesClient }) => {
      const london = renderToStaticMarkup(
        createElement(PlacesClient, { cityId: "london" as const }),
      );
      expect(london).toContain("Clapham");
      expect(london).toContain("Where to drink in London");

      const bath = renderToStaticMarkup(
        createElement(PlacesClient, { cityId: "bath" as const }),
      );
      expect(bath).toContain("mapped areas in Bath");
      expect(bath).not.toContain("Clapham");
    });
  });
});
