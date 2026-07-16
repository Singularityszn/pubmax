import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import { getNightStoryWorkspaceResult } from "@/lib/nightMemoryStore";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  const actorId = await callerUserId(request);
  if (!actorId) return jsonNoStore({ error: "Sign in to review this Story.", code: "AUTH_REQUIRED", retryable: false }, { status: 401 });
  const { id } = await context.params;
  const result = await getNightStoryWorkspaceResult(actorId, id);
  if (result.ok) return jsonNoStore(result.value);
  if (result.error === "error") return jsonNoStore({ error: "The Story workspace is temporarily unavailable.", code: "STORY_WORKSPACE_UNAVAILABLE", retryable: true }, { status: 503 });
  if (result.error === "not_found") return jsonNoStore({ error: "That Story was not found.", code: "STORY_NOT_FOUND", retryable: false }, { status: 404 });
  return jsonNoStore({ error: "That private Story workspace is not available to this account.", code: "STORY_WORKSPACE_FORBIDDEN", retryable: false }, { status: 403 });
}
