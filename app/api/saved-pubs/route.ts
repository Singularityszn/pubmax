// Durable saved-pub LISTS for a handle (cc_plan2 §5).
//   GET  ?handle=<handle>  (or ?actor=<anonId>)  → { saved: SavedPubDTO[] }
//   POST { handle, venueId, listType, note }      → { saved: SavedPubDTO[] }  (toggles)
//   POST { handle, action: "carryBeenHere", venueIds }
//        → { saved, carried, refused }  (adds to "Been here", signed in only)
//
// A save is filed under a handle. The durable store keys saves by the profile_id
// of a row that already exists (public.saved_pubs, see lib/savedPubsStore.ts)
// and does not mint one. The response DTOs carry the resolved venue NAME and
// "open on the map" url (server-side via lib/venueIndex) so
// the profile never renders a raw "venue-…" id.
//
// Store choice is the usual seam: Supabase when configured, process-memory
// otherwise. Reads NEVER 503 — a saved-pubs outage degrades to an empty list, so
// the profile page always renders. The client keeps a localStorage fallback for a
// signed-out/offline viewer (lib/savedPubs.ts), so this route only ever augments
// the demo, never gates it.

import { publicApiError, publicApiErrorFromStatus } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { resolveMessageHandle } from "@/lib/messageAuth";
import { normalizeHandle } from "@/lib/profiles";
import { callerOwnedWithdrawnHandle, gateHandleAction, gateHasVerifiedActor } from "@/lib/profileOwnership";
import { profileStore } from "@/lib/profileStore";
import { isLimited } from "@/lib/pintDrops";
import { isListTypeEligibleForVenue } from "@/lib/savedListPolicy";
import {
  BEEN_HERE_CARRY_ACTION,
  BEEN_HERE_CARRY_MAX,
  BEEN_HERE_LIST,
  parseBeenHereVenueIds,
} from "@/lib/beenHere";
import { assertServerEnv } from "@/lib/serverEnv";
import {
  cleanListType,
  cleanNote,
  savedListsStore,
  savedPubsStore,
} from "@/lib/savedPubsStore";
import { clientIp, hashActor, hashIp, isSupabaseConfigured } from "@/lib/supabase";
import { readString } from "@/lib/textClean";
import { resolveVenue } from "@/lib/venueIndex";

assertServerEnv();

// venue ids are content-hashed (e.g. "venue-1ufn31x"); cap and trim, never trust
// the raw client length.
const MAX_VENUE_ID = 64;

const SAVE_HANDLE_LIMIT = 8;
const SAVE_ACTOR_LIMIT = 8;
const SAVE_RATE_WINDOW_MS = 60_000;
const LIST_HANDLE_LIMIT = 8;
const LIST_ACTOR_LIMIT = 8;
const LIST_RATE_WINDOW_MS = 60_000;

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const handle = normalizeHandle(params.get("handle") ?? "");
  const actor = readString(params.get("actor"));

  // ?lists=1 → the handle's custom list menu (story 33). Built-ins are known to
  // the client; this returns only the handle's OWN custom lists. Fail-soft → [].
  const ownHandle = await callerOwnedWithdrawnHandle(request, handle);
  if (params.get("lists")) {
    const lists = handle ? await savedListsStore(ownHandle).listCustom(handle) : [];
    return jsonNoStore({ lists }, { status: 200 });
  }

  // Nothing to key on → an empty (but valid) list, so the page still renders.
  if (!handle && !actor) return jsonNoStore({ saved: [] }, { status: 200 });

  // listSaved is fail-soft (returns [] on any store error), so a saved-pubs
  // outage can never surface as a 500 that breaks the profile page.
  const saved = await savedPubsStore(ownHandle).listSaved({
    handle: handle || undefined,
    actorHash: actor ? hashActor(actor) : undefined,
  });
  return jsonNoStore({ saved }, { status: 200 });
}

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }

  const handle = await resolveMessageHandle(request, readString(body.handle));
  if (!handle) return publicApiError("Add a contributor handle.", "INVALID_REQUEST", 400);

  const ownership = await gateHandleAction(request, handle);
  if (!ownership.allowed) {
    return publicApiErrorFromStatus(ownership.error, ownership.status);
  }

  // A durable save hangs off a profile row. A signed-in author's row was
  // created, owned, by the gate. An anonymous save may only use a row that
  // already exists: minting one would leave it unowned, and an unowned row is
  // frozen against the account that later claims the handle. Keyless dev keeps
  // the memory store, which has no profile row to mint.
  if (isSupabaseConfigured() && !gateHasVerifiedActor(ownership)) {
    let existing;
    try {
      existing = await profileStore().getByHandle(ownership.handle);
    } catch {
      return publicApiError("Profile storage is unavailable.", "STORE_UNAVAILABLE", 503, {
        retryable: true,
      });
    }
    if (!existing) return publicApiError("Profile not found.", "NOT_FOUND", 404);
  }

  // createList action (story 33): register a custom list name for this handle so
  // it appears in the pick-UI before it has any saves. Rate-limited like saves.
  if (readString(body.action) === "createList") {
    const name = cleanListType(body.name ?? body.listType);
    if (!name) return publicApiError("Add a list name.", "INVALID_REQUEST", 400);
    const listActorHash = hashIp(clientIp(request));
    if (
      (await isLimited(
        `lists:${ownership.handle}`,
        `lists:${ownership.handle}`,
        LIST_HANDLE_LIMIT,
        LIST_RATE_WINDOW_MS,
      )) ||
      (await isLimited(
        `lists:${listActorHash}`,
        `lists:${listActorHash}`,
        LIST_ACTOR_LIMIT,
        LIST_RATE_WINDOW_MS,
      ))
    ) {
      return publicApiError("Too many lists, slow down.", "RATE_LIMITED", 429, { retryable: true });
    }
    const lists = await savedListsStore().createList(ownership.handle, name);
    return jsonNoStore({ lists }, { status: 200 });
  }

  if (readString(body.action) === BEEN_HERE_CARRY_ACTION) {
    return carryBeenHere(request, ownership, body.venueIds);
  }

  const venueId = (readString(body.venueId) ?? "").slice(0, MAX_VENUE_ID);
  if (!venueId) return publicApiError("Choose a venue.", "INVALID_REQUEST", 400);

  const listType = cleanListType(body.listType);
  if (!listType) {
    return publicApiError("Add a list name.", "INVALID_REQUEST", 400);
  }
  const venue = await resolveVenue(venueId);
  if (!isListTypeEligibleForVenue(listType, venue?.kind)) {
    return publicApiError("Choose a list that matches this venue.", "INVALID_REQUEST", 400);
  }

  // Note is untrusted free text: strip HTML/control chars and cap length.
  const note = cleanNote(body.note);

  if (await savesLimited(request, ownership.handle)) return tooManySaves();

  // toggleSaved is fail-soft: a store error returns the current list unchanged, so
  // the client keeps its localStorage fallback in play rather than seeing a 503.
  const saved = await savedPubsStore().toggleSaved({
    handle: ownership.handle,
    venueId,
    listType,
    ...(note ? { note } : {}),
  });
  return jsonNoStore({ saved }, { status: 200 });
}

