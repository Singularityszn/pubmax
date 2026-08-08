import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import { confirmNightStoryPublication } from "@/lib/nightMemoryStore";
import { socialFreezeResponse } from "@/lib/opsFreeze";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  // Solo-operator emergency freeze (U15): confirming a Story publication is a social write.
  const frozen = socialFreezeResponse();
  if (frozen) return frozen;

  const actorId = await callerUserId(request);
  if (!actorId) return publicApiError("Sign in to confirm Story publication.", "UNAUTHENTICATED", 401);
  let body: unknown;
  try { body = await request.json(); } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }
  const { id } = await context.params;
  const story = await confirmNightStoryPublication(actorId, id, body);
  // The store re-checks consent AND the alt-text gate at confirm time (belt to the
  // propose-time braces), so a description cleared or consent withdrawn in the
  // race window still refuses here.
  return story
    ? jsonNoStore({ story })
    : publicApiError("This confirmation is invalid, expired, used, or no longer has consent and a confirmed photo description.", "CONFLICT", 409);
}
