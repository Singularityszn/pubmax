import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import { confirmNightStoryPublication } from "@/lib/nightMemoryStore";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  const actorId = await callerUserId(request);
  if (!actorId) return jsonNoStore({ error: "Sign in to confirm Story publication." }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch {
    return jsonNoStore({ error: "Malformed request body." }, { status: 400 });
  }
  const { id } = await context.params;
  const story = await confirmNightStoryPublication(actorId, id, body);
  return story
    ? jsonNoStore({ story })
    : jsonNoStore({ error: "This confirmation is invalid, expired, used, or no longer has consent." }, { status: 409 });
}
