import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import { createNightStory, listNightStoryInbox } from "@/lib/nightMemoryStore";
import { socialFreezeResponse } from "@/lib/opsFreeze";

export async function GET(request: Request): Promise<Response> {
  const ownerId = await callerUserId(request);
  if (!ownerId) return jsonNoStore({ error: "Sign in to view Night Stories." }, { status: 401 });
  const result = await listNightStoryInbox(ownerId);
  return result.ok
    ? jsonNoStore({ stories: result.value })
    : jsonNoStore({ error: "The Story inbox is temporarily unavailable.", code: "STORY_INBOX_UNAVAILABLE", retryable: true }, { status: 503 });
}

export async function POST(request: Request): Promise<Response> {
  // Solo-operator emergency freeze (U15): creating a Night Story is a social write.
  const frozen = socialFreezeResponse();
  if (frozen) return frozen;

  const ownerId = await callerUserId(request);
  if (!ownerId) return jsonNoStore({ error: "Sign in to create a Night Story." }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch {
    return jsonNoStore({ error: "Malformed request body." }, { status: 400 });
  }
  const story = await createNightStory(ownerId, body);
  return story
    ? jsonNoStore({ story }, { status: 201 })
    : jsonNoStore({ error: "Choose one of your Night Memories and add a title." }, { status: 400 });
}
