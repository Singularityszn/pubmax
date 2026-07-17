import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import { getNightStory, safeNightStory, updateNightStoryDraftResult } from "@/lib/nightMemoryStore";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  const story = await getNightStory(id, await callerUserId(request));
  return story
    ? jsonNoStore({ story })
    : jsonNoStore({ error: "Night Story not found." }, { status: 404 });
}

export async function PATCH(request: Request, context: Context): Promise<Response> {
  const actorId = await callerUserId(request);
  if (!actorId) return jsonNoStore({ error: "Sign in to edit this Story.", code: "AUTH_REQUIRED", retryable: false }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch {
    return jsonNoStore({ error: "Malformed request body.", code: "INVALID_JSON", retryable: false }, { status: 400 });
  }
  const { id } = await context.params;
  const result = await updateNightStoryDraftResult(actorId, id, body);
  if (result.ok) return jsonNoStore({ story: safeNightStory(result.value) });
  if (result.error === "error") return jsonNoStore({ error: "The Story store is temporarily unavailable.", code: "STORY_STORE_UNAVAILABLE", retryable: true }, { status: 503 });
  if (result.error === "not_found") return jsonNoStore({ error: "That Story was not found.", code: "STORY_NOT_FOUND", retryable: false }, { status: 404 });
  if (result.error === "invalid") return jsonNoStore({ error: "Add a valid title to an editable Story draft.", code: "STORY_DRAFT_INVALID", retryable: false }, { status: 400 });
  return jsonNoStore({ error: "Only an accepted host or editor can edit a private Story draft.", code: "STORY_EDIT_FORBIDDEN", retryable: false }, { status: 403 });
}
