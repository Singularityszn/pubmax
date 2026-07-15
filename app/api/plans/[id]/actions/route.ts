import { jsonNoStore } from "@/lib/apiResponses";
import { isPlanId, type PlanActionDTO } from "@/lib/plan";
import { planStore } from "@/lib/planStore";
import { assertServerEnv } from "@/lib/serverEnv";

assertServerEnv();
type Context = { params: Promise<{ id: string }> };
const ACTIONS: PlanActionDTO["type"][] = ["arrived", "skipped", "swapped"];

export async function POST(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  if (!isPlanId(id)) return jsonNoStore({ error: "That Plan doesn't exist." }, { status: 404 });
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return jsonNoStore({ error: "Malformed request body." }, { status: 400 }); }
  const type = typeof body.type === "string" && ACTIONS.includes(body.type as PlanActionDTO["type"]) ? body.type as PlanActionDTO["type"] : null;
  const stopPosition = typeof body.stopPosition === "number" && Number.isInteger(body.stopPosition) && body.stopPosition >= 0 && body.stopPosition < 8 ? body.stopPosition : undefined;
  if (!type || stopPosition === undefined) return jsonNoStore({ error: "Add a valid stop action." }, { status: 400 });
  const result = await planStore().addAction(id, body.memberToken, { type, stopPosition });
  if (!result.ok) return jsonNoStore({ error: result.error === "forbidden" ? "That member token cannot update this Plan." : "Could not record the action." }, { status: result.error === "forbidden" ? 403 : result.error === "not_found" ? 404 : 400 });
  return jsonNoStore(result.plan, { status: 201 });
}
