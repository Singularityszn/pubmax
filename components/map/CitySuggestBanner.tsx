"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

import {
  getCity,
  type CityId,
} from "@/lib/cities";
import { writePreferredCity } from "@/lib/cityPreference";
import { cityMapShareUrl } from "@/lib/cityShare";
import { nearestEnabledCity } from "@/lib/nearestCity";

import "./citySuggestBanner.css";

type CitySuggestBannerProps = {
  cityId: CityId;
};

/**
 * Lightweight geolocation nudge: once per city view, if the viewer appears to
 * be in a different enabled city than the open map, offer a one-tap switch.
 * Fail-soft (permission denied / timeout / no geo) → no banner; never blocks
 * map load. Kept below the CitySwitcher dropdown in z-order so city picks stay
 * tappable.
 */
export default function CitySuggestBanner({ cityId }: CitySuggestBannerProps) {
  const [suggested, setSuggested] = useState<CityId | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const askedForCity = useRef<CityId | null>(null);

  useEffect(() => {
    if (askedForCity.current === cityId) return;
    askedForCity.current = cityId;
    if (typeof navigator === "undefined" || !navigator.geolocation) return;

    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (cancelled) return;
        const nearest = nearestEnabledCity(
          pos.coords.latitude,
          pos.coords.longitude,
        );
        if (nearest && nearest !== cityId) {
          // Defer setState out of the geolocation callback body.
          void Promise.resolve().then(() => {
            if (!cancelled) {
              setDismissed(false);
              setSuggested(nearest);
            }
          });
        }
      },
      () => {
        // Permission denied / timeout / unavailable — no banner.
      },
      { enableHighAccuracy: false, timeout: 5000, maximumAge: 60_000 },
    );

    return () => {
      cancelled = true;
    };
  }, [cityId]);

  // Hide stale suggestions for the city we're already viewing (no setState).
  if (dismissed || !suggested || suggested === cityId) return null;

  const city = getCity(suggested);
  const href = cityMapShareUrl(suggested);

  return (
    <div className="citySuggestBanner" role="status" aria-live="polite">
      <p className="citySuggestBannerCopy">
        Looks like you&apos;re in {city.displayName}. Switch map?
      </p>
      <Link
        href={href}
        className="citySuggestBannerSwitch"
        onClick={() => writePreferredCity(suggested)}
      >
        Switch
      </Link>
      <button
        type="button"
        className="citySuggestBannerDismiss"
        aria-label="Dismiss city suggestion"
        onClick={() => setDismissed(true)}
      >
        <X size={14} strokeWidth={2.25} aria-hidden="true" />
      </button>
    </div>
  );
}
