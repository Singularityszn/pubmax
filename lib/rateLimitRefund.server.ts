import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase";

/** Return one admitted, unused unit without overwriting concurrent charges. */
export async function refundRateLimitHit(key: string): Promise<boolean> {
  const admin = getSupabaseAdmin();
  if (!admin) return false;
  const signal = AbortSignal.timeout(2_500);
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const read = await admin.from("rate_limits").select("hits").eq("key", key).abortSignal(signal).maybeSingle();
      if (read.error) return false;
      if (!read.data || read.data.hits.length === 0) return true;
      const hits = read.data.hits;
      // Match the complete array. A concurrent charge or refund must retry
      // against the new row, rather than replace it with our stale snapshot.
      const expected = `{${hits.map((hit) => `"${hit}"`).join(",")}}`;
      const update = await admin.from("rate_limits")
        .update({ hits: hits.slice(0, -1) })
        .eq("key", key).filter("hits", "eq", expected).select("key").abortSignal(signal);
      // An error can mean that the write committed but its reply was lost.
      // Retry only a definite comparison miss, never an ambiguous write.
      if (update.error) return false;
      if (update.data?.length) return true;
    }
  } catch {
    return false;
  }
  return false;
}
