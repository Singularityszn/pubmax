import { jsonNoStore } from "@/lib/apiResponses";
import { isLimited } from "@/lib/pintDrops";
import { planStore } from "@/lib/planStore";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";

assertServerEnv();

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return jsonNoStore({ error: "Malformed request body." }, { status: 400 });
  }
  const limiterKey = `plan-create:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey)) {
    return jsonNoStore({ error: "Too many Plans, slow down." }, { status: 429 });
  }
  const result = await planStore().create(body);
  if (!result.ok) {
    return jsonNoStore(
      { error: result.error === "invalid" ? "Add a start time, your name, and at least one venue." : "Could not create the Plan." },
      { status: result.error === "invalid" ? 400 : 503 },
    );
  }
  return jsonNoStore({ plan: result.plan, memberToken: result.memberToken }, { status: 201 });
}
