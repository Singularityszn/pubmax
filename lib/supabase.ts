import { createHash } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-only Supabase admin client. Returns null when env is absent so every
// caller degrades to the in-memory store / static cache instead of crashing.
// ponytail: no client-side client — all writes route through server handlers.
let cached: SupabaseClient | null | undefined;

export function getSupabaseAdmin(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  cached = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
  return cached;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function requiresSupabaseStore(): boolean {
  return process.env.NODE_ENV === "production";
}

export const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? "pint-drops";

// ── Durable rate limiting ────────────────────────────────────────────────────
// Backed by the rate_limits table + check_rate_limit RPC (migration 0003):
// one atomic round trip that prunes the window, records the hit, and returns
// the verdict. Limits mirror lib/pintDrops.ts so both limiters agree.

export const RATE_LIMIT_MAX = 8;
export const RATE_LIMIT_WINDOW_MS = 60_000;

/** sha256(salt:ip) — raw IPs never reach the database or logs. */
export function hashIp(ip: string): string {
  // ponytail: default salt keeps dev working without env; set RATE_LIMIT_SALT
  // in production so hashes aren't computable from public code alone.
  const salt = process.env.RATE_LIMIT_SALT ?? "pubmax-rate-limit";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

/**
 * Atomic check-and-increment against Supabase. Returns true/false when the
 * RPC answered, or null when it could not (no client, RPC error, network) —
 * callers fall back to the in-memory limiter on null so a limiter outage can
 * never take down the write path.
 */
export async function checkRateLimitDurable(
  key: string,
  limit = RATE_LIMIT_MAX,
  windowMs = RATE_LIMIT_WINDOW_MS,
): Promise<boolean | null> {
  const admin = getSupabaseAdmin();
  if (!admin) return null;
  try {
    const { data, error } = await admin.rpc("check_rate_limit", {
      p_key: key,
      p_limit: limit,
      p_window_ms: windowMs,
    });
    if (error) return null;
    return data === true;
  } catch {
    return null;
  }
}
