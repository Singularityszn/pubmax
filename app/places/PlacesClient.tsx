"use client";

import Link from "next/link";
import { ArrowLeft, MapPin, Search } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import SiteNav from "@/components/nav/SiteNav";
import EmptyState from "@/components/ui/empty-state";
import Kicker from "@/components/ui/kicker";
import Screen from "@/components/ui/screen";
import type { CityId } from "@/lib/cities";
import {
  cityGuidesSearchUnavailableLine,
  type CityChooserSearchResult,
} from "@/lib/cityChooserSearch";
import {
  mapHrefForCity,
  readPreferredCity,
  subscribePreferredCity,
  writePreferredCity,
} from "@/lib/cityPreference";
import {
  PLACES_AREAS_COMING_PILL,
  PLACES_AREAS_KICKER,
  PLACES_BACK_LABEL,
  PLACES_CURRENT_CITY_LABEL,
  PLACES_KICKER,
  PLACES_LEDE,
  PLACES_LIST_PRIMARY_LABEL,
  PLACES_LIST_SECONDARY_HREF,
  PLACES_LIST_SECONDARY_LABEL,
  PLACES_PATH,
  PLACES_SEARCH_LABEL,
  PLACES_SEARCH_PLACEHOLDER,
  PLACES_SET_CITY_LABEL,
  PLACES_TITLE,
  PLACES_TOWN_SEARCH_PENDING,
  filterPlacesCityRows,
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
  placesTownResults,
} from "@/lib/places";
import {
  UK_PLACE_INDEX_PATH,
  parseUkPlaceIndex,
  type UkPlace,
} from "@/lib/ukPlaceSearch";

import "./places.css";

/**
 * The Places tab: pick a city, see what is inside it, and set the one city the
 * map, Out and Near all open on.
 *
 * Two views in one route, keyed off `?city=`, so Back is the browser's own and a
 * chosen city is a link somebody can send. Each view is ONE `Screen`, which is
 * what holds it to one painted action: the list screen's is the flagship city,
 * and the city screen's is setting that city, or, once it is already yours, the
 * map it opens.
 *
 * The stored city is a browser value, so the whole surface is a client component
 * and the answer is effectively TRI-STATE: the server renders nobody's city as
 * chosen and the live value arrives after mount, which is why the panel never
 * claims "This is your city" off a server pass.
 */
export default function PlacesClient({ cityId }: { cityId: CityId | null }) {
  const preferredCity = useSyncExternalStore(
    subscribePreferredCity,
    readPreferredCity,
    () => null,
  );

  return (
    <div className="placesPage">
      <SiteNav active="places" />
      <main id="main" className="placesBody">
        {cityId ? (
          <CityPanel cityId={cityId} preferredCity={preferredCity} />
        ) : (
          <CityList preferredCity={preferredCity} />
        )}
      </main>
    </div>
  );
}

type TownIndexState = {
  status: "idle" | "loading" | "ready" | "error";
  places: UkPlace[];
};

/**
 * The UK place index, read once, and only when a city search found nothing.
 *
 * The index is the map's own base layer (two megabytes of place names), so the
 * picker never asks for it to paint its list: a reader who typed a city is
 * already answered. It is fetched the first time a query falls through, and
 * the promise is held so a second fall-through reuses it.
 */
function useTownIndex(active: boolean): TownIndexState {
  const [state, setState] = useState<TownIndexState>({
    status: "idle",
    places: [],
  });
  const pending = useRef<Promise<void> | null>(null);

  useEffect(() => {
    if (!active || pending.current) return;
    setState({ status: "loading", places: [] });
    pending.current = fetch(UK_PLACE_INDEX_PATH)
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        setState({
          status: "ready",
          places: parseUkPlaceIndex(await response.json()),
        });
      })
      .catch(() => {
        pending.current = null;
        setState({ status: "error", places: [] });
      });
  }, [active]);

  return state;
}

