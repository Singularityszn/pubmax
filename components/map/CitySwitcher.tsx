"use client";

import Link from "next/link";
import { useId, useState } from "react";

import {
  DEFAULT_CITY_ID,
  listEnabledCities,
  type CityId,
} from "@/lib/cities";

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
 * Compact city picker for map chrome. Lists enabled cities as links to
 * `/map/{id}` (London uses `/map` for back-compat bookmarks).
 */
export default function CitySwitcher({
  cityId = DEFAULT_CITY_ID,
}: CitySwitcherProps) {
  const cities = listEnabledCities();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const current =
    cities.find((c) => c.id === cityId) ?? cities[0] ?? { id: "london" as CityId, displayName: "London" };
  const shortLabel =
    CITY_SHORT_LABELS[current.id as CityId] ??
    current.displayName.slice(0, 3).toUpperCase();

  if (cities.length < 2) return null;

  return (
    <div className={open ? "citySwitcher isOpen" : "citySwitcher"}>
      <button
        type="button"
        className="citySwitcherTrigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={`City map: ${current.displayName}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="citySwitcherLabel citySwitcherLabelFull">{current.displayName}</span>
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
            const href = city.id === "london" ? "/map" : `/map/${city.id}`;
            const selected = city.id === current.id;
            return (
              <li key={city.id} role="option" aria-selected={selected}>
                <Link
                  href={href}
                  className={selected ? "citySwitcherLink isActive" : "citySwitcherLink"}
                  onClick={() => setOpen(false)}
                >
                  {city.displayName}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
