"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { X } from "lucide-react";

import {
  getCity,
  type CityId,
} from "@/lib/cities";
import { writePreferredCity } from "@/lib/cityPreference";
import { cityMapShareUrl } from "@/lib/cityShare";
import {
  dismissCitySuggest,
  getMapLocationControlAvailable,
  getMapLocationControlServerSnapshot,
  saveDataPreferred,
  subscribeMapLocationControl,
} from "@/lib/mapLocationPrompt";
import { nearestEnabledCity } from "@/lib/nearestCity";

import "./citySuggestBanner.css";

type CitySuggestBannerProps = {
  cityId: CityId;
  onLocationFound?: (location: { lat: number; lng: number }) => void;
};

/**
 * Opt-in geolocation city nudge. Does NOT call getCurrentPosition on mount —
 * the viewer taps "Near me?" first. Honours Save-Data and a session dismiss.
 * Fail-soft (permission denied / timeout / no geo) → no switch offer.
 * Kept below the CitySwitcher dropdown in z-order so city picks stay tappable.
 */
export default function CitySuggestBanner({
  cityId,
  onLocationFound,
}: CitySuggestBannerProps) {
  const visible = useSyncExternalStore(
    subscribeMapLocationControl,
    getMapLocationControlAvailable,
    getMapLocationControlServerSnapshot,
  );
  const [suggested, setSuggested] = useState<CityId | null>(null);
  const [checking, setChecking] = useState(false);
  const [locatedHere, setLocatedHere] = useState(false);
  const checkGen = useRef(0);

  const dismiss = useCallback(() => {
    dismissCitySuggest();
    setSuggested(null);
  }, []);

  const checkNearby = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    if (saveDataPreferred()) return;

    const gen = ++checkGen.current;
    setChecking(true);
    setSuggested(null);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (gen !== checkGen.current) return;
        const location = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
        const nearest = nearestEnabledCity(
          location.lat,
          location.lng,
        );
        void Promise.resolve().then(() => {
          if (gen !== checkGen.current) return;
          setChecking(false);
          if (nearest && nearest !== cityId) {
            setSuggested(nearest);
            setLocatedHere(false);
          } else if (nearest === cityId) {
            setLocatedHere(true);
            onLocationFound?.(location);
          }
        });
      },
      () => {
        if (gen !== checkGen.current) return;
        void Promise.resolve().then(() => {
          if (gen === checkGen.current) setChecking(false);
        });
      },
      { enableHighAccuracy: false, timeout: 5000, maximumAge: 60_000 },
    );
  }, [cityId, onLocationFound]);

  // Reuse an already-granted permission without prompting again. A first-time
  // visitor still has to tap Near me, preserving the Home Area privacy boundary.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("permissions" in navigator)) return;
    let cancelled = false;
    navigator.permissions
      .query({ name: "geolocation" })
      .then((permission) => {
        if (!cancelled && permission.state === "granted") checkNearby();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [checkNearby]);

  if (!visible) {
    return null;
  }

  if (suggested && suggested !== cityId) {
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
          onClick={dismiss}
        >
          <X size={14} strokeWidth={2.25} aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <div className="citySuggestBanner" role="status">
      <p className="citySuggestBannerCopy">
        {checking
          ? "Finding pubs near you…"
          : locatedHere
            ? "Showing pubs near you"
            : "Visiting another city?"}
      </p>
      <button
        type="button"
        className="citySuggestBannerSwitch"
        disabled={checking}
        onClick={checkNearby}
      >
        {checking ? "Checking…" : locatedHere ? "Refresh" : "Near me?"}
      </button>
      <button
        type="button"
        className="citySuggestBannerDismiss"
        aria-label="Dismiss city suggestion"
        onClick={dismiss}
      >
        <X size={14} strokeWidth={2.25} aria-hidden="true" />
      </button>
    </div>
  );
}
