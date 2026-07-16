import { jsonNoStore } from "@/lib/apiResponses";
import { isPlanId, type PlanActionDTO } from "@/lib/plan";
import { planStore } from "@/lib/planStore";
import { assertServerEnv } from "@/lib/serverEnv";

assertServerEnv();
type Context = { params: Promise<{ id: string }> };
const ACTIONS: PlanActionDTO["type"][] = ["arrived", "skipped", "swapped"];

export async function POST(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  if (!isPlanId(id)) return jsonNoStore({ error: "That Plan doesn't exist.", code: "PLAN_NOT_FOUND", retryable: false }, { status: 404 });
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return jsonNoStore({ error: "Malformed request body.", code: "MALFORMED_REQUEST", retryable: false }, { status: 400 }); }
  const type = typeof body.type === "string" && ACTIONS.includes(body.type as PlanActionDTO["type"]) ? body.type as PlanActionDTO["type"] : null;
  const stopPosition = typeof body.stopPosition === "number" && Number.isInteger(body.stopPosition) && body.stopPosition >= 0 && body.stopPosition < 8 ? body.stopPosition : undefined;
  if (!type || stopPosition === undefined) return jsonNoStore({ error: "Add a valid stop action.", code: "PLAN_ACTION_INVALID", retryable: false }, { status: 400 });
  const result = await planStore().addAction(id, body.memberToken, { type, stopPosition });
  if (!result.ok) {
    const status = result.error === "forbidden" ? 403 : result.error === "not_found" ? 404 : result.error === "error" ? 503 : 400;
    const error = result.error === "forbidden" ? "That member token cannot update this Plan." : result.error === "not_found" ? "That Plan doesn't exist." : result.error === "error" ? "The Plan update is temporarily unavailable." : "Could not record the action.";
    const code = result.error === "forbidden" ? "PLAN_ACTION_FORBIDDEN" : result.error === "not_found" ? "PLAN_NOT_FOUND" : result.error === "error" ? "PLAN_ACTION_UNAVAILABLE" : "PLAN_ACTION_INVALID";
    return jsonNoStore({ error, code, retryable: result.error === "error" }, { status });
  }
  return jsonNoStore(result.plan, { status: 201 });
}
