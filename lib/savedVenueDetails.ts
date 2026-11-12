// Pub sheets a reader opened, kept on this device so a sheet still reads with
// no signal. An entry is the public `GET /api/venue/[id]` venue payload, the
// same answer a stranger gets, so no account data is in it. Each price in it
// keeps its own source and date, and the sheet names the day the copy was
// saved, so an old copy never passes as a live read.

const STORAGE_KEY = "pubmax:saved-venue-details:v1";
export const SAVED_VENUE_DETAILS_MAX = 20;
// A pub with an unusually long price list must not crowd the others out of
// the browser's small storage area.
const MAX_ENTRY_CHARS = 100_000;

type SavedVenueEntry = { id: string; savedAt: string; venue: unknown };

export type SavedVenueDetail = { venue: unknown; savedAt: string };

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function isEntry(value: unknown): value is SavedVenueEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<SavedVenueEntry>;
  return (
    typeof entry.id === "string" &&
    typeof entry.savedAt === "string" &&
    Number.isFinite(Date.parse(entry.savedAt)) &&
    Boolean(entry.venue) &&
    typeof entry.venue === "object"
  );
}

function readEntries(storage: StorageLike): SavedVenueEntry[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
  } catch {
    return [];
  }
}

/**
 * Keep one opened pub's payload, newest last, at most SAVED_VENUE_DETAILS_MAX.
 * A write the browser refuses drops the oldest copies and tries once more, and
 * never throws: offline reading is a bonus, never a reason a sheet fails.
 */
export function saveVenueDetail(
  id: string,
  venue: unknown,
  now: Date = new Date(),
  storage: StorageLike | null = browserStorage(),
): void {
  if (!storage || !id || !venue || typeof venue !== "object") return;
  const entry: SavedVenueEntry = { id, savedAt: now.toISOString(), venue };
  let entryChars: number;
  try {
    entryChars = JSON.stringify(entry).length;
  } catch {
    return;
  }
  if (entryChars > MAX_ENTRY_CHARS) return;
  const entries = [
    ...readEntries(storage).filter((saved) => saved.id !== id),
    entry,
  ].slice(-SAVED_VENUE_DETAILS_MAX);
  for (const kept of [entries, entries.slice(-Math.ceil(entries.length / 2))]) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(kept));
      return;
    } catch {
      continue;
    }
  }
}

/** The saved copy of one pub and the moment it was saved, or null. */
export function readSavedVenueDetail(
  id: string,
  storage: StorageLike | null = browserStorage(),
): SavedVenueDetail | null {
  if (!storage || !id) return null;
  const entry = readEntries(storage).find((saved) => saved.id === id);
  return entry ? { venue: entry.venue, savedAt: entry.savedAt } : null;
}
