// Shared dual-backend seam utilities for *Store modules: backend selection,
// PostgREST schema-miss detection, deduped memory-fallback warnings, and an
// optional try/catch wrapper for fail-soft reads. Adopt incrementally — each
// store keeps its own interface, empty sentinels, and domain logic.

import type { SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseConfigured, requireSupabaseAdmin } from "@/lib/supabase";

/** Normalise unknown thrown values to a log-safe string. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Single seam: durable Supabase when env keys exist, process-memory otherwise. */
export function selectStore<T>(memory: T, supabase: T): T {
  return isSupabaseConfigured() ? supabase : memory;
}

/**
 * The repeated `function admin() { return requireSupabaseAdmin(); }` wrapper
 * every Supabase-backed store implementation calls at each operation — a thin,
 * lazy indirection so the client is resolved per-call (not captured at module
 * load, before env vars / mocks are in place). Shared here so stores don't each
 * redeclare an identical one-liner.
 */
export function admin(): SupabaseClient {
  return requireSupabaseAdmin();
}

/** Postgres unique_violation (23505): a duplicate insert racing an existing
 *  row — the idempotent-success case for toggle/insert-if-absent writes. */
export function isUniqueViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === "23505";
}

/** Postgres foreign_key_violation (23503): the referenced row doesn't exist
 *  (e.g. a reaction/comment on a demo seed not present in visit_reports). */
export function isForeignKeyViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === "23503";
}

/**
 * PostgREST / Postgres signals that a public table is absent (migration not
 * applied, or schema cache stale). Accepts one table name or many (OR'd).
 */
export function isMissingTableSchema(
  err: unknown,
  tables: string | readonly string[],
): boolean {
  const group = (Array.isArray(tables) ? tables : [tables]).join("|");
  return new RegExp(
    `Could not find the table 'public\\.(${group})'|relation "public\\.(${group})" does not exist|schema cache`,
    "i",
  ).test(errorMessage(err));
}

/** Curry a schema-miss predicate for a store's table(s). */
export function missingTables(...tables: string[]): (err: unknown) => boolean {
  return (err) => isMissingTableSchema(err, tables);
}

export type MemoryFallbackWarner = (context: string, err: unknown) => void;

/**
 * Deduped console.warn when the Supabase path falls back to process-memory
 * because the durable table is missing. One warn per `context` per process.
 */
export function createMemoryFallbackWarner(
  storeTag: string,
  migrationHint: string,
): { warn: MemoryFallbackWarner; resetWarnings: () => void } {
  const seen = new Set<string>();
  return {
    warn(context, err) {
      if (seen.has(context)) return;
      seen.add(context);
      console.warn(
        `[${storeTag}] ${context} durable table missing — using process-memory fallback (${migrationHint}):`,
        errorMessage(err),
      );
    },
    resetWarnings() {
      seen.clear();
    },
  };
}

export type RunStoreOpOptions<T> = {
  /** Label for logs and deduped schema-miss warns (e.g. "read", "confirm"). */
  context: string;
  run: () => Promise<T>;
  /** When set, schema-miss routes here instead of onError / rethrow. */
  onSchemaMiss?: () => Promise<T>;
  isSchemaMiss?: (err: unknown) => boolean;
  warnSchemaMiss?: MemoryFallbackWarner;
  /** Fail-soft path for non-schema errors. When omitted, non-schema errors rethrow. */
  onError?: (err: unknown) => T | Promise<T>;
  /** When onError is used, optional `[tag] message` log line before the fallback. */
  logError?: { tag: string; message: string };
};

/**
 * Wrap a Supabase store operation: try `run`, on schema-miss optionally warn +
 * delegate to memory, on other errors optionally log + return a soft fallback,
 * otherwise rethrow (for write paths that must surface failure).
 */
export async function runStoreOp<T>(opts: RunStoreOpOptions<T>): Promise<T> {
  try {
    return await opts.run();
  } catch (err) {
    if (opts.isSchemaMiss?.(err) && opts.onSchemaMiss) {
      opts.warnSchemaMiss?.(opts.context, err);
      return opts.onSchemaMiss();
    }
    if (opts.onError) {
      if (opts.logError) {
        console.error(
          `[${opts.logError.tag}] ${opts.logError.message}:`,
          errorMessage(err),
        );
      }
      return opts.onError(err);
    }
    throw err;
  }
}
