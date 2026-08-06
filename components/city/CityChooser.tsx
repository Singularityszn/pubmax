"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useId, useMemo, useRef, useState, useTransition } from "react";
import { Beer, LocateFixed, MapPin, Search } from "lucide-react";
import PubmaxxWordmark from "@/components/brand/PubmaxxWordmark";

import {
  getCity,
  listEnabledCities,
  type CityId,
} from "@/lib/cities";
import { MAIN_LANDMARK_ID } from "@/lib/a11yLandmarks";
import { buildCityChooserSearchResults } from "@/lib/cityChooserSearch";
import { writePreferredCity } from "@/lib/cityPreference";
import { cityMapShareUrl } from "@/lib/cityShare";
import { nearestEnabledCity } from "@/lib/nearestCity";
import {
  normaliseUkPlaceQuery,
  parseUkPlaceIndex,
  UK_PLACE_INDEX_PATH,
  type UkPlace,
} from "@/lib/ukPlaceSearch";

import "./cityChooser.css";

export type CityChooserProps = {
  variant?: "page" | "section";
  onSelect?: (cityId: CityId) => void;
};

type LocateState = "idle" | "pending" | "error";
type PlaceIndexState =
  | { status: "idle" | "loading"; places: UkPlace[] }
  | { status: "ready"; places: UkPlace[] }
  | { status: "error"; places: UkPlace[] };

/**
 * Full-bleed city picker: enabled cities as map links, optional geolocation,
 * and preferred-city persistence for Map nav / landing CTAs.
 */
