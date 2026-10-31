import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { isPlanId } from "@/lib/planId";
import { operatePlanBeacon, type PlanBeaconFailure } from "@/lib/planBeaconStore";
import { planMemberCapability } from "@/lib/planMemberCapability";
import { isLimited } from "@/lib/pintDrops";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";

assertServerEnv();
type Context = { params: Promise<{ id: string }> };
const PRIVATE = { "Cache-Control": "private, no-store" };

function refusal(error: PlanBeaconFailure): Response {
  const status = error === "not_found" ? 404 : error === "forbidden" ? 403 : error === "invalid" ? 400 : error === "conflict" ? 409 : 503;
  const message = error === "not_found" ? "That table sign is not available."
    : error === "forbidden" ? "Only the host can change the table sign."
      : error === "invalid" ? "Choose a symbol and a note of up to 160 characters."
        : error === "conflict" ? "The crew has moved. Refresh before changing the table sign."
          : "The table sign could not be read. Try again.";
  return publicApiError(message, `PLAN_BEACON_${error.toUpperCase()}`, status, { retryable: status >= 500 || status === 409, headers: PRIVATE });
}

async function handle(request: Request, context: Context, operation: "read" | "set" | "clear"): Promise<Response> {
  const { id } = await context.params;
  if (!isPlanId(id)) return refusal("not_found");
  const key = `plan-beacon:${hashIp(clientIp(request))}`;
  if (await isLimited(key, key, operation === "read" ? 120 : 20)) {
    return publicApiError("Too many requests. Wait a moment.", "PLAN_BEACON_RATE_LIMITED", 429, { retryable: true, headers: PRIVATE });
  }
  let body: Record<string, unknown> = {};
  if (operation !== "read") {
    try {
      const raw: unknown = await request.json();
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return refusal("invalid");
      body = raw as Record<string, unknown>;
      if (!Number.isInteger(body.expectedRouteRevision) || Number(body.expectedRouteRevision) < 1 || !isPlanId(body.expectedArrivalId)) {
        return refusal("invalid");
      }
    } catch { return refusal("invalid"); }
  }
  const result = await operatePlanBeacon(id, planMemberCapability(request, undefined), operation, body);
  if (!result.ok) return refusal(result.error);
  return jsonNoStore(result.view, { headers: PRIVATE });
}

export async function GET(request: Request, context: Context): Promise<Response> { return handle(request, context, "read"); }
export async function PUT(request: Request, context: Context): Promise<Response> { return handle(request, context, "set"); }
export async function DELETE(request: Request, context: Context): Promise<Response> { return handle(request, context, "clear"); }
