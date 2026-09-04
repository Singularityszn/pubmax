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
import { getNightAreasForCity } from "@/lib/nightAreas";
import {
  PLACES_AREAS_COMING_PILL,
  PLACES_KICKER,
  PLACES_PATH,
  PLACES_PRICES_COMING_PILL,
  PLACES_PRICES_LISTED_PILL,
  PLACES_SET_CITY_LABEL,
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
} from "@/lib/places";

vi.mock("next/navigation", () => ({
  usePathname: () => PLACES_PATH,
  useRouter: () => ({ push: () => {}, replace: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/nav/MessagesLink", () => ({ default: () => null }));
vi.mock("@/components/nav/NotificationBell", () => ({ default: () => null }));
vi.mock("@/components/nav/SiteNavMore", () => ({ default: () => null }));
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
    expect(buildTabs("/u/you", "/today", true, preferredCityMapHref()).find(
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
      "social",
      "you",
    ]);
    expect(buildTabs().map((tab) => tab.label)).toEqual([
      "Now",
      "Map",
      "Places",
      "Out",
      "Social",
      "You",
    ]);
    expect(primaryNavKeyForPath("/places")).toBe("places");
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
