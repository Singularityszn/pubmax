import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import { getNightStory } from "@/lib/nightMemoryStore";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  const story = await getNightStory(id, await callerUserId(request));
  return story
    ? jsonNoStore({ story })
    : jsonNoStore({ error: "Night Story not found." }, { status: 404 });
}
