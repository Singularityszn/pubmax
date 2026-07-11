import { jsonNoStore } from "@/lib/apiResponses";
import { isPlanId } from "@/lib/plan";
import { planStore } from "@/lib/planStore";
import { assertServerEnv } from "@/lib/serverEnv";

assertServerEnv();
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  if (!isPlanId(id)) return jsonNoStore({ error: "That Plan doesn't exist." }, { status: 404 });
  const plan = await planStore().get(id);
  if (!plan) return jsonNoStore({ error: "That Plan doesn't exist." }, { status: 404 });
  return jsonNoStore(plan, { status: 200 });
}
