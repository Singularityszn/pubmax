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
 * Lightweight geolocation nudge: once on mount, if the viewer appears to be in
 * a different enabled city than the open map, offer a one-tap switch. Fail-soft
 * (permission denied / timeout / no geo) → no banner; never blocks map load.
 */
export default function CitySuggestBanner({ cityId }: CitySuggestBannerProps) {
  const [suggested, setSuggested] = useState<CityId | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
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
            if (!cancelled) setSuggested(nearest);
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

  if (dismissed || !suggested) return null;

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
