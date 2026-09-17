"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useId,
  useMemo,
  useState,
  useTransition,
} from "react";
import { LocateFixed, MapPin, Search } from "lucide-react";

import { listEnabledCities, type CityId } from "@/lib/cities";
import { getCityCapabilityProfile } from "@/lib/cityCapabilities";
import {
  buildCityChooserSearchResults,
  cityChooserResultBadge,
  cityChooserResultContext,
  cityGuidesCoverageLine,
  cityGuidesSearchUnavailableLine,
  PLACE_INDEX_PENDING_LINE,
} from "@/lib/cityChooserSearch";
import { writePreferredCity } from "@/lib/cityPreference";
import { cityMapShareUrl } from "@/lib/cityShare";
import { resolveLocateMapDestination } from "@/lib/locateMapDestination";
import {
  UK_NATIONAL_ENTRY_LABEL,
  UK_NATIONAL_MAP_HREF,
} from "@/lib/ukNationalBrowse";
import { normaliseUkPlaceQuery } from "@/lib/ukPlaceSearch";
import { useUkPlaceIndex } from "@/lib/useUkPlaceIndex";

import PlaceIndexCredit from "./PlaceIndexCredit";

import styles from "./cityChooser.module.css";

export type CityChooserProps = {
  onSelect?: (cityId: CityId) => void;
};

type LocateState = "idle" | "pending" | "error";

/**
 * City picker: enabled cities as map links, optional geolocation, and
 * preferred-city persistence for Map nav / landing CTAs.
 */
