"use client";

import Link from "next/link";
import { ArrowLeft, MapPin, Search } from "lucide-react";
import { useCallback, useId, useMemo, useState, useSyncExternalStore } from "react";

import SiteNav from "@/components/nav/SiteNav";
import EmptyState from "@/components/ui/empty-state";
import Kicker from "@/components/ui/kicker";
import Screen from "@/components/ui/screen";
import type { CityId } from "@/lib/cities";
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
} from "@/lib/places";

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

function CityList({ preferredCity }: { preferredCity: CityId | null }) {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const rows = useMemo(() => placesCityRows(), []);
  const shown = useMemo(() => filterPlacesCityRows(rows, query), [rows, query]);

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

      {shown.length === 0 ? (
        <EmptyState title={placesSearchEmptyLine(query)}>
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
    () => placesCityRows().find((candidate) => candidate.cityId === cityId) ?? null,
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
            <button type="button" onClick={setCity} data-testid="places-set-city">
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
            <span className="placesConfirmLabel">{PLACES_CURRENT_CITY_LABEL}</span>{" "}
            {placesCurrentCityLine(cityId)}
          </p>
        ) : null}

        <section className="placesSection" aria-labelledby="places-prices-title">
          <Kicker tone="muted">Prices</Kicker>
          <h2 id="places-prices-title" className="placesSectionTitle">
            {row.pricesListed ? "Listed pint prices" : "No pint prices here yet"}
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
