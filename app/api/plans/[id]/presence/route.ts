import { jsonNoStore } from "@/lib/apiResponses";
import { isLimited } from "@/lib/pintDrops";
import { isPlanId } from "@/lib/plan";
import { planStore } from "@/lib/planStore";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";

assertServerEnv();
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  if (!isPlanId(id)) return jsonNoStore({ error: "That Plan doesn't exist." }, { status: 404 });
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return jsonNoStore({ error: "Malformed request body." }, { status: 400 });
  }
  const limiterKey = `plan-presence:${id}:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey)) {
    return jsonNoStore({ error: "Too many updates, slow down." }, { status: 429 });
  }
  const result = await planStore().updatePresence(id, body.memberToken, body.status);
  if (!result.ok) {
    const status = result.error === "invalid" ? 400 : result.error === "not_found" ? 404 : result.error === "forbidden" ? 403 : 503;
    const error = result.error === "forbidden" ? "That member token isn't valid." : result.error === "invalid" ? "Choose a valid crew status." : result.error === "not_found" ? "That Plan doesn't exist." : "Could not update presence.";
    return jsonNoStore({ error }, { status });
  }
  return jsonNoStore(result.plan, { status: 200 });
}
