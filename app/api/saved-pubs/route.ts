// Durable saved-pub LISTS for a handle (cc_plan2 §5).
//   GET  ?handle=<handle>  (or ?actor=<anonId>)  → { saved: SavedPubDTO[] }
//   POST { handle, venueId, listType, note }      → { saved: SavedPubDTO[] }  (toggles)
//
// A save is filed under a self-asserted `handle` (no auth yet): the durable store
// bootstraps a profile row for that handle and keys saves by its profile_id
// (public.saved_pubs — see lib/savedPubsStore.ts). The response DTOs carry the
// resolved venue NAME + "open on the map" url (server-side via lib/venueIndex) so
// the profile never renders a raw "venue-…" id.
//
// Store choice is the usual seam: Supabase when configured, process-memory
// otherwise. Reads NEVER 503 — a saved-pubs outage degrades to an empty list, so
// the profile page always renders. The client keeps a localStorage fallback for a
// signed-out/offline viewer (lib/savedPubs.ts), so this route only ever augments
// the demo, never gates it.

import { jsonNoStore } from "@/lib/apiResponses";
import { normalizeHandle } from "@/lib/profiles";
import { isLimited } from "@/lib/pintDrops";
import {
  cleanListType,
  cleanNote,
  isListType,
  savedListsStore,
  savedPubsStore,
} from "@/lib/savedPubsStore";
import { clientIp, hashActor, hashIp } from "@/lib/supabase";
import { readString } from "@/lib/textClean";

// venue ids are content-hashed (e.g. "venue-1ufn31x"); cap and trim, never trust
// the raw client length.
const MAX_VENUE_ID = 64;

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const handle = normalizeHandle(params.get("handle") ?? "");
  const actor = readString(params.get("actor"));

  // ?lists=1 → the handle's custom list menu (story 33). Built-ins are known to
  // the client; this returns only the handle's OWN custom lists. Fail-soft → [].
  if (params.get("lists")) {
    const lists = handle ? await savedListsStore().listCustom(handle) : [];
    return jsonNoStore({ lists }, { status: 200 });
  }

  // Nothing to key on → an empty (but valid) list, so the page still renders.
  if (!handle && !actor) return jsonNoStore({ saved: [] }, { status: 200 });

  // listSaved is fail-soft (returns [] on any store error), so a saved-pubs
  // outage can never surface as a 500 that breaks the profile page.
  const saved = await savedPubsStore().listSaved({
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
    return jsonNoStore({ error: "Malformed request body." }, { status: 400 });
  }

  const handle = normalizeHandle((body.handle as string) ?? "");
  if (!handle) return jsonNoStore({ error: "Add a contributor handle." }, { status: 400 });

  // createList action (story 33): register a custom list name for this handle so
  // it appears in the pick-UI before it has any saves. Rate-limited like saves.
  if (readString(body.action) === "createList") {
    const name = cleanListType(body.name ?? body.listType);
    if (!name) return jsonNoStore({ error: "A list name is required." }, { status: 400 });
    if (await isLimited(`lists:${handle}`, `lists:${hashIp(clientIp(request))}`)) {
      return jsonNoStore({ error: "Too many lists, slow down." }, { status: 429 });
    }
    const lists = await savedListsStore().createList(handle, name);
    return jsonNoStore({ lists }, { status: 200 });
  }

  const venueId = (readString(body.venueId) ?? "").slice(0, MAX_VENUE_ID);
  if (!venueId) return jsonNoStore({ error: "A venue is required." }, { status: 400 });

  // The list type is now free text (story 33): the seven built-ins are the
  // defaults, but a custom name is accepted too. isListType is the write gate —
  // any value that cleans to a non-empty name is storable.
  const listType = body.listType;
  if (!isListType(listType)) {
    return jsonNoStore({ error: "A list name is required." }, { status: 400 });
  }

  // Note is untrusted free text: strip HTML/control chars and cap length.
  const note = cleanNote(body.note);

  // Rate-limit per handle AND per actor: the in-memory key leads with the handle
  // so one handle can't flood; the durable key leads with the actor (hashed IP)
  // so one device can't spam across handles. 429 when either budget is exhausted.
  const actorHash = hashIp(clientIp(request));
  if (await isLimited(`saved:${handle}`, `saved:${actorHash}`)) {
    return jsonNoStore({ error: "Too many saves, slow down." }, { status: 429 });
  }

  // toggleSaved is fail-soft: a store error returns the current list unchanged, so
  // the client keeps its localStorage fallback in play rather than seeing a 503.
  const saved = await savedPubsStore().toggleSaved({
    handle,
    venueId,
    listType,
    ...(note ? { note } : {}),
  });
  return jsonNoStore({ saved }, { status: 200 });
}
