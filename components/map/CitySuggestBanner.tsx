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
import { nearestEnabledCity } from "@/lib/nearestCity";

import "./citySuggestBanner.css";

type CitySuggestBannerProps = {
  cityId: CityId;
  onLocationFound?: (location: { lat: number; lng: number }) => void;
  onVisibilityChange?: (visible: boolean) => void;
};

const DISMISS_KEY = "pubmax:citySuggestDismiss:v1";
const DISMISS_EVENT = "pubmax:city-suggest-dismiss";

function readDismissed(): boolean {
  if (typeof window === "undefined" || !window.sessionStorage) return false;
  try {
    return window.sessionStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function writeDismissed(): void {
  if (typeof window === "undefined" || !window.sessionStorage) return;
  try {
    window.sessionStorage.setItem(DISMISS_KEY, "1");
    window.dispatchEvent(new Event(DISMISS_EVENT));
  } catch {
    try {
      window.dispatchEvent(new Event(DISMISS_EVENT));
    } catch {
      // ignore
    }
  }
}

function subscribeDismiss(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => onStoreChange();
  window.addEventListener(DISMISS_EVENT, handler);
  return () => window.removeEventListener(DISMISS_EVENT, handler);
}

function saveDataPreferred(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & {
    connection?: { saveData?: boolean };
    mozConnection?: { saveData?: boolean };
    webkitConnection?: { saveData?: boolean };
  };
  const conn = nav.connection ?? nav.mozConnection ?? nav.webkitConnection;
  return Boolean(conn?.saveData);
}

type ClientFlags = { geoAvailable: boolean; saveData: boolean };

/** Stable SSR/getServerSnapshot — a fresh object each call would trip React #185. */
const SSR_CLIENT_FLAGS: ClientFlags = { geoAvailable: false, saveData: true };

/**
 * Cached client snapshot for useSyncExternalStore.
 * getSnapshot must return the same reference when data is unchanged; returning
 * a new `{…}` every read caused infinite re-renders (React #185) and crashed /map.
 */
let cachedClientFlags: ClientFlags | null = null;

/** @internal Exported for regression tests — prefer the hook path in app code. */
export function readClientFlags(): ClientFlags {
  if (cachedClientFlags) return cachedClientFlags;
  if (typeof navigator === "undefined") {
    cachedClientFlags = SSR_CLIENT_FLAGS;
    return cachedClientFlags;
  }
  cachedClientFlags = {
    geoAvailable: Boolean(navigator.geolocation),
    saveData: saveDataPreferred(),
  };
  return cachedClientFlags;
}

/** One-shot client snapshot — navigator flags do not change mid-session. */
function subscribeClientFlags(onStoreChange: () => void): () => void {
  void onStoreChange;
  return () => {};
}

/**
 * Opt-in geolocation city nudge. Does NOT call getCurrentPosition on mount —
 * the viewer taps "Near me?" first. Honours Save-Data and a session dismiss.
 * Fail-soft (permission denied / timeout / no geo) → no switch offer.
 * Kept below the CitySwitcher dropdown in z-order so city picks stay tappable.
 */
export default function CitySuggestBanner({
  cityId,
  onLocationFound,
  onVisibilityChange,
}: CitySuggestBannerProps) {
  const dismissed = useSyncExternalStore(
    subscribeDismiss,
    readDismissed,
    () => true, // SSR: hide until client can read sessionStorage
  );
  const flags = useSyncExternalStore(
    subscribeClientFlags,
    readClientFlags,
    () => SSR_CLIENT_FLAGS,
  );

  const [suggested, setSuggested] = useState<CityId | null>(null);
  const [checking, setChecking] = useState(false);
  const [locatedHere, setLocatedHere] = useState(false);
  const [sessionDismissed, setSessionDismissed] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const checkGen = useRef(0);
  const visible =
    !dismissed &&
    !sessionDismissed &&
    !flags.saveData &&
    flags.geoAvailable;

  useEffect(() => {
    void Promise.resolve().then(() => setHydrated(true));
  }, []);

  useEffect(() => {
    if (hydrated) onVisibilityChange?.(visible);
  }, [hydrated, onVisibilityChange, visible]);

  const dismiss = useCallback(() => {
    writeDismissed();
    setSessionDismissed(true);
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
