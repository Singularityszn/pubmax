// Durable pub-native reactions on pint drops.
//   GET  ?ids=a,b,c&actor=<anonId>  → { summaries: { [dropId]: {counts, mine} } }
//   POST { id, actor, reaction }     → { summary: {counts, mine} }  (toggles)
//
// The actor is the viewer's opaque device id (lib/anonId.ts); we hash it here
// (hashActor) so the raw id never lands in a table. A reaction on a drop that
// isn't persisted (a demo seed) answers 404 (UnknownDropError) — the client
// keeps its local-only toggle for sample cards. Store choice is the usual seam:
// Supabase when configured, process-memory otherwise (reactions are non-critical,
// so there is no 503 — an unconfigured prod just gets per-instance counts).

import { isLimited } from "@/lib/pintDrops";
import {
  isReactionKey,
  memoryReactionsStore,
  supabaseReactionsStore,
  UnknownDropError,
  type ReactionsStore,
} from "@/lib/reactionsStore";
import { hashActor, isSupabaseConfigured } from "@/lib/supabase";
import { readString } from "@/lib/textClean";

function store(): ReactionsStore {
  return isSupabaseConfigured() ? supabaseReactionsStore : memoryReactionsStore;
}

// Cap how many drops one feed page can summarise in a single request.
const MAX_IDS = 100;

// Reactions are lightweight toggles, so the flood guard is deliberately
// generous: many per feed page is normal, only a hammering actor should trip it.
const REACTION_LIMIT = 40;
const REACTION_WINDOW_MS = 60_000;

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const ids = (params.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_IDS);
  if (ids.length === 0) return Response.json({ summaries: {} }, { status: 200 });

  const actorHash = hashActor(params.get("actor"));
  try {
    return Response.json({ summaries: await store().summarize(ids, actorHash) }, { status: 200 });
  } catch {
    // Reactions are best-effort — an empty map keeps the feed rendering.
    return Response.json({ summaries: {} }, { status: 200 });
  }
}

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Malformed request body." }, { status: 400 });
  }

  const id = readString(body.id);
  const reaction = body.reaction;
  if (!id) return Response.json({ error: "Missing pint drop id." }, { status: 400 });
  if (!isReactionKey(reaction)) {
    return Response.json({ error: "Unknown reaction." }, { status: 400 });
  }

  const actorHash = hashActor(readString(body.actor));

  // Flood guard per hashed actor. Mirrors comments/saved-pubs, but with a
  // generous budget (reactions are cheap toggles — a normal feed page fires
  // several). 429 only once one actor blows past REACTION_LIMIT in the window.
  if (
    await isLimited(`reaction:${actorHash}`, `reaction:${actorHash}`, REACTION_LIMIT, REACTION_WINDOW_MS)
  ) {
    return Response.json({ error: "Too many reactions, slow down." }, { status: 429 });
  }

  try {
    const summary = await store().toggle(id, actorHash, reaction);
    return Response.json({ summary }, { status: 200 });
  } catch (err) {
    if (err instanceof UnknownDropError) {
      // A demo/sample drop isn't persisted — tell the client to keep it local.
      return Response.json({ error: "Pint drop not found." }, { status: 404 });
    }
    return Response.json({ error: "Reactions are unavailable." }, { status: 503 });
  }
}