export default function CityChooser({ onSelect }: CityChooserProps) {
  const cities = listEnabledCities();
  const listId = useId();
  const router = useRouter();
  const [locateState, setLocateState] = useState<LocateState>("idle");
  const [locateMessage, setLocateMessage] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const {
    status: placeIndexStatus,
    places: placeIndexPlaces,
    load: loadPlaceIndex,
  } = useUkPlaceIndex();
  const [, startTransition] = useTransition();
  const normalizedQuery = normaliseUkPlaceQuery(query);
  const results = useMemo(
    () => buildCityChooserSearchResults(query, cities, placeIndexPlaces),
    [cities, placeIndexPlaces, query],
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
    setLocateMessage("Finding the nearest place…");

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const cityFirst = resolveLocateMapDestination(lat, lng);
        if (cityFirst.kind === "city") {
          selectCity(cityFirst.cityId);
          setLocateState("idle");
          setLocateMessage(`Opening ${cityFirst.label}…`);
          startTransition(() => {
            router.push(cityFirst.href);
          });
          return;
        }
        void loadPlaceIndex().then((places) => {
          const dest = resolveLocateMapDestination(lat, lng, places);
          if (dest.kind === "city") {
            selectCity(dest.cityId);
            setLocateState("idle");
            setLocateMessage(`Opening ${dest.label}…`);
            startTransition(() => {
              router.push(dest.href);
            });
            return;
          }
          if (dest.kind === "place") {
            setLocateState("idle");
            setLocateMessage(`Opening ${dest.arrival.name}…`);
            startTransition(() => {
              router.push(dest.href);
            });
            return;
          }
          setLocateState("error");
          setLocateMessage(
            "You’re outside the priced city maps. Search a town above, or pick a city below.",
          );
        });
      },
      () => {
        setLocateState("error");
        setLocateMessage("Couldn’t read your location. Pick a city below.");
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
    );
  }, [loadPlaceIndex, router, selectCity, startTransition]);

  const changeQuery = useCallback(
    (value: string) => {
      setQuery(value);
      if (normaliseUkPlaceQuery(value).length >= 2) void loadPlaceIndex();
    },
    [loadPlaceIndex],
  );

  return (
    <section
      className={`${styles.cityChooser} ${styles.cityChooserSection}`}
      aria-labelledby={listId + "-title"}
    >
      <div className={styles.cityChooserInner}>
        <header className={styles.cityChooserHead}>
          <p className={styles.cityChooserEyebrow}>Cities</p>
          <h2
            id={listId + "-title"}
            className={`${styles.cityChooserTitle} ${styles.cityChooserSerif}`}
          >
            Choose your city
          </h2>
          <p className={styles.cityChooserLede}>
            Open a price-aware pub map. Crawls and drink-shaped pins for the
            night you want.
          </p>
        </header>

        <div className={styles.cityChooserSearch}>
          <label
            htmlFor={`${listId}-search`}
            className={styles.cityChooserSearchLabel}
          >
            Find your town
          </label>
          <div className={styles.cityChooserSearchField}>
            <Search size={18} strokeWidth={1.75} aria-hidden="true" />
            <input
              id={`${listId}-search`}
              className={styles.cityChooserSearchInput}
              type="search"
              value={query}
              onChange={(event) => changeQuery(event.target.value)}
              placeholder="Search for a town or city"
              autoComplete="off"
              spellCheck="false"
              aria-controls={
                normalizedQuery.length >= 2
                  ? `${listId}-search-results`
                  : undefined
              }
              aria-describedby={`${listId}-search-help`}
            />
          </div>
          <p id={`${listId}-search-help`} className={styles.cityChooserSearchHelp}>
            {cityGuidesCoverageLine(cities)}
          </p>
        </div>

        <div className={styles.cityChooserToolbar}>
          <button
            type="button"
            className={styles.cityChooserLocate}
            onClick={useMyLocation}
            disabled={locateState === "pending"}
            aria-describedby={
              locateMessage ? `${listId}-locate-status` : undefined
            }
          >
            <LocateFixed size={16} strokeWidth={1.75} aria-hidden="true" />
            {locateState === "pending" ? "Locating…" : "Use my location"}
          </button>
          {locateMessage ? (
            <p
              id={`${listId}-locate-status`}
              className={styles.cityChooserLocateStatus}
              data-tone={locateState === "error" ? "error" : "info"}
              role="status"
              aria-live="polite"
            >
              {locateMessage}
            </p>
          ) : null}
        </div>

        <p className={styles.cityChooserNational}>
          <Link href={UK_NATIONAL_MAP_HREF} className={styles.cityChooserNationalLink}>
            {UK_NATIONAL_ENTRY_LABEL}
          </Link>
        </p>

        {normalizedQuery.length >= 2 ? (
          <section
            id={`${listId}-search-results`}
            className={styles.cityChooserSearchPanel}
            aria-label="Place search results"
            aria-live="polite"
          >
            <p className={styles.cityChooserResultsLabel}>Matches</p>
            {results.length > 0 ? (
              <ul className={styles.cityChooserResults}>
                {results.map((result) => (
                  <li
                    key={`${result.kind}-${result.name}-${result.href}`}
                    className={styles.cityChooserResult}
                  >
                    <Link
                      href={result.href}
                      className={styles.cityChooserResultLink}
                      onClick={
                        result.kind === "curated"
                          ? () => selectCity(result.cityId)
                          : undefined
                      }
                    >
                      <MapPin size={18} strokeWidth={1.65} aria-hidden="true" />
                      <span className={styles.cityChooserResultCopy}>
                        <span className={styles.cityChooserResultTopline}>
                          <strong className={styles.cityChooserResultName}>
                            {result.name}
                          </strong>
                          {cityChooserResultContext(result) ? (
                            <span className={styles.cityChooserResultContext}>
                              {cityChooserResultContext(result)}
                            </span>
                          ) : null}
                          <span
                            className={styles.cityChooserResultBadge}
                            data-kind={result.kind}
                          >
                            {cityChooserResultBadge(result.kind)}
                          </span>
                        </span>
                        <span className={styles.cityChooserResultDescription}>
                          {result.description}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : placeIndexStatus === "loading" ? (
              <p className={styles.cityChooserSearchStatus} role="status">
                {PLACE_INDEX_PENDING_LINE}
              </p>
            ) : placeIndexStatus === "error" ? (
              <p className={styles.cityChooserSearchStatus} role="status">
                {cityGuidesSearchUnavailableLine(cities.length)}
              </p>
            ) : (
              <p className={styles.cityChooserSearchStatus}>
                Can’t find that name yet. Try a nearby town.
              </p>
            )}
            {placeIndexStatus === "ready" ? (
              <PlaceIndexCredit className={styles.cityChooserSearchSource} />
            ) : null}
          </section>
        ) : null}

        <nav aria-label="City maps">
          <ul id={listId} className={styles.cityChooserList}>
            {cities.map((city, i) => {
              const href = cityMapShareUrl(city.id);
              const profile = getCityCapabilityProfile(city.id);
              const isPreview = profile.releaseTier === "preview";
              return (
                <li
                  key={city.id}
                  className={styles.cityChooserItem}
                  style={{ ["--cc-i" as string]: i }}
                >
                  <Link
                    href={href}
                    className={styles.cityChooserLink}
                    onClick={() => selectCity(city.id)}
                    aria-label={`${city.displayName}${isPreview ? ", Preview" : ""}: ${city.tagline}. Open map.`}
                  >
                    <span className={styles.cityChooserNameRow}>
                      <span className={styles.cityChooserName}>
                        {city.displayName}
                      </span>
                      {isPreview ? (
                        <span className={styles.cityChooserReleaseBadge}>Preview</span>
                      ) : null}
                    </span>
                    <p className={styles.cityChooserTagline}>{city.tagline}</p>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </section>
  );
}
