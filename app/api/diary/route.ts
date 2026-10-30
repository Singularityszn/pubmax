// The Diary, Phase 1: a drinker's own dated log of pub visits.
//
//   GET                                       -> 200 { status, entries } (owner only, newest day first;
//                                                each entry carries `withTags` when somebody is tagged);
//                                                200 { status: "adult_check_required" | ... , error } while a gate stands in front of it
//   POST { venueId, visitedOn?, rating?, review?, usualDrink?, withWho?, shareToLot? }
//                                             -> 201 { entry, shared, tagsSent? }
//   POST { action: "update", id, visitedOn?, rating?, review?, usualDrink?, withAdd?, withRemove? }
//                                             -> 200 { entry, tagsSent? } (the owner's own entry, corrected;
//                                                `withAdd` is a raw field whose @handles are proposed,
//                                                `withRemove` the ids of tags the owner takes off)
//   POST { action: "delete", id }             -> 200 { ok: true } (the owner's own entry, removed)
//
// Account-bound and PRIVATE: the owner is the authenticated account's auth user
// id, a body handle or owner field is ignored, and no route reads another
// account's entries. The venue name is the canonical name the server resolves
// for the id, never a client-typed one. A second log of the same pub on the
// same London day answers 409. A write is durably RATE LIMITED and a hard
// store failure answers 503, never a fake success. The envelope is
// publicApiError; nothing is cached.
//
// "Tell your lot": `shareToLot: true` on a NEW log, and nothing else, writes
// one mutuals-only Social post ("@x was at <pub>") in the name of the verified
// Social account of THIS session, and only when that account is the diary's
// owner (lib/tellYourLot.server.ts). The entry itself stays private either
// way, and `shared` says whether the post was written.
//
// "With" (0201): `withWho` is the raw field. Its free-text names are kept on
// the entry; each `@handle` becomes a PROPOSAL in that person's tag inbox
// (lib/pintDropWithTagsStore.ts), made in the name of the same verified Social
// account and refused silently across a block. `tagsSent` is false only when
// this account has no verified Social account to ask from, or the tag store is
// down; it never says whether a particular person could be tagged.

import { jsonNoStore } from "@/lib/apiResponses";
import { publicApiError } from "@/lib/apiError";
import { contributionReadRefusalResponse } from "@/lib/contributionReadRefusal.server";
import { resolveContributionIdentity } from "@/lib/contributionIdentity.server";
import { validateDiaryEntryCreate, validateDiaryEntryEdit, type DiaryEntryDTO } from "@/lib/diary";
import { diaryStore } from "@/lib/diaryStore";
import { log } from "@/lib/log";
import { isLimited } from "@/lib/pintDrops";
import {
  splitWithInput,
  WITH_TAG_MAX,
  type DiaryWithTag,
  type PintDropWithSummary,
} from "@/lib/pintDropWithTags";
import { pintDropWithTagsStore } from "@/lib/pintDropWithTagsStore";
import { clientIp, hashIp } from "@/lib/supabase";
import { readString } from "@/lib/textClean";
import {
  lotActorForAccount,
  readShareToLot,
  tellYourLot,
  tellYourLotVisitBody,
} from "@/lib/tellYourLot.server";
import { lookupCanonicalVenue } from "@/lib/venueIndex";
import { isPubVenueKind } from "@/lib/venueKindFilters";

export const runtime = "nodejs";

const CREATE_WINDOW_MS = 60_000;

