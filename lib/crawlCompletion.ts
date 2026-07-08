// Crawl completion tracking — a demo, localStorage-backed progress map.
//
// Marks a crawl as started, records which stops the walker has visited, and
// derives completion. Pure helpers take an optional Storage so unit tests can
// inject a Map-backed stub; browser callers omit it and use window.localStorage.
// SSR / missing storage is fail-soft (reads return empty, writes are no-ops).

export const CRAWL_PROGRESS_KEY = "pubmax_crawl_progress";

export type CrawlProgressEntry = {
  /** Ordered stop venue ids for this crawl (snapshot at start). */
  stopIds: string[];
  /** Venue ids the walker has marked visited (subset of stopIds). */
  visited: string[];
  startedAt: string;
  /** ISO timestamp when every stop was visited, or undefined while in progress. */
  completedAt?: string;
};

export type CrawlProgressMap = {
  crawls: Record<string, CrawlProgressEntry>;
};

function emptyProgress(): CrawlProgressMap {
  return { crawls: {} };
}

function hasWindowStorage(): boolean {
  return typeof window !== "undefined" && !!window.localStorage;
}

function resolveStorage(storage?: Storage | null): Storage | null {
  if (storage === null) return null;
  if (storage) return storage;
  if (!hasWindowStorage()) return null;
  return window.localStorage;
}

function normaliseId(raw: string): string {
  return typeof raw === "string" ? raw.trim() : "";
}

function uniqueIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids) {
    const id = normaliseId(raw);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Parse an untrusted stored blob into a safe progress map. Junk → empty. */
export function parseProgress(raw: unknown): CrawlProgressMap {
  if (!raw || typeof raw !== "object") return emptyProgress();
  const crawlsRaw = (raw as { crawls?: unknown }).crawls;
  if (!crawlsRaw || typeof crawlsRaw !== "object") return emptyProgress();
  const crawls: Record<string, CrawlProgressEntry> = {};
  for (const [key, value] of Object.entries(crawlsRaw as Record<string, unknown>)) {
    const id = normaliseId(key);
    if (!id || !value || typeof value !== "object") continue;
    const row = value as Record<string, unknown>;
    const stopIds = Array.isArray(row.stopIds)
      ? uniqueIds(row.stopIds.map((v) => String(v)))
      : [];
    const visited = Array.isArray(row.visited)
      ? uniqueIds(row.visited.map((v) => String(v))).filter((v) => stopIds.includes(v))
      : [];
    const startedAt =
      typeof row.startedAt === "string" && row.startedAt.trim()
        ? row.startedAt
        : new Date(0).toISOString();
    const completedAt =
      typeof row.completedAt === "string" && row.completedAt.trim()
        ? row.completedAt
        : undefined;
    crawls[id] = {
      stopIds,
      visited,
      startedAt,
      ...(completedAt ? { completedAt } : {}),
    };
  }
  return { crawls };
}

/** Read the full progress map from storage (or empty when unavailable). */
export function readProgress(storage?: Storage | null): CrawlProgressMap {
  const store = resolveStorage(storage);
  if (!store) return emptyProgress();
  try {
    const raw = store.getItem(CRAWL_PROGRESS_KEY);
    if (!raw) return emptyProgress();
    return parseProgress(JSON.parse(raw) as unknown);
  } catch {
    return emptyProgress();
  }
}

function writeProgress(map: CrawlProgressMap, storage?: Storage | null): void {
  const store = resolveStorage(storage);
  if (!store) return;
  try {
    store.setItem(CRAWL_PROGRESS_KEY, JSON.stringify(map));
  } catch {
    // Storage full / disabled — silent degrade.
  }
}

/**
 * Start (or restart) tracking a crawl. Snapshots the stop list and clears any
 * prior visited/completed state for that id. Returns the new entry, or null
 * when the id/stops are unusable.
 */
export function startCrawl(
  slugOrId: string,
  stopIds: string[],
  storage?: Storage | null,
): CrawlProgressEntry | null {
  const id = normaliseId(slugOrId);
  const stops = uniqueIds(stopIds);
  if (!id || stops.length === 0) return null;
  const map = readProgress(storage);
  const entry: CrawlProgressEntry = {
    stopIds: stops,
    visited: [],
    startedAt: new Date().toISOString(),
  };
  map.crawls[id] = entry;
  writeProgress(map, storage);
  return entry;
}

/**
 * Mark one stop visited on an in-progress crawl. Auto-stamps `completedAt`
 * when every stop has been visited. Returns the updated entry, or null when
 * the crawl isn't tracked / the venue isn't on the route.
 */
export function markStopVisited(
  slugOrId: string,
  venueId: string,
  storage?: Storage | null,
): CrawlProgressEntry | null {
  const id = normaliseId(slugOrId);
  const venue = normaliseId(venueId);
  if (!id || !venue) return null;
  const map = readProgress(storage);
  const entry = map.crawls[id];
  if (!entry) return null;
  if (!entry.stopIds.includes(venue)) return entry;
  if (!entry.visited.includes(venue)) {
    entry.visited = [...entry.visited, venue];
  }
  if (isComplete(entry) && !entry.completedAt) {
    entry.completedAt = new Date().toISOString();
  }
  map.crawls[id] = entry;
  writeProgress(map, storage);
  return entry;
}

/** True when every stop in the entry has been visited. */
export function isComplete(entry: CrawlProgressEntry | null | undefined): boolean {
  if (!entry || entry.stopIds.length === 0) return false;
  const visited = new Set(entry.visited);
  return entry.stopIds.every((id) => visited.has(id));
}

/** Convenience: read one crawl's entry (or null). */
export function readCrawl(
  slugOrId: string,
  storage?: Storage | null,
): CrawlProgressEntry | null {
  const id = normaliseId(slugOrId);
  if (!id) return null;
  return readProgress(storage).crawls[id] ?? null;
}

/** How many crawls have been fully walked (have completedAt / all stops). */
export function completedCrawlCount(storage?: Storage | null): number {
  const map = readProgress(storage);
  return Object.values(map.crawls).filter((entry) => isComplete(entry)).length;
}

/**
 * Force-mark a crawl complete (every stop visited). Useful for a "Mark complete"
 * control when the walker didn't tap each stop. Returns the entry or null.
 */
export function markCrawlComplete(
  slugOrId: string,
  storage?: Storage | null,
): CrawlProgressEntry | null {
  const id = normaliseId(slugOrId);
  if (!id) return null;
  const map = readProgress(storage);
  const entry = map.crawls[id];
  if (!entry) return null;
  entry.visited = [...entry.stopIds];
  entry.completedAt = entry.completedAt ?? new Date().toISOString();
  map.crawls[id] = entry;
  writeProgress(map, storage);
  return entry;
}
