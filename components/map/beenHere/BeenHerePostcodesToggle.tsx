"use client";

// "Your postcodes" in the Layers panel: the switch for the Been here district
// discs, and a caption that says what the figures count.

import type { BeenHereProgress } from "@/lib/beenHereProgress";

import { setBeenHerePostcodesOn, useBeenHerePostcodesOn, useBeenHereVenueIds } from "./useBeenHere";
import { useLondonBeenHereProgress } from "./useLondonBeenHereProgress";

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function postcodesCaption(progress: BeenHereProgress | null, on: boolean): string | null {
  if (!on) return "Shade each London postcode by how many of its pubs you've marked Been here.";
  if (!progress) return null;
  const { districts, visitedWithoutPostcode } = progress;
  const lines: string[] = [];
  if (districts.length === 0) {
    lines.push("Mark a pub Been here and its postcode shows up on the map.");
  } else {
    const pubs = districts.reduce((sum, row) => sum + row.visited, 0);
    lines.push(
      `${plural(pubs, "pub", "pubs")} across ${plural(districts.length, "postcode", "postcodes")}, out of the pubs on our London list.`,
    );
  }
  if (visitedWithoutPostcode > 0) {
    lines.push(
      visitedWithoutPostcode === 1
        ? "1 of yours has no postcode on our list, so no postcode counts it."
        : `${visitedWithoutPostcode} of yours have no postcode on our list, so no postcode counts them.`,
    );
  }
  return lines.join(" ");
}

export default function BeenHerePostcodesToggle() {
  const on = useBeenHerePostcodesOn();
  const visited = useBeenHereVenueIds();
  const progress = useLondonBeenHereProgress(on, visited);
  const caption = postcodesCaption(progress, on);
  return (
    <div className="mapLayersStories" role="group" aria-label="Your pubs">
      <p className="mapLayersSectionLabel">Your pubs</p>
      <div className="mapLayersBandRow">
        <button
          type="button"
          className={on ? "mapLayersChip isOn" : "mapLayersChip"}
          aria-pressed={on}
          onClick={() => setBeenHerePostcodesOn(!on)}
        >
          Your postcodes
        </button>
      </div>
      {caption ? <p className="mapLayersHint">{caption}</p> : null}
      {on && progress && progress.districts.length > 0 ? (
        <p className="mapLayersHint">
          {progress.districts.map((row) => `${row.district} ${row.visited} of ${row.total}, ${row.percent}%`).join(". ")}.
        </p>
      ) : null}
    </div>
  );
}
