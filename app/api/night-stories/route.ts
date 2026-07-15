import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import { createNightStory } from "@/lib/nightMemoryStore";

export async function POST(request: Request): Promise<Response> {
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