// An entry id is a uuid column, so anything else is an entry that does not
// exist. Asked of PostgreSQL it is a 22P02 refusal, which would surface as a
// retryable 503 logged as an outage; it is a plain 404 instead.
const DIARY_ENTRY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function parseJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed = (await request.json()) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request): Promise<Response> {
  const owner = await resolveContributionIdentity(request);
  // A gate (age, handle) in front of your own diary is data, not an error.
  if (!owner.ok) return contributionReadRefusalResponse(owner);

  try {
    const result = await diaryStore().listForOwner(owner.accountId);
    const entries = await withTagsOn(owner.accountId, result.entries);
    return jsonNoStore({ ...result, entries }, { status: 200 });
  } catch (err) {
    log("error", "diary.list_failed", {
      route: "GET /api/diary",
      error: err instanceof Error ? err.message : String(err),
    });
    return publicApiError("Storage is unavailable.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }
}

// The owner's own read of who they tagged. A failure reads as no tags, so the
// diary itself never fails because the tag store is down. The line (`withTags`)
// and the edit form's list (`withTagList`) are read apart, so a failure of one
// never takes the other with it.
async function withTagsOn(ownerUserId: string, entries: DiaryEntryDTO[]): Promise<DiaryEntryDTO[]> {
  if (entries.length === 0) return entries;
  const ids = entries.map((entry) => entry.id);
  const store = pintDropWithTagsStore();
  const [summaries, lists] = await Promise.all([
    store.diarySummaries(ownerUserId, ids).catch((err: unknown) => {
      log("warn", "diary.with_tags_read_failed", {
        route: "GET /api/diary",
        error: err instanceof Error ? err.message : String(err),
      });
      return new Map<string, PintDropWithSummary>();
    }),
    Promise.resolve()
      .then(() => store.diaryTagList(ownerUserId, ids))
      .catch(() => new Map<string, DiaryWithTag[]>()),
  ]);
  if (summaries.size === 0 && lists.size === 0) return entries;
  return entries.map((entry) => {
    const withTags = summaries.get(entry.id);
    const withTagList = lists.get(entry.id);
    return {
      ...entry,
      ...(withTags ? { withTags } : {}),
      ...(withTagList?.length ? { withTagList } : {}),
    };
  });
}

/** Tag ids the owner took off, or null when the field is not a list of ids. */
function readWithRemove(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > WITH_TAG_MAX) return null;
  return value.every((id) => typeof id === "string" && DIARY_ENTRY_ID.test(id)) ? (value as string[]) : null;
}

// "With" on an edit: each new `@handle` is a proposal through the one consent
// path, each removed tag is the owner's cancel. The tags are asked in the name
// of the session's own Social account, checked against the diary's owner, as
// at creation. False when there is no such account or the store is down.
async function editTags(
  request: Request,
  ownerUserId: string,
  entryId: string,
  change: { add: string[]; remove: string[] },
): Promise<boolean> {
  const actor = await lotActorForAccount(request, ownerUserId);
  if (!actor) return false;
  try {
    await pintDropWithTagsStore().editDiaryTags(
      { profileId: actor.profileId, handle: actor.handle, accountId: ownerUserId },
      entryId,
      change,
    );
    return true;
  } catch (err) {
    log("warn", "diary.with_tags_edit_failed", {
      route: "POST /api/diary",
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/** The raw "With" field: text of at most 400 characters, or absent. */
function readWithWho(value: unknown): string | null {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" || value.length > 400) return null;
  return value;
}

// A correction or a removal is the owner's own business and nobody else's: the
// row is found by its id AND the account the session names, so another
// account's entry answers 404 exactly as a missing one does.
async function correctOwnEntry(
  request: Request,
  body: Record<string, unknown>,
  ownerUserId: string,
): Promise<Response> {
  const id = readString(body.id);
  if (!id || !DIARY_ENTRY_ID.test(id)) return publicApiError("Diary entry not found.", "NOT_FOUND", 404);

  const withAdd = readWithWho(body.withAdd);
  const withRemove = readWithRemove(body.withRemove);
  if (withAdd === null || withRemove === null) {
    return publicApiError("Type the handles of who you were with.", "INVALID_DIARY_ENTRY", 400);
  }
  const tagChange = { add: splitWithInput(withAdd).handles, remove: withRemove };
  const changesTags = tagChange.add.length > 0 || tagChange.remove.length > 0;
  const changesFields = [body.visitedOn, body.rating, body.review, body.usualDrink].some(
    (field) => field !== undefined,
  );

  const result = changesFields || !changesTags
    ? validateDiaryEntryEdit({
        visitedOn: body.visitedOn,
        rating: body.rating,
        review: body.review,
        usualDrink: body.usualDrink,
      })
    : null;
  if (result && !result.ok) {
    return publicApiError(result.error, "INVALID_DIARY_ENTRY", 400);
  }

  try {
    let entry: DiaryEntryDTO;
    if (result) {
      const updated = await diaryStore().update(ownerUserId, id, result.value);
      if (updated.status === "not_found") {
        return publicApiError("Diary entry not found.", "NOT_FOUND", 404);
      }
      if (updated.status === "duplicate") {
        return publicApiError(
          "You already logged this pub for that day.",
          "DIARY_ENTRY_EXISTS",
          409,
        );
      }
      entry = updated.entry;
    } else {
      // A change of tags alone still finds the row by its id AND the account.
      const found = await diaryStore().get(id);
      if (!found || found.ownerUserId !== ownerUserId) {
        return publicApiError("Diary entry not found.", "NOT_FOUND", 404);
      }
      entry = found;
    }
    if (!changesTags) return jsonNoStore({ entry }, { status: 200 });
    const tagsSent = await editTags(request, ownerUserId, id, tagChange);
    const [withTagged] = await withTagsOn(ownerUserId, [entry]);
    return jsonNoStore({ entry: withTagged ?? entry, tagsSent }, { status: 200 });
  } catch (err) {
    log("error", "diary.update_failed", {
      route: "POST /api/diary",
      error: err instanceof Error ? err.message : String(err),
    });
    return publicApiError("Storage is unavailable. Try again shortly.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }
}

async function removeOwnEntry(
  body: Record<string, unknown>,
  ownerUserId: string,
): Promise<Response> {
  const id = readString(body.id);
  if (!id || !DIARY_ENTRY_ID.test(id)) return publicApiError("Diary entry not found.", "NOT_FOUND", 404);

  try {
    const removed = await diaryStore().delete(ownerUserId, id);
    return removed
      ? jsonNoStore({ ok: true }, { status: 200 })
      : publicApiError("Diary entry not found.", "NOT_FOUND", 404);
  } catch (err) {
    log("error", "diary.delete_failed", {
      route: "POST /api/diary",
      error: err instanceof Error ? err.message : String(err),
    });
    return publicApiError("Storage is unavailable. Try again shortly.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }
}

export async function POST(request: Request): Promise<Response> {
  const body = await parseJson(request);
  if (!body) {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }

  const owner = await resolveContributionIdentity(request);
  if (!owner.ok) return jsonNoStore(owner.body, { status: owner.httpStatus });

  const ipHash = hashIp(clientIp(request));
  const key = `diary:${owner.actor}:${ipHash}`;
  if (await isLimited(key, key, undefined, CREATE_WINDOW_MS)) {
    return publicApiError("Too many submissions, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
    });
  }

  // Correcting or removing an entry is the owner's own, and carries no venue.
  const action = readString(body.action);
  if (action === "update") return correctOwnEntry(request, body, owner.accountId);
  if (action === "delete") return removeOwnEntry(body, owner.accountId);

  const shareToLot = readShareToLot(body.shareToLot);
  if (shareToLot === null) {
    return publicApiError("Say yes or no to telling your lot.", "INVALID_DIARY_ENTRY", 400);
  }
  const withWho = readWithWho(body.withWho);
  if (withWho === null) {
    return publicApiError("Type the names of who you were with.", "INVALID_DIARY_ENTRY", 400);
  }
  const withHandles = splitWithInput(withWho).handles;

  const venueId = readString(body.venueId);
  const lookup = venueId ? await lookupCanonicalVenue(venueId) : null;
  // An outage of the venue index is not the drinker's mistake: say so, and let
  // the client retry, rather than call a valid pub invalid.
  if (lookup?.status === "unavailable") {
    return publicApiError("Pubs are unavailable right now. Try again shortly.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }
  const venue = lookup?.status === "found" ? lookup.venue : null;
  if (!venue || !isPubVenueKind(venue.kind)) {
    return publicApiError("Pick a pub from the map.", "INVALID_DIARY_ENTRY", 400);
  }

  const result = validateDiaryEntryCreate({
    ownerUserId: owner.accountId,
    venueId: venue.id,
    venueName: venue.name,
    visitedOn: body.visitedOn,
    rating: body.rating,
    review: body.review,
    usualDrink: body.usualDrink,
    withWho,
    visibility: body.visibility,
  });
  if (!result.ok) {
    return publicApiError(result.error, "INVALID_DIARY_ENTRY", 400);
  }

  try {
    const created = await diaryStore().create(result.value);
    if (created.status === "duplicate") {
      return publicApiError(
        "You already logged this pub for that day.",
        "DIARY_ENTRY_EXISTS",
        409,
      );
    }
    let shared = false;
    // The author of a lot post and of a tag is the session's own Social
    // account, checked against the diary's owner. A body handle or owner
    // field never names it.
    const actor =
      shareToLot || withHandles.length > 0 ? await lotActorForAccount(request, owner.accountId) : null;
    if (shareToLot && actor) {
      shared = await tellYourLot(actor, {
        body: tellYourLotVisitBody(actor.handle, venue.name),
        venueId: venue.id,
      });
    }
    let tagsSent: boolean | undefined;
    if (withHandles.length > 0) {
      tagsSent = false;
      if (actor) {
        try {
          await pintDropWithTagsStore().proposeOnDiary(
            { profileId: actor.profileId, handle: actor.handle, accountId: owner.accountId },
            created.entry.id,
            withHandles,
          );
          tagsSent = true;
        } catch (err) {
          log("warn", "diary.with_tags_propose_failed", {
            route: "POST /api/diary",
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
    return jsonNoStore(
      { entry: created.entry, shared, ...(tagsSent === undefined ? {} : { tagsSent }) },
      { status: 201 },
    );
  } catch (err) {
    log("error", "diary.create_failed", {
      route: "POST /api/diary",
      error: err instanceof Error ? err.message : String(err),
    });
    return publicApiError("Storage is unavailable. Try again shortly.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }
}
