import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import type { MomentConsentStatus } from "@/lib/nightMemory";
import { setMomentPublicationConsent } from "@/lib/nightMemoryStore";
import { cleanText } from "@/lib/textClean";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  const actorId = await callerUserId(request);
  if (!actorId) return publicApiError("Sign in to control Moment publication.", "UNAUTHENTICATED", 401);
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }
  const momentId = cleanText(body.momentId, 80);
  const status = body.status === "approved" || body.status === "withdrawn"
    ? body.status as MomentConsentStatus
    : null;
  if (!momentId || !status) return publicApiError("Choose a Moment and consent decision.", "INVALID_REQUEST", 400);
  const { id } = await context.params;
  const consent = await setMomentPublicationConsent(actorId, id, momentId, status);
  return consent
    ? jsonNoStore({ consent })
    : publicApiError("Only the Moment owner can change its publication consent.", "FORBIDDEN", 403);
}
