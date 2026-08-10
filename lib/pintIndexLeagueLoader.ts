// Browser loader for the public Pint Index league rows used by the venue
// Overview area-price compare line. The snapshot is already a public asset, so
// we fetch it once per session (module-level promise) rather than bundling it
// into the map chunk. Fails soft to an empty league — silence, never a crash.

import {
  buildLeagueTable,
  validatePintIndexSnapshot,
  type LeagueRow,
} from "@/lib/pintIndex";
import { discardBody } from "@/lib/responseBody";

/** Public URL for the live Pint Index snapshot (mirrors public/data/...). */
export const PINT_INDEX_SNAPSHOT_PUBLIC_PATH = "/data/pint_index_snapshot.json";

async function fetchJson(path: string): Promise<unknown | null> {
  if (typeof window === "undefined") return null;
  try {
    const res = await fetch(path, { headers: { accept: "application/json" } });
    if (!res.ok) {
      discardBody(res);
      return null;
    }
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

let leaguePromise: Promise<LeagueRow[]> | null = null;

export function loadPintIndexLeagueRows(): Promise<LeagueRow[]> {
  leaguePromise ??= fetchJson(PINT_INDEX_SNAPSHOT_PUBLIC_PATH).then((raw) => {
    if (raw === null) return [];
    const result = validatePintIndexSnapshot(raw);
    return result.ok ? buildLeagueTable(result.snapshot) : [];
  });
  return leaguePromise;
}

/** Test seam: forget the cached fetch. */
export function resetPintIndexLeagueLoader(): void {
  leaguePromise = null;
}
