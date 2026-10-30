// "That's wrong": a signed-in drinker tells us a listed fact about a pub is
// off. The pub has shut, its hours are wrong, or something else on its sheet is.
//
// A CORRECTION IS A NOTE TO A PERSON, never an edit. Nothing reads these rows
// to move a pin, hide a pub, change hours or touch a price. A moderator reads
// the queue at /admin, checks the street, and fixes the fact through the same
// offline pack rebuild every other venue fact goes through. Resolving a row
// here only stamps its status.
//
// A PRICE IS NOT A CORRECTION. "Price has changed" is offered at the door, but
// it opens the existing log flow, because a new price is a dated observation
// with a bill behind it (lib/pintDropReceipt.ts), not a complaint. The route
// stores nothing for it and answers with that hint.
//
// Browser-safe leaf: the sheet's form and the route share ONE validator, and the
// closed sets here are mirrored by CHECKs in migration 0197.

const VENUE_CORRECTION_KINDS = ["closed", "hours", "price", "other"] as const;
export type VenueCorrectionKind = (typeof VENUE_CORRECTION_KINDS)[number];

/** The kinds a row is ever stored under. `price` is answered with the log flow instead. */
const STORED_VENUE_CORRECTION_KINDS = ["closed", "hours", "other"] as const;
export type StoredVenueCorrectionKind = (typeof STORED_VENUE_CORRECTION_KINDS)[number];

const VENUE_CORRECTION_STATUSES = ["open", "resolved", "dismissed"] as const;
export type VenueCorrectionStatus = (typeof VENUE_CORRECTION_STATUSES)[number];

/** A moderator's two verdicts on an open row. */
const VENUE_CORRECTION_DECISIONS = ["resolved", "dismissed"] as const;
export type VenueCorrectionDecision = (typeof VENUE_CORRECTION_DECISIONS)[number];

export const VENUE_CORRECTION_NOTE_MAX = 200;
const VENUE_ID_MAX = 128;

/** What the sheet offers, in the order it offers them. */
export const VENUE_CORRECTION_CHOICES: ReadonlyArray<{ kind: VenueCorrectionKind; label: string }> = [
  { kind: "closed", label: "It's shut" },
  { kind: "hours", label: "Hours are wrong" },
  { kind: "price", label: "Price has changed" },
  { kind: "other", label: "Something else" },
];

/** What a moderator reads beside each row. */
export const VENUE_CORRECTION_KIND_LABEL: Record<StoredVenueCorrectionKind, string> = {
  closed: "Says it's shut",
  hours: "Hours are wrong",
  other: "Something else",
};

export const VENUE_CORRECTION_RECEIPT = "Thanks. A person will check it.";
export const VENUE_CORRECTION_PRICE_HINT = "A new price goes in the price log, with the bill.";

export type VenueCorrection = {
  id: string;
  venueId: string;
  kind: StoredVenueCorrectionKind;
  note: string;
  ownerUserId: string;
  status: VenueCorrectionStatus;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
};

/** What the moderator queue carries: never the reporting account. */
export type ModeratorVenueCorrection = Omit<VenueCorrection, "ownerUserId"> & {
  /** The pub's name as the packs hold it, or null when no pack names the id any more. */
  venueName: string | null;
};


export type VenueCorrectionInput =
  | { ok: true; venueId: string; kind: VenueCorrectionKind; note: string }
  | { ok: false; error: string; field: "venueId" | "kind" | "note" };

function isVenueCorrectionKind(value: unknown): value is VenueCorrectionKind {
  return typeof value === "string" && (VENUE_CORRECTION_KINDS as readonly string[]).includes(value);
}

export function isStoredVenueCorrectionKind(value: unknown): value is StoredVenueCorrectionKind {
  return typeof value === "string" && (STORED_VENUE_CORRECTION_KINDS as readonly string[]).includes(value);
}

export function isVenueCorrectionStatus(value: unknown): value is VenueCorrectionStatus {
  return typeof value === "string" && (VENUE_CORRECTION_STATUSES as readonly string[]).includes(value);
}

export function isVenueCorrectionDecision(value: unknown): value is VenueCorrectionDecision {
  return typeof value === "string" && (VENUE_CORRECTION_DECISIONS as readonly string[]).includes(value);
}

/** One line of free text: no angle brackets, no control characters, single spaces. */
function cleanNote(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[<>]/g, "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Count what a reader counts, so an emoji is one character, as PostgreSQL's length() counts it. */
function characterCount(value: string): number {
  return [...value].length;
}

/**
 * The one validator. A note over the limit is refused, not trimmed: a cut
 * sentence is a different complaint from the one the drinker wrote.
 */
export function validateVenueCorrection(body: Record<string, unknown>): VenueCorrectionInput {
  const venueId = typeof body.venueId === "string" ? body.venueId.trim() : "";
  if (!venueId || venueId.length > VENUE_ID_MAX) {
    return { ok: false, error: "Pick a venue from the map.", field: "venueId" };
  }
  if (!isVenueCorrectionKind(body.kind)) {
    return { ok: false, error: "Choose what's wrong.", field: "kind" };
  }
  if (body.note !== undefined && body.note !== null && typeof body.note !== "string") {
    return { ok: false, error: "The note must be text.", field: "note" };
  }
  const note = cleanNote(body.note);
  if (characterCount(note) > VENUE_CORRECTION_NOTE_MAX) {
    return {
      ok: false,
      error: `Keep the note to ${VENUE_CORRECTION_NOTE_MAX} characters.`,
      field: "note",
    };
  }
  return { ok: true, venueId, kind: body.kind, note };
}

/** What the account export carries: the owner and the moderator stamp stay out. */
export type VenueCorrectionOwnerFields = Pick<
  VenueCorrection,
  "id" | "venueId" | "kind" | "note" | "status" | "createdAt" | "resolvedAt"
>;

export function venueCorrectionOwnerFields(row: VenueCorrection): VenueCorrectionOwnerFields {
  return {
    id: row.id,
    venueId: row.venueId,
    kind: row.kind,
    note: row.note,
    status: row.status,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt,
  };
}
