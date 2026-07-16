import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import { createNightMemoryFromPlanRecap } from "@/lib/nightMemoryStore";
import { isPlanId } from "@/lib/plan";
import { planMemberCapability } from "@/lib/planMemberCapability";
import { planCompletionResult, planMemberIdentityResult } from "@/lib/planStore";
import { validatePendingPlanRecap } from "@/lib/planRecap";

type Context = { params: Promise<{ id: string }> };

function error(error: string, code: string, status: number, retryable = false): Response {
  return jsonNoStore({ error, code, retryable }, { status });
}

export async function POST(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  if (!isPlanId(id)) return error("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404);
  const ownerId = await callerUserId(request);
  if (!ownerId) return error("Sign in to save this private recap.", "AUTH_REQUIRED", 401);

  let raw: Record<string, unknown>;
  try { raw = await request.json() as Record<string, unknown>; } catch {
    return error("Malformed request body.", "INVALID_JSON", 400);
  }
  const memberToken = planMemberCapability(request, raw.memberToken);
  const recap = validatePendingPlanRecap(raw.recap);
  if (!memberToken || !recap || recap.planId !== id) {
    return error("Add the valid Plan recap and member capability.", "INVALID_RECAP", 400);
  }

  const identity = await planMemberIdentityResult(id, memberToken);
  if (!identity.ok) return error("The Plan member check is temporarily unavailable.", "MEMBER_LOOKUP_UNAVAILABLE", 503, true);
  if (!identity.identity) return error("That member capability cannot save this recap.", "MEMBER_FORBIDDEN", 403);

  const completionLookup = await planCompletionResult(id);
  if (!completionLookup.ok) return error("The completed Plan is temporarily unavailable.", "COMPLETION_LOOKUP_UNAVAILABLE", 503, true);
  const completion = completionLookup.completion;
  if (!completion) return error("Complete the Plan before saving its recap.", "PLAN_NOT_COMPLETED", 409);
  const canonicalStops = completion.routeSnapshot.slice().sort((left, right) => left.position - right.position);
  const matchesCanonical = recap.completionId === completion.id
    && recap.ending === completion.ending
    && recap.routeRevision === completion.routeRevision
    && recap.completedAt === completion.completedAt
    && recap.stops.length === canonicalStops.length
    && recap.stops.every((stop, index) => (
      stop.position === index
      && stop.venueId === canonicalStops[index]?.venueId
      && stop.venueName === canonicalStops[index]?.venueName
    ));
  if (!matchesCanonical) {
    return error("The completed route changed. Refresh the recap before saving.", "RECAP_CONFLICT", 409);
  }

  const saved = await createNightMemoryFromPlanRecap(ownerId, {
    ...recap,
    ending: completion.ending,
    completedAt: completion.completedAt,
    routeRevision: completion.routeRevision,
    stops: canonicalStops.map((stop, index) => ({
      ...stop,
      position: index,
      caption: recap.stops[index]?.caption ?? "",
    })),
  });
  return saved
    ? jsonNoStore({ ...saved, private: true }, { status: 201 })
    : error("That private recap could not be saved. Your local draft is safe.", "RECAP_SAVE_FAILED", 503, true);
}
