"use client";

import { useState } from "react";

import {
  districtArea,
  districtCaption,
  LEAGUES_COPY,
  type LeagueDistrict,
  type LeagueMapArea,
} from "@/lib/leagues";

/** The areas as the map lays them out. WC and EC share the centre block. */
const BLOCKS: ReadonlyArray<{ key: string; name: string; areas: readonly LeagueMapArea[] }> = [
  { key: "NW", name: "NW", areas: ["NW"] },
  { key: "N", name: "N", areas: ["N"] },
  { key: "E", name: "E", areas: ["E"] },
  { key: "W", name: "W", areas: ["W"] },
  { key: "centre", name: "WC and EC", areas: ["WC", "EC"] },
  { key: "SW", name: "SW", areas: ["SW"] },
  { key: "SE", name: "SE", areas: ["SE"] },
];

/**
 * London's postcode districts as tiles, grouped by area, each one coloured by
 * the member who leads it. Tapping a tile says who leads it and how far you
 * have got, in words.
 */
export default function LeagueMap({
  districts,
  hueOf,
  self,
}: {
  districts: readonly LeagueDistrict[];
  /** The colour index a handle wears on the table. */
  hueOf: (handle: string) => number;
  self: string | null;
}): React.JSX.Element {
  const [chosen, setChosen] = useState<string | null>(null);
  const picked = districts.find((district) => district.district === chosen) ?? null;

  return (
    <>
      <div className="leagueMap">
        {BLOCKS.map((block) => {
          const tiles = districts.filter((district) => block.areas.includes(districtArea(district.district)!));
          if (tiles.length === 0) return null;
          return (
            <section key={block.key} className={`leagueMapArea leagueMapArea--${block.key}`} aria-label={`${block.name} districts`}>
              <h3 className="leagueMapAreaName">{block.name}</h3>
              <ul className="leagueMapTiles">
                {tiles.map((district) => {
                  const led = district.leaders.length === 1;
                  const shared = district.leaders.length > 1;
                  const className = [
                    "leagueTile",
                    led ? `leagueTile--led leagueHue-${hueOf(district.leaders[0]!)}` : null,
                    shared ? "leagueTile--shared" : null,
                  ].filter(Boolean).join(" ");
                  return (
                    <li key={district.district}>
                      <button
                        type="button"
                        className={className}
                        aria-pressed={chosen === district.district}
                        aria-label={districtCaption(district, self)}
                        onClick={() => setChosen((current) => (current === district.district ? null : district.district))}
                      >
                        {district.district}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
      <p className="leaguesNote" role="status" aria-live="polite">
        {picked ? districtCaption(picked, self) : "Tap a district to see who leads it."}
      </p>
      <ul className="leagueMapKey" aria-label="Map key">
        <li><span className="leagueMapKeyShared" aria-hidden="true" />{LEAGUES_COPY.mapShared}</li>
        <li><span className="leagueMapKeyNobody" aria-hidden="true" />{LEAGUES_COPY.mapNobody}</li>
      </ul>
    </>
  );
}
