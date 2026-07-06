// Prod startup fail-fast for server env configuration.
//
// The write path (Pint Drops, reactions, comments, …) silently degrades to a
// process-memory store when Supabase env keys are absent — the correct, useful
// behaviour for local dev and the demo. In *production* that same degradation is
// a data-loss trap: every write lives only in one serverless instance's memory
// and vanishes on the next cold start, with no error surfaced to anyone.
//
// assertServerEnv() closes that gap. Called once at server-module load
// (app/api/pint-drops/route.ts), it turns a misconfigured prod deploy into an
// immediate, loud FATAL at import time — the route never comes up half-broken —
// while staying a no-op in dev/test so the memory store keeps working.

import { isSupabaseConfigured } from "@/lib/supabase";

/**
 * In production, throw a clear FATAL error unless Supabase is configured;
 * elsewhere, do nothing. Reuses isSupabaseConfigured() (lib/supabase.ts) so the
 * definition of "configured" (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY) stays in
 * exactly one place. Safe to call more than once — it only ever reads env.
 */
export function assertServerEnv(): void {
  if (process.env.NODE_ENV !== "production") return;
  if (isSupabaseConfigured()) return;
  throw new Error(
    "FATAL: Supabase is not configured in production " +
      "(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required). " +
      "Refusing to start on the in-memory store — every write would be lost on the " +
      "next cold start. Set the Supabase env vars and redeploy.",
  );
}