function CityList({ preferredCity }: { preferredCity: CityId | null }) {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const rows = useMemo(() => placesCityRows(), []);
  const shown = useMemo(() => filterPlacesCityRows(rows, query), [rows, query]);
  // A query no city row answers is not automatically a query with no answer:
  // the retired /choose-city address read the UK place index and offered the
  // base map where that town is, and that capability rides on here.
  const searchTowns = placesShouldSearchTowns(shown.length, query);
  const townIndex = useTownIndex(searchTowns);
  const towns = useMemo(
    () =>
      searchTowns && townIndex.status === "ready"
        ? placesTownResults(query, townIndex.places)
        : ([] as CityChooserSearchResult[]),
    [searchTowns, townIndex, query],
  );

  return (
    <Screen
      as="div"
      kicker={PLACES_KICKER}
      title={PLACES_TITLE}
      lede={PLACES_LEDE}
      primary={
        <Link prefetch={false} href={placesCityHref("london")}>
          {PLACES_LIST_PRIMARY_LABEL}
        </Link>
      }
      secondary={
        <Link prefetch={false} href={PLACES_LIST_SECONDARY_HREF}>
          {PLACES_LIST_SECONDARY_LABEL}
        </Link>
      }
    >
      <div className="placesSearch">
        <label className="placesSearchLabel" htmlFor={searchId}>
          {PLACES_SEARCH_LABEL}
        </label>
        <div className="placesSearchField">
          <Search size={18} strokeWidth={1.75} aria-hidden="true" />
          <input
            id={searchId}
            className="placesSearchInput"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={PLACES_SEARCH_PLACEHOLDER}
            autoComplete="off"
            spellCheck="false"
          />
        </div>
      </div>

      {shown.length === 0 && towns.length > 0 ? (
        <ul className="placesTownList" aria-label="Places">
          {towns.map((town) => (
            <li
              key={`${town.kind}-${town.name}-${town.href}`}
              className="placesCityItem"
            >
              <Link
                prefetch={false}
                href={town.href}
                className="placesCityLink"
              >
                <span className="placesCityMark" aria-hidden="true">
                  <MapPin size={18} strokeWidth={1.65} />
                </span>
                <span className="placesCityCopy">
                  <span className="placesCityNameRow">
                    <span className="placesCityName">{town.name}</span>
                    <span className="placesPill">
                      {town.kind === "curated" ? "City guide" : "No prices yet"}
                    </span>
                  </span>
                  <span className="placesCityTagline">{town.description}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : shown.length === 0 ? (
        <EmptyState
          title={
            searchTowns && townIndex.status === "loading"
              ? PLACES_TOWN_SEARCH_PENDING
              : searchTowns && townIndex.status === "error"
                ? cityGuidesSearchUnavailableLine(rows.length)
                : placesSearchEmptyLine(query)
          }
        >
          <button type="button" onClick={() => setQuery("")}>
            Show every city
          </button>
        </EmptyState>
      ) : (
        <ul className="placesCityList" aria-label="Cities">
          {shown.map((row) => (
            <li key={row.cityId} className="placesCityItem">
              <Link
                prefetch={false}
                href={placesCityHref(row.cityId)}
                className="placesCityLink"
              >
                <span className="placesCityMark" aria-hidden="true">
                  <MapPin size={18} strokeWidth={1.65} />
                </span>
                <span className="placesCityCopy">
                  <span className="placesCityNameRow">
                    <span className="placesCityName">{row.name}</span>
                    {row.cityId === preferredCity ? (
                      <span className="placesPill" data-tone="yours">
                        Your city
                      </span>
                    ) : null}
                    <span className="placesPill">{placesPricesPill(row)}</span>
                  </span>
                  <span className="placesCityTagline">{row.tagline}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Screen>
  );
}

function CityPanel({
  cityId,
  preferredCity,
}: {
  cityId: CityId;
  preferredCity: CityId | null;
}) {
  const row = useMemo(
    () =>
      placesCityRows().find((candidate) => candidate.cityId === cityId) ?? null,
    [cityId],
  );
  const areas = useMemo(() => placesAreasForCity(cityId), [cityId]);
  const isYours = preferredCity === cityId;
  const mapHref = mapHrefForCity(cityId);
  const actions = useMemo(
    () => placesCityActions(mapHref, isYours),
    [mapHref, isYours],
  );

  const setCity = useCallback(() => {
    writePreferredCity(cityId);
  }, [cityId]);

  if (!row) return null;

  return (
    <>
      <p className="placesBack">
        <Link prefetch={false} href={PLACES_PATH} className="placesBackLink">
          <ArrowLeft size={16} strokeWidth={1.9} aria-hidden="true" />
          {PLACES_BACK_LABEL}
        </Link>
      </p>

      <Screen
        as="div"
        kicker={PLACES_KICKER}
        title={row.name}
        lede={row.tagline}
        primary={
          actions.primary ? (
            <Link prefetch={false} href={actions.primary.href}>
              {actions.primary.label}
            </Link>
          ) : (
            <button
              type="button"
              onClick={setCity}
              data-testid="places-set-city"
            >
              {PLACES_SET_CITY_LABEL}
            </button>
          )
        }
        secondary={
          <Link prefetch={false} href={actions.secondary.href}>
            {actions.secondary.label}
          </Link>
        }
      >
        {isYours ? (
          <p className="placesConfirm" role="status">
            <span className="placesConfirmLabel">
              {PLACES_CURRENT_CITY_LABEL}
            </span>{" "}
            {placesCurrentCityLine(cityId)}
          </p>
        ) : null}

        <section
          className="placesSection"
          aria-labelledby="places-prices-title"
        >
          <Kicker tone="muted">Prices</Kicker>
          <h2 id="places-prices-title" className="placesSectionTitle">
            {row.pricesListed
              ? "Listed pint prices"
              : "No pint prices here yet"}
          </h2>
          <p className="placesSectionLine">{placesPricesLine(cityId)}</p>
        </section>

        <section className="placesSection" aria-labelledby="places-areas-title">
          <Kicker tone="muted">{PLACES_AREAS_KICKER}</Kicker>
          <div className="placesSectionHead">
            <h2 id="places-areas-title" className="placesSectionTitle">
              {placesAreasTitle(cityId)}
            </h2>
            {areas.length === 0 ? (
              <span className="placesPill">{PLACES_AREAS_COMING_PILL}</span>
            ) : null}
          </div>
          {areas.length === 0 ? (
            <p className="placesSectionLine">{placesAreasEmptyLine(cityId)}</p>
          ) : (
            <ul className="placesAreaList">
              {areas.map((area) => (
                <li key={area.slug} className="placesAreaItem">
                  <p className="placesAreaName">{area.name}</p>
                  <p className="placesAreaLine">{area.description}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </Screen>
    </>
  );
}
