// Comment moderation queue for the admin console (story 37).
//   GET  ?status=hidden|pending   → { comments: ModeratorCommentDTO[] }
//   POST { action, id }           → { ok: true }   action ∈ restore | keep_hidden
//
// Same review-action shape as the Pint Drop queue (restore → visible, keep_hidden
// → hidden). Reuses the admin token gate AS-IS (x-admin-token header; see
// lib/adminAuth.ts). A comment's actor_hash is NEVER exposed — the moderator DTO
// carries only { id, pintDropId, handle, body, status, createdAt }.

import { isModerator } from "@/lib/adminAuth";
import { commentsStore } from "@/lib/commentsStore";
import { readString } from "@/lib/textClean";

function forbidden(): Response {
  return Response.json({ error: "Not authorised." }, { status: 403 });
}

export async function GET(request: Request): Promise<Response> {
  if (!isModerator(request)) return forbidden();
  const status = new URL(request.url).searchParams.get("status");
  const queue = status === "pending" ? "pending" : "hidden";
  // listForReview is fail-soft (returns [] on any store error).
  const comments = await commentsStore().listForReview(queue);
  return Response.json({ comments }, { status: 200 });
}

export async function POST(request: Request): Promise<Response> {
  if (!isModerator(request)) return forbidden();
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Malformed request body." }, { status: 400 });
  }

  const id = readString(body.id);
  if (!id) return Response.json({ error: "Missing comment id." }, { status: 400 });

  const action = readString(body.action);
  if (action !== "restore" && action !== "keep_hidden") {
    return Response.json({ error: "Unknown action." }, { status: 400 });
  }

  const status = action === "restore" ? "visible" : "hidden";
  try {
    const ok = await commentsStore().moderate(id, status);
    if (!ok) return Response.json({ error: "Comment not found." }, { status: 404 });
    return Response.json({ ok: true }, { status: 200 });
  } catch {
    return Response.json({ error: "Comment moderation is unavailable." }, { status: 503 });
  }
}
