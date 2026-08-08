import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import { addStoryMoment } from "@/lib/nightMemoryStore";
import { socialFreezeResponse } from "@/lib/opsFreeze";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  // Solo-operator emergency freeze (U15): contributing a Story Moment is a social write.
  const frozen = socialFreezeResponse();
  if (frozen) return frozen;

  const actorId = await callerUserId(request);
  if (!actorId) return publicApiError("Sign in to contribute a Night Moment.", "UNAUTHENTICATED", 401);
  let body: unknown;
  try { body = await request.json(); } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }
  const { id } = await context.params;
  const moment = await addStoryMoment(actorId, id, body);
  return moment
    ? jsonNoStore({ moment }, { status: 201 })
    : publicApiError("Accept the Story invitation before contributing.", "FORBIDDEN", 403);
}
