"use client";

import { useMemo, useState } from "react";
import { LocateFixed } from "lucide-react";

import type { CityId } from "@/lib/cities";
import type { Locality } from "@/lib/localities";
import {
  CHOOSE_AREA_MIN_VISIBLE,
  filterChooseAreaNeighbourhoods,
  londonNeighbourhoodRows,
  otherCityRows,
  type ChooseAreaNeighbourhood,
} from "@/lib/mapAreaPicker";
import type { Venue } from "@/lib/venues";

import "./chooseAreaSheet.css";

export type ChooseAreaPick =
  | { kind: "near-me" }
  | { kind: "night-area"; row: ChooseAreaNeighbourhood }
  | { kind: "city"; cityId: CityId; name: string };

type ChooseAreaSheetProps = {
  cityId: CityId;
  venues: readonly Venue[];
  localities?: readonly Locality[];
  locationNote?: string | null;
  locationBusy?: boolean;
  onPick: (pick: ChooseAreaPick) => void;
};

function pubCountLabel(count: number): string {
  if (count === 1) return "1 pub";
  return `${count} pubs`;
}

export default function ChooseAreaSheet({
  cityId,
  venues,
  localities = [],
  locationNote,
  locationBusy = false,
  onPick,
}: ChooseAreaSheetProps) {
  const [query, setQuery] = useState("");
  const neighbourhoods = useMemo(
    () => londonNeighbourhoodRows(venues, cityId),
    [cityId, venues],
  );
  const filtered = useMemo(
    () => filterChooseAreaNeighbourhoods(neighbourhoods, query, localities),
    [localities, neighbourhoods, query],
  );
  const visibleRows = query.trim()
    ? filtered
    : filtered.slice(0, Math.max(CHOOSE_AREA_MIN_VISIBLE, filtered.length));
  const cities = useMemo(() => otherCityRows(cityId), [cityId]);

  return (
    <div className="chooseAreaSheet">
      <div className="chooseAreaSearch">
        <label htmlFor="choose-area-search">Search areas and postcodes</label>
        <input
          id="choose-area-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Camden, N1, Willesden…"
          autoComplete="off"
        />
      </div>
      {locationNote ? <p className="chooseAreaNote">{locationNote}</p> : null}
      <section aria-labelledby="choose-area-london">
        <h3 id="choose-area-london" className="chooseAreaSectionTitle">
          London
        </h3>
        <ul className="chooseAreaList">
          <li>
            <button
              type="button"
              className="chooseAreaRow"
              disabled={locationBusy}
              onClick={() => onPick({ kind: "near-me" })}
            >
              <span className="chooseAreaRowName">
                <LocateFixed size={16} aria-hidden="true" />{" "}
                {locationBusy ? "Locating" : "Near me"}
              </span>
            </button>
          </li>
          {visibleRows.map((row) => (
            <li key={row.slug}>
              <button
                type="button"
                className="chooseAreaRow"
                onClick={() => onPick({ kind: "night-area", row })}
              >
                <span className="chooseAreaRowName">{row.name}</span>
                {row.pubCount > 0 ? (
                  <span className="chooseAreaRowMeta">{pubCountLabel(row.pubCount)}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </section>
      {cities.length > 0 ? (
        <section aria-labelledby="choose-area-cities">
          <h3 id="choose-area-cities" className="chooseAreaSectionTitle">
            Other cities
          </h3>
          <ul className="chooseAreaList">
            {cities.map((city) => (
              <li key={city.cityId}>
                <button
                  type="button"
                  className="chooseAreaRow"
                  onClick={() =>
                    onPick({ kind: "city", cityId: city.cityId, name: city.name })
                  }
                >
                  <span className="chooseAreaRowName">{city.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
