"use client";

import Link from "next/link";
import { useId, useState } from "react";

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
    cities.find((c) => c.id === cityId) ?? cities[0] ?? { id: "london", displayName: "London" };

  if (cities.length < 2) return null;

  return (
    <div className={open ? "citySwitcher isOpen" : "citySwitcher"}>
      <button
        type="button"
        className="citySwitcherTrigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="citySwitcherLabel">{current.displayName}</span>
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
            const href = cityMapShareUrl(city.id);
            const selected = city.id === current.id;
            return (
              <li key={city.id} role="option" aria-selected={selected}>
                <Link
                  href={href}
                  className={selected ? "citySwitcherLink isActive" : "citySwitcherLink"}
                  onClick={() => {
                    writePreferredCity(city.id);
                    setOpen(false);
                  }}
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
