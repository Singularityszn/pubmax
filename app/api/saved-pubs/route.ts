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

import { normalizeHandle } from "@/lib/profiles";
import { isLimited } from "@/lib/pintDrops";
import { cleanNote, isListType, savedPubsStore } from "@/lib/savedPubsStore";
import { clientIp, hashActor, hashIp } from "@/lib/supabase";

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

// venue ids are content-hashed (e.g. "venue-1ufn31x"); cap and trim, never trust
// the raw client length.
const MAX_VENUE_ID = 64;

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const handle = normalizeHandle(params.get("handle") ?? "");
  const actor = readString(params.get("actor"));
  // Nothing to key on → an empty (but valid) list, so the page still renders.
  if (!handle && !actor) return Response.json({ saved: [] }, { status: 200 });

  // listSaved is fail-soft (returns [] on any store error), so a saved-pubs
  // outage can never surface as a 500 that breaks the profile page.
  const saved = await savedPubsStore().listSaved({
    handle: handle || undefined,
    actorHash: actor ? hashActor(actor) : undefined,
  });
  return Response.json({ saved }, { status: 200 });
}

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Malformed request body." }, { status: 400 });
  }

  const handle = normalizeHandle((body.handle as string) ?? "");
  if (!handle) return Response.json({ error: "Add a contributor handle." }, { status: 400 });

  const venueId = (readString(body.venueId) ?? "").slice(0, MAX_VENUE_ID);
  if (!venueId) return Response.json({ error: "A venue is required." }, { status: 400 });

  // Server-authoritative list-type allowlist — anything off the exact list is
  // rejected here, never stored.
  const listType = body.listType;
  if (!isListType(listType)) {
    return Response.json({ error: "Unknown list type." }, { status: 400 });
  }

  // Note is untrusted free text: strip HTML/control chars and cap length.
  const note = cleanNote(body.note);

  // Rate-limit per handle AND per actor: the in-memory key leads with the handle
  // so one handle can't flood; the durable key leads with the actor (hashed IP)
  // so one device can't spam across handles. 429 when either budget is exhausted.
  const actorHash = hashIp(clientIp(request));
  if (await isLimited(`saved:${handle}`, `saved:${actorHash}`)) {
    return Response.json({ error: "Too many saves, slow down." }, { status: 429 });
  }

  // toggleSaved is fail-soft: a store error returns the current list unchanged, so
  // the client keeps its localStorage fallback in play rather than seeing a 503.
  const saved = await savedPubsStore().toggleSaved({
    handle,
    venueId,
    listType,
    ...(note ? { note } : {}),
  });
  return Response.json({ saved }, { status: 200 });
}
