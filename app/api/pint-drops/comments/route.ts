// Comments on Pint Drops — the thread that keeps a drop's story going after the
// night (cc_plan2 §4).
//
//   GET  ?dropId=<id>              → { comments: CommentDTO[] }  (visible only)
//   POST { dropId, handle, body }  → { comment: CommentDTO }     (201)
//
// The commenter is unauthenticated: we derive a stable `actor_hash` from the
// request IP (hashIp(clientIp(request))) for rate-limiting and future
// moderation only — it is stored, never returned. The public CommentDTO exposes
// ONLY { id, handle, body, createdAt } (see lib/commentsStore.ts toDTO).
//
// A comments API error must NOT break feed rendering: GET degrades to an empty
// list (listComments is already fail-soft), and the client treats any POST/GET
// failure as "no comments". Store choice is the usual seam: Supabase when
// configured, process-memory otherwise.

import { cleanComment, commentsStore } from "@/lib/commentsStore";
import { isLimited } from "@/lib/pintDrops";
import { clientIp, hashIp } from "@/lib/supabase";
import { readString } from "@/lib/textClean";

export async function GET(request: Request): Promise<Response> {
  const dropId = new URL(request.url).searchParams.get("dropId");
  if (!dropId) return Response.json({ comments: [] }, { status: 200 });
  // listComments is fail-soft (returns [] on any store error), so a comments
  // outage can never surface as a 500 that breaks the host feed.
  const comments = await commentsStore().listComments(dropId);
  return Response.json({ comments }, { status: 200 });
}

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Malformed request body." }, { status: 400 });
  }

  const dropId = readString(body.dropId);
  if (!dropId) return Response.json({ error: "Missing pint drop id." }, { status: 400 });

  // Server-authoritative validation — the client body is untrusted. Strips
  // HTML/control chars and caps length; rejects an empty/HTML-only body.
  const cleaned = cleanComment(body.handle, body.body);
  if (!cleaned.ok) return Response.json({ error: cleaned.error }, { status: 400 });

  // actor_hash is derived here, never from the client. Used for rate-limiting
  // and future moderation; never part of the public DTO.
  const actorHash = hashIp(clientIp(request));

  // Rate-limit per drop AND per actor: the in-memory key leads with the drop so
  // one drop can't be flooded; the durable key leads with the actor so one
  // device can't spam across drops. 429 when either budget is exhausted.
  if (await isLimited(`comment:${dropId}`, `comment:${actorHash}`)) {
    return Response.json({ error: "Too many comments, slow down." }, { status: 429 });
  }

  try {
    const comment = await commentsStore().addComment({
      pintDropId: dropId,
      handle: cleaned.handle,
      body: cleaned.body,
      actorHash,
    });
    return Response.json({ comment }, { status: 201 });
  } catch {
    // A write failure is non-critical to the feed — the client treats it as
    // "comment didn't post" and keeps rendering the drop.
    return Response.json({ error: "Comments are unavailable." }, { status: 503 });
  }
}
