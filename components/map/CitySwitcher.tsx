"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";

import {
  DEFAULT_CITY_ID,
  listEnabledCities,
  type CityId,
} from "@/lib/cities";
import { writePreferredCity } from "@/lib/cityPreference";
import { cityMapShareUrl } from "@/lib/cityShare";

import "./citySwitcher.css";

type CitySwitcherProps = {
  cityId?: CityId;
};

/** Narrow-chrome abbreviations — keeps the map toolbar row usable at ~390px. */
const CITY_SHORT_LABELS: Record<CityId, string> = {
  london: "LDN",
  manchester: "MAN",
  liverpool: "LPL",
  oxford: "OXF",
  durham: "DUR",
  glasgow: "GLA",
  bristol: "BRS",
  cambridge: "CAM",
  bath: "BTH",
};

/**
 * Compact city picker for map chrome. Client-navigates to `/map/{id}`
 * (London stays `/map`) so the map remounts instantly without a full reload.
 */
export default function CitySwitcher({
  cityId = DEFAULT_CITY_ID,
}: CitySwitcherProps) {
  const cities = listEnabledCities();
  const listId = useId();
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const current =
    cities.find((c) => c.id === cityId) ??
    cities[0] ?? { id: "london" as CityId, displayName: "London" };
  const shortLabel =
    CITY_SHORT_LABELS[current.id as CityId] ??
    current.displayName.slice(0, 3).toUpperCase();

  // Prefetch every city map once so the first tap feels instant.
  useEffect(() => {
    for (const city of listEnabledCities()) {
      try {
        router.prefetch(cityMapShareUrl(city.id));
      } catch {
        // Best-effort — navigation must never depend on prefetch.
      }
    }
  }, [router]);

  // Close on outside click / Escape while open.
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent | PointerEvent) => {
      const root = rootRef.current;
      if (!root) return;
      if (event.target instanceof Node && !root.contains(event.target)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selectCity = useCallback(
    (nextId: CityId) => {
      writePreferredCity(nextId);
      setOpen(false);
      if (nextId === cityId) return;
      const href = cityMapShareUrl(nextId);
      startTransition(() => {
        router.push(href);
      });
    },
    [cityId, router],
  );

  if (cities.length < 2) return null;

  return (
    <div
      ref={rootRef}
      className={
        open
          ? pending
            ? "citySwitcher isOpen isPending"
            : "citySwitcher isOpen"
          : pending
            ? "citySwitcher isPending"
            : "citySwitcher"
      }
    >
      <button
        type="button"
        className="citySwitcherTrigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-busy={pending || undefined}
        aria-label={`City map: ${current.displayName}. Change city`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="citySwitcherLabel citySwitcherLabelFull">
          {current.displayName}
        </span>
        <span className="citySwitcherLabel citySwitcherLabelShort" aria-hidden="true">
          {shortLabel}
        </span>
        <span className="citySwitcherCaret" aria-hidden="true" />
      </button>
      {open ? (
        <ul
          id={listId}
          className="citySwitcherList"
          role="listbox"
          aria-label="Choose city map"
        >
          {cities.map((city) => {
            const selected = city.id === current.id;
            return (
              <li key={city.id} role="option" aria-selected={selected}>
                <button
                  type="button"
                  className={
                    selected ? "citySwitcherLink isActive" : "citySwitcherLink"
                  }
                  onClick={() => selectCity(city.id)}
                >
                  {city.displayName}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
