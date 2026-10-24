import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase";

/**
 * Return one admitted, unused unit without overwriting concurrent charges.
 * The database serializes each refund with all other updates to the bucket.
 * Call once per reservation. Never retry an ambiguous write.
 */
export async function refundRateLimitHit(key: string): Promise<boolean> {
  const admin = getSupabaseAdmin();
  if (!admin) return false;
  try {
    const result = await admin.rpc("refund_rate_limit_hit", { p_key: key })
      .abortSignal(AbortSignal.timeout(2_500));
    return !result.error && result.data === true;
  } catch {
    return false;
  }
}