export default function CityChooser({
  variant = "page",
  onSelect,
}: CityChooserProps) {
  const cities = listEnabledCities();
  const listId = useId();
  const router = useRouter();
  const [locateState, setLocateState] = useState<LocateState>("idle");
  const [locateMessage, setLocateMessage] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [placeIndex, setPlaceIndex] = useState<PlaceIndexState>({
    status: "idle",
    places: [],
  });
  const placeIndexRequested = useRef(false);
  const [, startTransition] = useTransition();
  const normalizedQuery = normaliseUkPlaceQuery(query);
  const results = useMemo(
    () => buildCityChooserSearchResults(query, cities, placeIndex.places),
    [cities, placeIndex.places, query],
  );

  const selectCity = useCallback(
    (cityId: CityId) => {
      writePreferredCity(cityId);
      onSelect?.(cityId);
    },
    [onSelect],
  );

  const useMyLocation = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocateState("error");
      setLocateMessage("Location isn’t available in this browser.");
      return;
    }

    setLocateState("pending");
    setLocateMessage("Finding the nearest city…");

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const nearest = nearestEnabledCity(
          pos.coords.latitude,
          pos.coords.longitude,
        );
        if (!nearest) {
          setLocateState("error");
          setLocateMessage("You’re outside our mapped cities. Pick one below.");
          return;
        }
        const href = cityMapShareUrl(nearest);
        selectCity(nearest);
        setLocateState("idle");
        setLocateMessage(`Opening ${getCity(nearest).displayName}…`);
        startTransition(() => {
          router.push(href);
        });
      },
      () => {
        setLocateState("error");
        setLocateMessage("Couldn’t read your location. Pick a city below.");
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
    );
  }, [router, selectCity, startTransition]);

  const loadPlaceIndex = useCallback(() => {
    if (placeIndexRequested.current) return;
    placeIndexRequested.current = true;
    setPlaceIndex({ status: "loading", places: [] });
    void fetch(UK_PLACE_INDEX_PATH)
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const raw: unknown = await response.json();
        setPlaceIndex({ status: "ready", places: parseUkPlaceIndex(raw) });
      })
      .catch(() => {
        placeIndexRequested.current = false;
        setPlaceIndex({ status: "error", places: [] });
      });
  }, []);

  const changeQuery = useCallback(
    (value: string) => {
      setQuery(value);
      if (normaliseUkPlaceQuery(value).length >= 2) loadPlaceIndex();
    },
    [loadPlaceIndex],
  );

  const rootClass =
    variant === "section"
      ? "cityChooser cityChooser--section"
      : "cityChooser cityChooser--page";

  const Root = variant === "page" ? "main" : "section";

  return (
    <Root
      id={variant === "page" ? MAIN_LANDMARK_ID : undefined}
      className={rootClass}
      aria-labelledby={listId + "-title"}
    >
      <div className="cityChooserInner">
        <header className="cityChooserHead">
          {variant === "page" ? (
            <Link href="/" className="cityChooserBrand" aria-label="PUBMAXXING home">
              <span className="cityChooserBrandMark" aria-hidden="true">
                <Beer size={18} strokeWidth={1.5} />
              </span>
              <PubmaxxWordmark className="cityChooserBrandText" />
            </Link>
          ) : (
            <p className="cityChooserEyebrow">Cities</p>
          )}
          {variant === "page" ? (
            <h1
              id={listId + "-title"}
              className="cityChooserTitle cityChooserSerif"
            >
              Choose your city
            </h1>
          ) : (
            <h2
              id={listId + "-title"}
              className="cityChooserTitle cityChooserSerif"
            >
              Choose your city
            </h2>
          )}
          <p className="cityChooserLede">
            Open a price-aware pub map. Crawls and drink-shaped pins for the
            night you want.
          </p>
        </header>

        <div className="cityChooserSearch">
          <label htmlFor={`${listId}-search`} className="cityChooserSearchLabel">
            Find your town
          </label>
          <div className="cityChooserSearchField">
            <Search size={18} strokeWidth={1.75} aria-hidden="true" />
            <input
              id={`${listId}-search`}
              className="cityChooserSearchInput"
              type="search"
              value={query}
              onChange={(event) => changeQuery(event.target.value)}
              placeholder="Try Sheffield or your town"
              autoComplete="off"
              spellCheck="false"
              aria-controls={`${listId}-search-results`}
              aria-describedby={`${listId}-search-help`}
            />
          </div>
          <p id={`${listId}-search-help`} className="cityChooserSearchHelp">
            The nine city guides have prices and crawls. Other UK places open
            the pub map without prices.
          </p>
        </div>

        <div className="cityChooserToolbar">
          <button
            type="button"
            className="cityChooserLocate"
            onClick={useMyLocation}
            disabled={locateState === "pending"}
            aria-describedby={locateMessage ? `${listId}-locate-status` : undefined}
          >
            <LocateFixed size={16} strokeWidth={1.75} aria-hidden="true" />
            {locateState === "pending" ? "Locating…" : "Use my location"}
          </button>
          {locateMessage ? (
            <p
              id={`${listId}-locate-status`}
              className="cityChooserLocateStatus"
              data-tone={locateState === "error" ? "error" : "info"}
              role="status"
              aria-live="polite"
            >
              {locateMessage}
            </p>
          ) : null}
        </div>

        {normalizedQuery.length >= 2 ? (
          <section
            id={`${listId}-search-results`}
            className="cityChooserSearchPanel"
            aria-label="Place search results"
            aria-live="polite"
          >
            <p className="cityChooserResultsLabel">Matches</p>
            {results.length > 0 ? (
              <ul className="cityChooserResults">
                {results.map((result) => (
                  <li
                    key={`${result.kind}-${result.name}-${result.href}`}
                    className="cityChooserResult"
                  >
                    <Link
                      href={result.href}
                      className="cityChooserResultLink"
                      onClick={
                        result.kind === "curated"
                          ? () => selectCity(result.cityId)
                          : undefined
                      }
                    >
                      <MapPin size={18} strokeWidth={1.65} aria-hidden="true" />
                      <span className="cityChooserResultCopy">
                        <span className="cityChooserResultTopline">
                          <strong className="cityChooserResultName">
                            {result.name}
                          </strong>
                          {result.kind === "uncovered" && result.context ? (
                            <span className="cityChooserResultContext">
                              {result.context}
                            </span>
                          ) : null}
                          <span
                            className="cityChooserResultBadge"
                            data-kind={result.kind}
                          >
                            {result.kind === "curated"
                              ? "City guide"
                              : "No prices yet"}
                          </span>
                        </span>
                        <span className="cityChooserResultDescription">
                          {result.description}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : placeIndex.status === "loading" ? (
              <p className="cityChooserSearchStatus" role="status">
                Looking across the UK pub map…
              </p>
            ) : placeIndex.status === "error" ? (
              <p className="cityChooserSearchStatus" role="status">
                Town search isn’t available right now. The nine city maps are
                below.
              </p>
            ) : (
              <p className="cityChooserSearchStatus">
                Can’t find that name yet. Try a nearby town.
              </p>
            )}
            {placeIndex.status === "ready" ? (
              <p className="cityChooserSearchSource">
                Place names from{" "}
                <a
                  href="https://www.openstreetmap.org/copyright"
                  target="_blank"
                  rel="noreferrer"
                >
                  OpenStreetMap contributors
                </a>
                , ODbL.
              </p>
            ) : null}
          </section>
        ) : null}

        <nav aria-label="City maps">
          <ul id={listId} className="cityChooserList">
            {cities.map((city, i) => {
              const href = cityMapShareUrl(city.id);
              return (
                <li
                  key={city.id}
                  className="cityChooserItem"
                  style={{ ["--cc-i" as string]: i }}
                >
                  <Link
                    href={href}
                    className="cityChooserLink"
                    onClick={() => selectCity(city.id)}
                    aria-label={`${city.displayName}: ${city.tagline}. Open map.`}
                  >
                    <span className="cityChooserName">{city.displayName}</span>
                    <p className="cityChooserTagline">{city.tagline}</p>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </Root>
  );
}
