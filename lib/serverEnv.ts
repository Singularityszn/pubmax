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
//
// Vercel caveat: Preview and Production both set NODE_ENV=production. Preview
// often lacks Production-scoped secrets (SUPABASE_*, ADMIN_TOKEN, …). Guarding
// on NODE_ENV alone therefore kills every Preview build during
// "Collecting page data". We key off VERCEL_ENV when present so only the
// Production target enforces durable-store + secret requirements.

import { isSupabaseConfigured } from "@/lib/supabase";

/** Dev default for RATE_LIMIT_SALT — must not be used in production. */
export const DEV_RATE_LIMIT_SALT = "pubmax-rate-limit";

/**
 * True when this process must refuse the in-memory store / missing secrets.
 * On Vercel, only `VERCEL_ENV=production` counts — Preview builds share
 * NODE_ENV=production but typically omit Production-only env vars.
 */
export function isDeployedProduction(): boolean {
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv === "production") return true;
  if (vercelEnv === "preview" || vercelEnv === "development") return false;
  return process.env.NODE_ENV === "production";
}

/**
 * In production, throw a clear FATAL error when moderation or rate-limit
 * secrets are missing or still at dev defaults. Safe to call more than once.
 */
export function assertProductionSecrets(): void {
  if (!isDeployedProduction()) return;

  const adminToken = process.env.ADMIN_TOKEN?.trim();
  if (!adminToken) {
    throw new Error(
      "FATAL: ADMIN_TOKEN is not set in production. " +
        "Moderation endpoints would be unreachable or misconfigured. " +
        "Set a strong ADMIN_TOKEN and redeploy.",
    );
  }

  const rateLimitSalt = process.env.RATE_LIMIT_SALT?.trim();
  if (!rateLimitSalt || rateLimitSalt === DEV_RATE_LIMIT_SALT) {
    throw new Error(
      "FATAL: RATE_LIMIT_SALT is unset or still the dev default in production. " +
        "IP/actor hashes would be computable from public code. " +
        "Set a secret RATE_LIMIT_SALT and redeploy.",
    );
  }
}

/**
 * In production, throw a clear FATAL error unless Supabase is configured;
 * elsewhere, do nothing. Reuses isSupabaseConfigured() (lib/supabase.ts) so the
 * definition of "configured" (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY) stays in
 * exactly one place. Safe to call more than once — it only ever reads env.
 */
export function assertServerEnv(): void {
  if (!isDeployedProduction()) return;
  if (isSupabaseConfigured()) {
    assertProductionSecrets();
    return;
  }
  throw new Error(
    "FATAL: Supabase is not configured in production " +
      "(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required). " +
      "Refusing to start on the in-memory store — every write would be lost on the " +
      "next cold start. Set the Supabase env vars and redeploy.",
  );
}
