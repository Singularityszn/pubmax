"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useId, useState, useTransition } from "react";
import { Beer, LocateFixed } from "lucide-react";
import PubmaxxWordmark from "@/components/brand/PubmaxxWordmark";

import {
  getCity,
  listEnabledCities,
  type CityId,
} from "@/lib/cities";
import { writePreferredCity } from "@/lib/cityPreference";
import { cityMapShareUrl } from "@/lib/cityShare";
import { nearestEnabledCity } from "@/lib/nearestCity";

import "./cityChooser.css";

export type CityChooserProps = {
  variant?: "page" | "section";
  onSelect?: (cityId: CityId) => void;
};

type LocateState = "idle" | "pending" | "error";

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
  const [, startTransition] = useTransition();

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

  const rootClass =
    variant === "section"
      ? "cityChooser cityChooser--section"
      : "cityChooser cityChooser--page";

  return (
    <section
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
    </section>
  );
}
