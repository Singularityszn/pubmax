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
