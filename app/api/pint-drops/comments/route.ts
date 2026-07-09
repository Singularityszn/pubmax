// Comments on Pint Drops — the thread that keeps a drop's story going after the
// night (cc_plan2 §4).
//
//   GET  ?dropId=<id>                        → { comments: CommentDTO[] }  (visible only)
//   POST { dropId, handle, body, parentId? }  → { comment: CommentDTO }     (201)
//
// `parentId` (optional, issue #37) turns a comment into a one-level REPLY under
// an existing top-level comment on the SAME drop. An invalid parent (unknown /
// wrong drop / itself a reply) is a client error → 400. Omitting it (or null)
// keeps today's behaviour exactly: a top-level comment. Additive + versionless.
//
// The commenter is unauthenticated: we derive a stable `actor_hash` from the
// request IP (hashIp(clientIp(request))) for rate-limiting and future
// moderation only — it is stored, never returned. The public CommentDTO exposes
// ONLY { id, handle, body, createdAt, parentId } (see lib/commentsStore.ts toDTO).
//
// A comments API error must NOT break feed rendering: GET degrades to an empty
// list (listComments is already fail-soft), and the client treats any POST/GET
// failure as "no comments". Store choice is the usual seam: Supabase when
// configured, process-memory otherwise.

import { jsonNoStore } from "@/lib/apiResponses";
import { cleanComment, commentsStore, InvalidParentError } from "@/lib/commentsStore";
import { dropOwnerHandle, emitNotification } from "@/lib/notificationsStore";
import { filterPubliclyReadableDropIds } from "@/lib/pintDropLookup";
import { isLimited } from "@/lib/pintDrops";
import { resolveMessageHandle } from "@/lib/messageAuth";
import { gateHandleAction } from "@/lib/profileOwnership";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";
import { readString } from "@/lib/textClean";

assertServerEnv();

export async function GET(request: Request): Promise<Response> {
  const dropId = new URL(request.url).searchParams.get("dropId");
  if (!dropId) return jsonNoStore({ comments: [] }, { status: 200 });
  // F3: parent-drop visibility gate. A hidden (moderated) or non-public
  // (friends/legacy) drop must not serve its thread to this unscoped GET —
  // there is no viewer identity to gate on (true viewer-scoped gating waits
  // for Supabase Auth). A gated parent answers the SAME empty list as a drop
  // with no comments (200, never 404) so the response is not an existence
  // oracle — matching how the feed silently omits these drops.
  const readable = await filterPubliclyReadableDropIds([dropId]);
  if (readable.length === 0) return jsonNoStore({ comments: [] }, { status: 200 });
  // listComments is fail-soft (returns [] on any store error), so a comments
  // outage can never surface as a 500 that breaks the host feed.
  const comments = await commentsStore().listComments(dropId);
  return jsonNoStore({ comments }, { status: 200 });
}

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonNoStore({ error: "Malformed request body." }, { status: 400 });
  }

  const dropId = readString(body.dropId);
  if (!dropId) return jsonNoStore({ error: "Missing pint drop id." }, { status: 400 });

  // F3 write gate: mirror GET — do not accept comments on hidden/friends/legacy
  // parents. 404 matches the unknown-drop posture (no existence oracle).
  const readable = await filterPubliclyReadableDropIds([dropId]);
  if (readable.length === 0) {
    return jsonNoStore({ error: "Pint drop not found." }, { status: 404 });
  }

  // Server-authoritative validation — the client body is untrusted. Strips
  // HTML/control chars and caps length; rejects an empty/HTML-only body.
  // JWT-linked handle wins over a self-asserted body handle when signed in.
  const actorHandle = await resolveMessageHandle(request, readString(body.handle));
  const cleaned = cleanComment(actorHandle, body.body);
  if (!cleaned.ok) return jsonNoStore({ error: cleaned.error }, { status: 400 });

  const ownership = await gateHandleAction(request, cleaned.handle);
  if (!ownership.allowed) {
    return jsonNoStore({ error: ownership.error }, { status: ownership.status });
  }

  // Optional parentId → this is a one-level reply. Empty/absent means top-level
  // (today's behaviour). The store validates existence/same-drop/top-level and
  // throws InvalidParentError, which we map to a 400 below.
  const parentId = readString(body.parentId) || null;

  // actor_hash is derived here, never from the client. Used for rate-limiting
  // and future moderation; never part of the public DTO.
  const actorHash = hashIp(clientIp(request));

  // Rate-limit per drop AND per actor: the in-memory key leads with the drop so
  // one drop can't be flooded; the durable key leads with the actor so one
  // device can't spam across drops. 429 when either budget is exhausted.
  if (await isLimited(`comment:${dropId}`, `comment:${actorHash}`)) {
    return jsonNoStore({ error: "Too many comments, slow down." }, { status: 429 });
  }

  try {
    const comment = await commentsStore().addComment({
      pintDropId: dropId,
      handle: ownership.handle,
      body: cleaned.body,
      actorHash,
      parentId,
    });
    // Emit seam (best-effort): notify the drop's author that someone commented.
    // The owner handle is resolved server-side (never client-supplied); a miss
    // (demo seed / unknown id / self-comment) simply doesn't emit. Never awaited
    // for correctness — a notification failure must not fail the comment write.
    void dropOwnerHandle(dropId).then((owner) => {
      if (!owner) return;
      return emitNotification({
        recipientHandle: owner,
        actorHandle: ownership.handle,
        kind: "comment",
        subjectRef: dropId,
        subjectLabel: cleaned.body.slice(0, 80),
      });
    });
    return jsonNoStore({ comment }, { status: 201 });
  } catch (err) {
    // An invalid reply parent is a CLIENT error (400), distinct from a store
    // outage (503) — an honest failure shape so the client can tell them apart.
    if (err instanceof InvalidParentError) {
      return jsonNoStore({ error: err.message }, { status: 400 });
    }
    // A write failure is non-critical to the feed — the client treats it as
    // "comment didn't post" and keeps rendering the drop.
    return jsonNoStore({ error: "Comments are unavailable." }, { status: 503 });
  }
}
