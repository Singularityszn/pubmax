// What a GROUP thread is, said once, in a pure leaf.
//
// A conversation used to be a PAIR and nothing else: two `not null` columns, a
// unique index over them, and a store interface whose own type said
// `HandlePair`. This module is the other half of the vocabulary - the caps, the
// naming and the words - and it imports nothing but the handle alphabet and the
// text cleaner, so a browser bundle that needs a group's name pulls no store,
// no venue index and no Supabase client behind it.
//
// THE FOUR RULES THIS FILE OWNS
//
// 1. A GROUP IS OPENED WHOLE. The members are named when it is created and the
//    creator is one of them. Adding somebody later is a different question (who
//    may add, what the newcomer reads, what the thread says about it) and it is
//    deliberately not answered here; see docs/adr/0015-group-message-threads.md.
//
// 2. THREE PEOPLE MINIMUM, AND THAT IS NOT AN ARBITRARY FLOOR. Two people in a
//    group is a DM wearing a title, and it would be a SECOND row for a pair the
//    direct lane already keys uniquely - so one pair could hold two threads and
//    a reader would have to guess which one a reply landed in.
//
// 3. A NAME IS NEVER INVENTED. A group with no title reads as the people in it,
//    in the order the membership answered, with the viewer left out because a
//    thread does not need to tell somebody they are in it. A title that cleans
//    to nothing is no title, never a blank heading.
//
// 4. ANYBODY MAY LEAVE. A thread whose membership can only grow is worse than
//    one that never existed, so leaving is part of the vocabulary rather than a
//    follow-up: `GROUP_LEFT_LINE` is what a leaver is told and
//    `GROUP_MEMBER_FLOOR_LINE` is what stops the last few being stranded.

import { normalizeHandle } from "@/lib/handleNormalize";
import { cleanText } from "@/lib/textClean";

/** The closed set. A conversation is one of exactly these. */
const CONVERSATION_KINDS = ["direct", "group"] as const;
export type ConversationKind = (typeof CONVERSATION_KINDS)[number];

export function isConversationKind(value: unknown): value is ConversationKind {
  return (
    typeof value === "string" &&
    (CONVERSATION_KINDS as readonly string[]).includes(value)
  );
}

/**
 * The floor is THREE, counting the person who opened it (see rule 2). The
 * ceiling is a room, not a broadcast: past a dozen people a thread stops being
 * a night out being arranged and starts being a channel, which is a different
 * product with different moderation.
 */
export const GROUP_MIN_MEMBERS = 3;
export const GROUP_MAX_MEMBERS = 12;

/** Mirrors the `conversations_title_len_chk` CHECK in migration 0155. */
export const GROUP_TITLE_MAX = 60;

/** What a member may be. `owner` is who opened it; nothing branches on it yet. */
export type GroupMemberRole = "owner" | "member";

/**
 * Clean an untrusted group title. Returns null when nothing survives, which is
 * a real answer: a group with no title reads as its people (see
 * `groupThreadName`) rather than as a blank heading.
 */
export function cleanGroupTitle(input: unknown): string | null {
  const cleaned = cleanText(input, GROUP_TITLE_MAX);
  return cleaned ? cleaned : null;
}

/**
 * Turn a creator plus a list of untrusted invitees into the group's membership.
 *
 * The creator is ALWAYS in it and always first, because the row that opens a
 * thread is the row that owns it. Everything else is normalised through the one
 * handle alphabet, de-duplicated (naming somebody twice is one person), and the
 * creator is removed from the invited list before being put back at the head so
 * inviting yourself is not a way to spend a seat twice.
 *
 * Returns null when the result is outside the caps - the caller turns that into
 * one refusal rather than guessing which end it fell off.
 */
export function normalizeGroupMembers(
  creator: unknown,
  invited: unknown,
): string[] | null {
  const owner = normalizeHandle(creator);
  if (!owner) return null;
  if (!Array.isArray(invited)) return null;
  const seen = new Set<string>([owner]);
  const members: string[] = [owner];
  for (const candidate of invited) {
    const handle = normalizeHandle(candidate);
    if (!handle || seen.has(handle)) continue;
    seen.add(handle);
    members.push(handle);
    // Stop at the ceiling rather than collecting an unbounded list first: the
    // body is untrusted and a thousand handles is a thousand profile reads.
    if (members.length > GROUP_MAX_MEMBERS) return null;
  }
  if (members.length < GROUP_MIN_MEMBERS) return null;
  return members;
}

/**
 * True when `handle` is one of this membership. Both sides normalise, so "@Ken"
 * matches a stored "ken" exactly as the pair check does.
 */
export function isGroupMember(
  handles: readonly string[],
  handle: string,
): boolean {
  const h = normalizeHandle(handle);
  if (!h) return false;
  return handles.some((member) => normalizeHandle(member) === h);
}

/**
 * What a group is CALLED on a screen.
 *
 * The title when it has one. Otherwise the other people in it, because a thread
 * does not need to tell somebody they are in it, and a list of names is a
 * truthful name where "Group" is not. Past `NAMED_IN_TITLE` the rest are
 * counted rather than listed, so an inbox row cannot become a paragraph.
 */
const NAMED_IN_TITLE = 3;

export function groupThreadName(
  title: string | null | undefined,
  handles: readonly string[],
  viewer: string,
): string {
  const cleanTitle = typeof title === "string" ? title.trim() : "";
  if (cleanTitle) return cleanTitle;
  const me = normalizeHandle(viewer);
  const others = handles
    .map((handle) => normalizeHandle(handle))
    .filter((handle) => handle && handle !== me);
  if (others.length === 0) return GROUP_EMPTY_NAME;
  const named = others.slice(0, NAMED_IN_TITLE).map((handle) => `@${handle}`);
  const rest = others.length - named.length;
  return rest > 0 ? `${named.join(", ")} +${rest}` : named.join(", ");
}

/** A group with nobody else left in it. Says so rather than printing nothing. */
export const GROUP_EMPTY_NAME = "Just you now";

/** How many people, as a sentence fragment a heading can carry. */
export function groupMemberCountLine(count: number): string {
  return count === 1 ? "1 person" : `${count} people`;
}

// ── Copy ─────────────────────────────────────────────────────────────────────
// Every refusal says what to do next, and none of them names plumbing.

export const GROUP_CREATE_LABEL = "New group";
export const GROUP_CREATE_HEADING = "Start a group";
export const GROUP_TITLE_LABEL = "Name it (optional)";
export const GROUP_TITLE_PLACEHOLDER = "Friday session";

export const GROUP_TOO_SMALL_LINE =
  "A group needs at least three people, you included. Add another handle.";
export const GROUP_TOO_LARGE_LINE =
  "A group holds twelve people at most. Take one off the list.";
export const GROUP_MEMBER_UNKNOWN_LINE = "We couldn't find one of those handles.";

export const GROUP_LEAVE_LABEL = "Leave group";
export const GROUP_LEFT_LINE = "You've left this group.";
export const GROUP_LEAVE_FAILED_LINE = "Couldn't leave that group. Try again.";
/**
 * The last two people in a group are a DM with extra steps, so leaving is
 * refused there rather than silently leaving one person talking to a wall.
 */
export const GROUP_MEMBER_FLOOR_LINE =
  "A group needs three people. Message them one to one instead.";

export const GROUP_EMPTY_THREAD_LINE = "Say something. Everybody here sees it.";
