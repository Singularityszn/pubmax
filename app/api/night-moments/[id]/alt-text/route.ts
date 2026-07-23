import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import { hasConfirmedAltText, NIGHT_MOMENT_ALT_TEXT_MAX } from "@/lib/nightMemory";
import { setMomentAltText } from "@/lib/nightMemoryStore";

type Context = { params: Promise<{ id: string }> };

/**
 * Author-confirm the alt text on the caller's OWN photo Moment (Wayfinder 5.6).
 * This is a PRIVATE authoring write — deliberately NOT behind the social freeze
 * and never a publication. Saving a non-empty description IS the confirmation;
 * saving an empty one clears it. `setMomentAltText` enforces owner + has-media.
 */
export async function PATCH(request: Request, context: Context): Promise<Response> {
  const actorId = await callerUserId(request);
  if (!actorId) return jsonNoStore({ error: "Sign in to describe your photo." }, { status: 401 });
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch {
    return jsonNoStore({ error: "Malformed request body." }, { status: 400 });
  }
  if (typeof body.altText === "string" && body.altText.length > NIGHT_MOMENT_ALT_TEXT_MAX * 4) {
    // Cheap upper bound before normalisation; cleanText applies the real cap.
    return jsonNoStore({ error: "That description is too long." }, { status: 400 });
  }
  const { id } = await context.params;
  const moment = await setMomentAltText(actorId, id, body.altText);
  return moment
    ? jsonNoStore({
        // No account/memory identifiers — mirror the other Night surfaces.
        altText: moment.altText,
        altTextConfirmed: hasConfirmedAltText(moment),
      })
    : jsonNoStore({ error: "Only the owner of a photo Moment can describe it." }, { status: 403 });
}
