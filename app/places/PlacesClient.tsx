"use client";

import Link from "next/link";
import { ArrowLeft, MapPin, Search } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

import PlaceIndexCredit from "@/components/city/PlaceIndexCredit";
import SiteNav from "@/components/nav/SiteNav";
import EmptyState from "@/components/ui/empty-state";
import Kicker from "@/components/ui/kicker";
import Screen from "@/components/ui/screen";
import type { CityId } from "@/lib/cities";
import {
  cityChooserResultBadge,
  cityChooserResultContext,
  PLACE_INDEX_PENDING_LINE,
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
  PLACES_SHOW_ALL_LABEL,
  PLACES_TITLE,
  PLACES_UK_LINE,
  PLACES_UK_TITLE,
  PLACES_WAITLIST_HREF,
  PLACES_WAITLIST_LABEL,
  placesAreasEmptyLine,
  placesAreasForCity,
  placesAreasTitle,
  placesCityHref,
  placesCityRows,
  placesCityActions,
  placesCurrentCityLine,
  placesPricesLine,
  placesSearchEmptyLine,
  placesShouldSearchTowns,
  placesTownLookupPending,
  placesTownResults,
  placesTownSearchUnavailableLine,
} from "@/lib/places";
import { useUkPlaceIndex } from "@/lib/useUkPlaceIndex";
import { mapAreaHref } from "@/lib/mapAreaArrival";

import "@/components/listing/listing.css";
import "./places.css";

/**
 * The city picker: pick a city, see what is inside it, and set the one city the
 * map and Near open on. It is not a tab (Oct 2026 UX audit): the map's city
 * chip and the footer's "Pick your city" reach it.
 *
 * ONE CITY SAYS SO (taste plan, 18 Oct 2026). With London the only city that
 * has listed prices, a city search field over a one-row city list read as a
 * multi-city product that was not there. The list view now says plainly
 * "London only, for now", paints one door (Open London) and offers the city
 * request beside it. What the old field did that was real stays, under its own
 * heading: a town lookup that opens the UK map, where pubs show without
 * prices. Every other city still answers by `?city=` and on its own map.
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
      <main id="main" className="placesBody listingShell">
        {cityId ? (
          <CityPanel cityId={cityId} preferredCity={preferredCity} />
        ) : (
          <CityList preferredCity={preferredCity} />
        )}
      </main>
    </div>
  );
}

function CityList({ preferredCity }: { preferredCity: CityId | null }) {
  const searchId = useId();
  const [query, setQuery] = useState("");
  // The field looks up towns, not cities: there is one city, and it is the
  // door above. A town opens the UK map where that town is.
  const searchTowns = placesShouldSearchTowns(0, query);
  const {
    status: indexStatus,
    places: indexPlaces,
    load: loadPlaceIndex,
  } = useUkPlaceIndex();

  const townLookupPending = placesTownLookupPending(searchTowns, indexStatus);

  useEffect(() => {
    if (searchTowns) void loadPlaceIndex();
  }, [searchTowns, query, loadPlaceIndex]);

  const towns = useMemo(
    () =>
      searchTowns && indexStatus === "ready"
        ? placesTownResults(query, indexPlaces)
        : ([] as CityChooserSearchResult[]),
    [searchTowns, indexStatus, indexPlaces, query],
  );
  const showTowns = towns.length > 0;

  return (
    <Screen
      as="div"
      kicker={PLACES_KICKER}
      title={PLACES_TITLE}
      lede={
        preferredCity === "london"
          ? `${PLACES_LEDE} The map and Near already open there.`
          : PLACES_LEDE
      }
      primary={
        <Link prefetch={false} href={placesCityHref("london")}>
          {PLACES_LIST_PRIMARY_LABEL}
        </Link>
      }
      secondary={
        <a href={PLACES_WAITLIST_HREF} data-testid="places-waitlist">
          {PLACES_WAITLIST_LABEL}
        </a>
      }
    >
      <section className="placesSection placesUk" aria-labelledby="places-uk-title">
        <h2 id="places-uk-title" className="placesSectionTitle">
          {PLACES_UK_TITLE}
        </h2>
        <p className="placesSectionLine">
          {PLACES_UK_LINE}{" "}
          <Link prefetch={false} href={PLACES_LIST_SECONDARY_HREF} className="placesUkLink">
            {PLACES_LIST_SECONDARY_LABEL}
          </Link>
        </p>

        <div className="placesSearch">
          <label className="placesSearchLabel" htmlFor={searchId}>
            {PLACES_SEARCH_LABEL}
          </label>
          <div className="placesSearchField">
            <Search size={16} aria-hidden="true" />
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

        {/* The town answer and the empty state swap under one another a
            keystroke at a time, so the region that holds them is always
            mounted and polite: a live region that arrives WITH its content is
            announced by only some screen readers. */}
        <div className="placesResults" aria-live="polite">
          {showTowns ? (
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
                      <MapPin size={20} />
                    </span>
                    <span className="placesCityCopy">
                      <span className="placesCityNameRow">
                        <span className="placesCityName">{town.name}</span>
                        {cityChooserResultContext(town) ? (
                          <span className="placesCityContext">
                            {cityChooserResultContext(town)}
                          </span>
                        ) : null}
                        <span className="placesPill">
                          {cityChooserResultBadge(town.kind)}
                        </span>
                      </span>
                      <span className="placesCityTagline">{town.description}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : searchTowns && (townLookupPending || indexStatus === "error" || indexStatus === "ready") ? (
            <EmptyState
              title={
                townLookupPending
                  ? PLACE_INDEX_PENDING_LINE
                  : indexStatus === "error"
                    ? placesTownSearchUnavailableLine()
                    : placesSearchEmptyLine(query)
              }
            >
              <button type="button" onClick={() => setQuery("")}>
                {PLACES_SHOW_ALL_LABEL}
              </button>
            </EmptyState>
          ) : null}
        </div>

        {/* These rows are OpenStreetMap's place names, and this surface draws
            no map canvas to carry the credit MapLibre would. It sits outside
            the live region: it is provenance for the list, not a result to
            announce. */}
        {showTowns ? (
          <PlaceIndexCredit className="placesTownSource" />
        ) : null}
      </section>
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
      <p className="placesBack listingSection">
        <Link prefetch={false} href={PLACES_PATH} className="placesBackLink">
          <ArrowLeft size={16} aria-hidden="true" />
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
          <Kicker>Prices</Kicker>
          <h2 id="places-prices-title" className="placesSectionTitle">
            {row.pricesListed
              ? "Listed pint prices"
              : "No pint prices here yet"}
          </h2>
          <p className="placesSectionLine">{placesPricesLine(cityId)}</p>
        </section>

        <section className="placesSection" aria-labelledby="places-areas-title">
          <Kicker>{PLACES_AREAS_KICKER}</Kicker>
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
                  <a className="placesAreaName" href={mapAreaHref(area)}>{area.name}</a>
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
