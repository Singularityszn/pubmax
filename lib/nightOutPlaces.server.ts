import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  isValidNightOutPlaceSnapshot,
  type NightOutPlaceSnapshot,
} from "@/lib/nightOutPlaces";

const SNAPSHOT_PATH = "public/data/night_out_places/latest.json";

const EMPTY_SNAPSHOT: NightOutPlaceSnapshot = {
  version: 1,
  generatedAt: "1970-01-01T00:00:00.000Z",
  status: "empty",
  provenanceRegistryVersion: 1,
  places: [],
};

/** Fail closed to the honest empty state when the committed artifact is broken. */
export function loadNightOutPlaceSnapshot(
  rootDir = process.cwd(),
): NightOutPlaceSnapshot {
  try {
    const parsed = JSON.parse(
      readFileSync(join(rootDir, SNAPSHOT_PATH), "utf8"),
    ) as unknown;
    return isValidNightOutPlaceSnapshot(parsed) ? parsed : EMPTY_SNAPSHOT;
  } catch {
    return EMPTY_SNAPSHOT;
  }
}
