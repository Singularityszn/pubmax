// "New since you last looked": which rows on a surface this device has not
// been shown before.
//
// A returning reader met Tonight's listings and the home page's recent prices
// with nothing to say which of them arrived since the last visit, so every
// visit read as the same page. Feeds that bring people back mark what is new to
// THEM; this does the same with nothing but this device's own memory.
//
// HONEST BY CONSTRUCTION. A listing's `observedAt` is restamped every time a
// source is re-read (lib/whatsOn.ts), so a date comparison would call a
// re-checked Thursday quiz "new" every week. A row is new here only when its
// stable id was not on this surface the last time this device was shown it,
// which is the one claim a device can make without inventing anything.
//
// THE RULES THIS FILE OWNS.
// 1. A FIRST VISIT MARKS NOTHING. With no memory of a surface there is no
//    "since", so every row is plain, and the visit becomes the baseline.
// 2. THE BASELINE HOLDS FOR THE SESSION. It is read once per browser session
//    and kept in sessionStorage, so a reload mid-visit does not wipe the
//    markers, and the next session compares against everything shown in this
//    one.
// 3. A GROUP IS NEW ONLY WHEN NONE OF ITS MEMBERS WAS SEEN. Tonight shows one
//    card for an offer many pubs run and picks the nearest as the card, so the
//    card's own id changes with the reader's position; the family is judged as
//    a whole.
// 4. MEMORY IS BOUNDED: the newest SEEN_MEMORY_LIMIT ids per surface.
// Every storage access fails soft: no storage means no markers, never an error.

import { useEffect, useMemo, useSyncExternalStore } from "react";

import { safeLocalStorage, safeSessionStorage } from "@/lib/safeStorage";

export type SeenSurface = "tonight" | "drops";

export const SEEN_MEMORY_LIMIT = 600;
export const NEW_SINCE_LABEL = "New";
/** Read after the visible word by assistive technology. */
export const NEW_SINCE_SR_SUFFIX = " since your last visit";

const STORAGE_KEY: Record<SeenSurface, string> = {
  tonight: "pubmax:seen:tonight:v1",
  drops: "pubmax:seen:drops:v1",
};

// ── Pure core ────────────────────────────────────────────────────────────────

/**
 * For each group of row ids, whether it is new: none of its ids is in the
 * baseline. A null baseline (no memory of this surface) marks nothing.
 */
export function newGroups(
  groups: readonly (readonly string[])[],
  baseline: ReadonlySet<string> | null,
): boolean[] {
  if (!baseline) return groups.map(() => false);
  return groups.map((ids) => ids.length > 0 && ids.every((id) => !baseline.has(id)));
}

/** The ids to remember: this visit's first, then the older ones, deduped and capped. */
export function mergeSeenIds(
  previous: readonly string[],
  current: readonly string[],
  limit: number = SEEN_MEMORY_LIMIT,
): string[] {
  const out: string[] = [];
  const held = new Set<string>();
  for (const id of [...current, ...previous]) {
    if (!id || held.has(id)) continue;
    held.add(id);
    out.push(id);
    if (out.length >= limit) break;
  }
  return out;
}

export function parseSeenIds(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((id): id is string => typeof id === "string" && id.length > 0);
  } catch {
    return null;
  }
}

// ── Storage ──────────────────────────────────────────────────────────────────

const NO_BASELINE = "none";
const baselineCache = new Map<SeenSurface, ReadonlySet<string> | null>();

/**
 * The ids this device had been shown on the surface before this session, or
 * null on a first visit. Read once per session (rule 2), then cached.
 */
export function readSeenBaseline(surface: SeenSurface): ReadonlySet<string> | null {
  if (baselineCache.has(surface)) return baselineCache.get(surface) ?? null;
  const sessionKey = `${STORAGE_KEY[surface]}:baseline`;
  const session = safeSessionStorage();
  let baseline: ReadonlySet<string> | null = null;
  try {
    const held = session?.getItem(sessionKey) ?? null;
    if (held !== null) {
      const ids = held === NO_BASELINE ? null : parseSeenIds(held);
      baseline = ids ? new Set(ids) : null;
    } else {
      const ids = parseSeenIds(safeLocalStorage()?.getItem(STORAGE_KEY[surface]) ?? null);
      baseline = ids ? new Set(ids) : null;
      session?.setItem(sessionKey, ids ? JSON.stringify(ids) : NO_BASELINE);
    }
  } catch {
    baseline = null;
  }
  baselineCache.set(surface, baseline);
  return baseline;
}

/** Remember that these ids have now been shown on the surface. */
export function recordSeen(surface: SeenSurface, ids: readonly string[]): void {
  if (ids.length === 0) return;
  const local = safeLocalStorage();
  if (!local) return;
  try {
    const previous = parseSeenIds(local.getItem(STORAGE_KEY[surface])) ?? [];
    local.setItem(STORAGE_KEY[surface], JSON.stringify(mergeSeenIds(previous, ids)));
  } catch {
    // Storage full or blocked: the markers simply do not appear next time.
  }
}

/** Test-only: forget the per-page baseline cache. */
export function __resetSeenBaselineCache(): void {
  baselineCache.clear();
}

// ── Hook ─────────────────────────────────────────────────────────────────────

const noop = () => () => {};

/**
 * Which of `groups` are new since this device last looked at `surface`. Rows
 * are remembered once `shown` is true, so a list still loading is never
 * recorded as seen. The server render marks nothing.
 */
export function useNewSinceLastLook(
  surface: SeenSurface,
  groups: readonly (readonly string[])[],
  shown: boolean,
): boolean[] {
  const baseline = useSyncExternalStore(
    noop,
    () => readSeenBaseline(surface),
    () => null,
  );
  const flags = useMemo(() => newGroups(groups, baseline), [groups, baseline]);
  const allIds = useMemo(() => groups.flat(), [groups]);
  useEffect(() => {
    if (shown) recordSeen(surface, allIds);
  }, [surface, allIds, shown]);
  return flags;
}
