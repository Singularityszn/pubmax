import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import { profileStore } from "@/lib/profileStore";

export async function GET(request: Request): Promise<Response> {
  const ownerId = await callerUserId(request);
  if (!ownerId) return jsonNoStore({ error: "Sign in to view your PUBMAXX handle." }, { status: 401 });
  const profile = await profileStore().getByUserId(ownerId);
  return jsonNoStore({ handle: profile?.handle ?? null });
}
