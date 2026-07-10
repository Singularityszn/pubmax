"use client";

import Link from "next/link";
import { useCallback, useRef, useState, useSyncExternalStore } from "react";
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

function readClientFlags(): ClientFlags {
  if (typeof navigator === "undefined") {
    return { geoAvailable: false, saveData: true };
  }
  return {
    geoAvailable: Boolean(navigator.geolocation),
    saveData: saveDataPreferred(),
  };
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
export default function CitySuggestBanner({ cityId }: CitySuggestBannerProps) {
  const dismissed = useSyncExternalStore(
    subscribeDismiss,
    readDismissed,
    () => true, // SSR: hide until client can read sessionStorage
  );
  const flags = useSyncExternalStore(
    subscribeClientFlags,
    readClientFlags,
    () => ({ geoAvailable: false, saveData: true }),
  );

  const [suggested, setSuggested] = useState<CityId | null>(null);
  const [checking, setChecking] = useState(false);
  const [sessionDismissed, setSessionDismissed] = useState(false);
  const checkGen = useRef(0);

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
        const nearest = nearestEnabledCity(
          pos.coords.latitude,
          pos.coords.longitude,
        );
        void Promise.resolve().then(() => {
          if (gen !== checkGen.current) return;
          setChecking(false);
          if (nearest && nearest !== cityId) {
            setSuggested(nearest);
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
  }, [cityId]);

  if (dismissed || sessionDismissed || flags.saveData || !flags.geoAvailable) {
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
        {checking ? "Checking nearby city…" : "Visiting another city?"}
      </p>
      <button
        type="button"
        className="citySuggestBannerSwitch"
        disabled={checking}
        onClick={checkNearby}
      >
        {checking ? "Checking…" : "Near me?"}
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