function tooManySaves(): Response {
  return publicApiError("Too many saves, slow down.", "RATE_LIMITED", 429, { retryable: true });
}

// Rate-limit per handle AND per actor (two independent budgets). The handle
// cap stops one profile flooding; the actor cap stops one device spamming
// across handles. True when either budget is exhausted.
async function savesLimited(request: Request, handle: string): Promise<boolean> {
  const actorHash = hashIp(clientIp(request));
  return (
    (await isLimited(`saved:${handle}`, `saved:${handle}`, SAVE_HANDLE_LIMIT, SAVE_RATE_WINDOW_MS)) ||
    (await isLimited(`saved:${actorHash}`, `saved:${actorHash}`, SAVE_ACTOR_LIMIT, SAVE_RATE_WINDOW_MS))
  );
}

// carryBeenHere (lib/beenHere.ts): the first-run card's taps, moved to the
// signed-in account in ONE request, so a dozen taps spend one save from the
// budget above rather than meeting its per-minute cap. It ADDS and never
// toggles (ensureSaved), so a repeat after a lost answer cannot take a pub
// back off. Only "Been here" is reachable through it, and only for a verified
// account: the taps belong to a person, and the demo path has no person.
// `carried` and `refused` echo the ids as they were sent, so the device can
// clear exactly what this answer settled.
async function carryBeenHere(
  request: Request,
  ownership: { handle: string; callerUserId: string | null },
  rawVenueIds: unknown,
): Promise<Response> {
  if (!ownership.callerUserId?.trim()) {
    return publicApiError("Sign in to keep these on your account.", "UNAUTHENTICATED", 401);
  }
  const venueIds = parseBeenHereVenueIds(rawVenueIds);
  if (!venueIds) {
    return publicApiError(`Send between 1 and ${BEEN_HERE_CARRY_MAX} pubs.`, "INVALID_REQUEST", 400);
  }
  if (await savesLimited(request, ownership.handle)) return tooManySaves();

  let profileId: string;
  try {
    profileId = (await profileStore().getByHandle(ownership.handle))?.id ?? "";
  } catch {
    return publicApiError("Profile storage is unavailable.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }
  if (!profileId) return publicApiError("Profile not found.", "NOT_FOUND", 404);

  const carried: string[] = [];
  const refused: string[] = [];
  const store = savedPubsStore();
  for (const venueId of venueIds) {
    const venue = await resolveVenue(venueId);
    if (!venue || !isListTypeEligibleForVenue(BEEN_HERE_LIST, venue.kind)) {
      refused.push(venueId);
      continue;
    }
    const { outcome } = await store.ensureSaved({
      profileId,
      handle: ownership.handle,
      venueId,
      listType: BEEN_HERE_LIST,
    });
    if (outcome === "unavailable") {
      // Nothing is lost: every add is idempotent, so the device keeps its set
      // and asks again on the next visit.
      return publicApiError("Saved lists are unavailable right now.", "STORE_UNAVAILABLE", 503, {
        retryable: true,
      });
    }
    carried.push(venueId);
  }
  const saved = await savedPubsStore(ownership.handle).listSaved({ handle: ownership.handle });
  return jsonNoStore({ saved, carried, refused }, { status: 200 });
}
