import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { assertCronRequest } from "@/lib/cronAuth";
import { requireSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request): Promise<Response> {
  const denied = assertCronRequest(request);
  if (denied) return denied;
  try {
    const { data, error } = await requireSupabaseAdmin().rpc("purge_friend_locations");
    if (error) throw new Error("purge refused");
    return jsonNoStore({ ok: true, removed: data });
  } catch {
    return publicApiError("Location cleanup is unavailable.", "FRIEND_LOCATION_UNAVAILABLE", 503, { retryable: true });
  }
}
