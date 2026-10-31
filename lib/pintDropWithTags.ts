// "With" on a Pint Drop: free text for people who are not on PUBMAXX, and
// consented handle tags for people who are (WEEK1_HYGIENE_BUILD round 2, "Tag
// who you went with"). This leaf is the reading rule both halves share, and it
// is browser-safe: the composer, the preview card and the server all ask here.
//
// A HANDLE APPEARS ONLY AFTER CONSENT. A tagged handle is a proposal, never a
// fact. It goes to that person's tag inbox (app/social/SocialTagInbox.tsx) as
// the tag kind "with". Until they approve it the drop says "with 1 person" and
// never the handle; after approval it says "with @sam" and links to them; a
// decline, a withdrawal or the tagger's cancel take it off the drop. So no
// `@token` the writer typed may ever reach the drop's note: `splitWithInput`
// takes every one of them out of the free text, whether or not it names a
// real account, because a typed handle that happened to be blocked or private
// would otherwise print anyway.

import { normalizeHandle } from "@/lib/handleNormalize";

/** The most handles one drop may propose, the same cap as the free text. */
export const WITH_TAG_MAX = 6;

/** The tag kinds the inbox reads. "photo" is the Social post photo tag. */
const SOCIAL_TAG_KINDS = ["photo", "with"] as const;
export type SocialTagKind = (typeof SOCIAL_TAG_KINDS)[number];

export function isSocialTagKind(value: unknown): value is SocialTagKind {
  return typeof value === "string" && (SOCIAL_TAG_KINDS as readonly string[]).includes(value);
}

/** The five states a with-tag row can hold, copied from the photo tags. */
export type WithTagState = "proposed" | "approved" | "declined" | "withdrawn" | "cancelled";

/** What a reader of a drop is told about its tags. Handles are approved only. */
export type PintDropWithSummary = {
  approved: string[];
  pending: number;
};

export const EMPTY_WITH_SUMMARY: PintDropWithSummary = { approved: [], pending: 0 };

const WITH_SEPARATOR_RE = /[,\s]+/;

/**
 * Split the "With" field into the free-text names it keeps and the handles it
 * proposes. A token that starts with `@` is a handle; everything else is a
 * name and stays in the note exactly as it did before tags existed. Picked
 * handles (from the search) are added by the caller and merged here.
 */
export function splitWithInput(
  value: string,
  picked: readonly string[] = [],
): { names: string; handles: string[] } {
  const names: string[] = [];
  const handles: string[] = [];
  const addHandle = (raw: string) => {
    const handle = normalizeHandle(raw);
    if (handle && !handles.includes(handle) && handles.length < WITH_TAG_MAX) handles.push(handle);
  };
  for (const raw of picked) addHandle(raw);
  for (const part of (typeof value === "string" ? value : "").split(WITH_SEPARATOR_RE)) {
    const token = part.trim();
    if (!token) continue;
    if (token.startsWith("@")) addHandle(token);
    else names.push(token);
  }
  return { names: names.join(", "), handles };
}

/** The word for a count of people, said the way a person says it. */
function people(count: number): string {
  return count === 1 ? "1 person" : `${count} people`;
}

/**
 * The line a drop prints for its tags, or "" when it has none to print.
 * "with @sam", "with 1 person", "with @sam and 2 people". Handles only ever
 * come from `approved`; a pending tag is a count and nothing else.
 */
export function formatWithLine(summary: PintDropWithSummary): string {
  const approved = summary.approved.map(normalizeHandle).filter(Boolean);
  const pending = Number.isInteger(summary.pending) && summary.pending > 0 ? summary.pending : 0;
  const parts = approved.map((handle) => `@${handle}`);
  if (pending > 0) parts.push(people(pending));
  if (parts.length === 0) return "";
  if (parts.length === 1) return `with ${parts[0]}`;
  return `with ${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/**
 * One tag on the owner's own diary entry, as the edit form lists it. Only the
 * owner reads this: an approved tag names the person's current handle, and a
 * proposal names the handle the owner typed, which is nothing new to them.
 */
export type DiaryWithTag = {
  id: string;
  handle: string;
  state: "proposed" | "approved";
};

const TAG_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Parse an untrusted diary tag list; an odd row is left out. */
export function parseDiaryWithTags(value: unknown): DiaryWithTag[] {
  if (!Array.isArray(value)) return [];
  const out: DiaryWithTag[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as { id?: unknown; handle?: unknown; state?: unknown };
    const handle = normalizeHandle(typeof row.handle === "string" ? row.handle : "");
    if (typeof row.id !== "string" || !TAG_ID_RE.test(row.id) || !handle) continue;
    if (row.state !== "proposed" && row.state !== "approved") continue;
    out.push({ id: row.id, handle, state: row.state });
    if (out.length >= WITH_TAG_MAX) break;
  }
  return out;
}

/** Parse an untrusted summary payload; anything odd reads as no tags. */
export function parseWithSummary(value: unknown): PintDropWithSummary {
  if (!value || typeof value !== "object") return EMPTY_WITH_SUMMARY;
  const raw = value as { approved?: unknown; pending?: unknown };
  const approved = Array.isArray(raw.approved)
    ? raw.approved.map(normalizeHandle).filter(Boolean).slice(0, WITH_TAG_MAX)
    : [];
  const pending =
    typeof raw.pending === "number" && Number.isInteger(raw.pending) && raw.pending > 0
      ? Math.min(raw.pending, WITH_TAG_MAX)
      : 0;
  return { approved, pending };
}
