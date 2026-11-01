import { jsonNoStore } from "@/lib/apiResponses";
import { publicApiError } from "@/lib/apiError";
import { isPlanId } from "@/lib/plan";
import { planMemberCapability } from "@/lib/planMemberCapability";
import { planPresentationStore } from "@/lib/planPresentationStore";
import type { PlanPresentationResult } from "@/lib/planPresentation";
import { isLimited } from "@/lib/pintDrops";
import { clientIp, hashIp } from "@/lib/supabase";

type Context = { params: Promise<{ id: string }> };

function answer(result: PlanPresentationResult): Response {
  if (result.ok) return jsonNoStore(result);
  const status = { invalid: 400, forbidden: 403, conflict: 409, error: 503 }[result.error];
  const message = {
    invalid: "Choose a valid mystery setting.", forbidden: "This Plan session cannot use that setting.",
    conflict: "The route changed. Refresh the Plan before changing its setting.", error: "Mystery settings are temporarily unavailable.",
  }[result.error];
  return publicApiError(message, `PLAN_PRESENTATION_${result.error.toUpperCase()}`, status, { retryable: result.error === "error" || result.error === "conflict" });
}

export async function GET(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  return answer(await planPresentationStore.read(id, planMemberCapability(request, undefined)));
}

export async function PUT(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  if (!isPlanId(id)) return answer({ ok: false, error: "invalid" });
  const limiterKey = `plan-presentation:${id}:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey)) return publicApiError("Too many changes. Try again shortly.", "PLAN_PRESENTATION_RATE_LIMITED", 429, { retryable: true });
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return answer({ ok: false, error: "invalid" });
  const row = body as Record<string, unknown>;
  if (typeof row.mysteryEnabled !== "boolean" || typeof row.expectedRouteRevision !== "number") return answer({ ok: false, error: "invalid" });
  return answer(await planPresentationStore.set(id, planMemberCapability(request, row.memberToken), {
    mysteryEnabled: row.mysteryEnabled, expectedRouteRevision: row.expectedRouteRevision,
  }));
}
