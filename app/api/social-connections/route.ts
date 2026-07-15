import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import { socialConnectionStore } from "@/lib/socialConnectionStore";
import { publicSocialConnection } from "@/lib/socialConnections";
import { assertServerEnv } from "@/lib/serverEnv";

assertServerEnv();

export async function GET(request: Request): Promise<Response> {
  const ownerId = await callerUserId(request);
  if (!ownerId) return jsonNoStore({ error: "Sign in to manage connected accounts." }, { status: 401 });
  try {
    const rows = await socialConnectionStore().list(ownerId);
    return jsonNoStore({ connections: rows.map(publicSocialConnection) });
  } catch {
    return jsonNoStore({ error: "Connected accounts are unavailable." }, { status: 503 });
  }
}
