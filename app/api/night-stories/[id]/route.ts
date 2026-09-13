import { publicApiError } from "@/lib/apiError";
import { clientIp, hashIp } from "@/lib/supabase";
import { isLimited } from "@/lib/pintDrops";
import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import { readNightStory, safeNightStory, updateNightStoryDraftResult } from "@/lib/nightMemoryStore";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  const read = await readNightStory(id, await callerUserId(request));
  if (read.status === "unavailable") {
    return publicApiError("The Story store is temporarily unavailable.", "STORY_STORE_UNAVAILABLE", 503, { retryable: true });
  }
  if (read.status === "absent") return publicApiError("Night Story not found.", "NOT_FOUND", 404);
  return jsonNoStore({ story: read.story });
}

export async function PATCH(request: Request, context: Context): Promise<Response> {
  const limiterKey = `night-story-edit:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, 30)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const actorId = await callerUserId(request);
  if (!actorId) return publicApiError("Sign in to edit this Story.", "AUTH_REQUIRED", 401);
  let body: unknown;
  try { body = await request.json(); } catch {
    return publicApiError("Malformed request body.", "INVALID_JSON", 400);
  }
  const { id } = await context.params;
  const result = await updateNightStoryDraftResult(actorId, id, body);
  if (result.ok) return jsonNoStore({ story: safeNightStory(result.value) });
  if (result.error === "error") return publicApiError("The Story store is temporarily unavailable.", "STORY_STORE_UNAVAILABLE", 503, { retryable: true });
  if (result.error === "not_found") return publicApiError("That Story was not found.", "STORY_NOT_FOUND", 404);
  if (result.error === "invalid") return publicApiError("Add a valid title to an editable Story draft.", "STORY_DRAFT_INVALID", 400);
  return publicApiError("Only an accepted host or editor can edit a private Story draft.", "STORY_EDIT_FORBIDDEN", 403);
}
