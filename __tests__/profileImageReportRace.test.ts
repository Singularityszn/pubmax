// Two readers flagging the same image must both be recorded.
//
// `reportOwnedImage` read `*_report_actors`, appended in JavaScript and wrote the
// whole array back, so two concurrent reporters each wrote [base, self] and the
// later write dropped the earlier one. The append now happens in Postgres in one
// statement (migration 0105), and the store falls back to the old path only when
// that function is not deployed.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const supabase = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/supabase", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase")>()),
  requireSupabaseAdmin: () => ({ rpc: supabase.rpc, from: supabase.from }),
}));

import { supabaseProfileStore } from "@/lib/profileStore";

const MIGRATION = join(
  process.cwd(),
  "supabase/migrations/20260815120000_0105_profile_image_report_actor_append.sql",
);
const ROLLBACK = join(
  process.cwd(),
  "supabase/migrations/rollback/20260815120000_0105_profile_image_report_actor_append_rollback.sql",
);

/**
 * The rows a real UPDATE would touch, behind an RPC that appends the way
 * Postgres does: one statement, no window in which another caller can read a
 * stale array.
 */
function atomicRpcBackedRow(actors: string[]) {
  supabase.rpc.mockImplementation(async (_name: string, args: Record<string, unknown>) => {
    const actor = String(args.p_actor);
    if (actors.includes(actor)) return { data: true, error: null };
    actors.push(actor);
    return { data: true, error: null };
  });
}

beforeEach(() => {
  supabase.rpc.mockReset();
  supabase.from.mockReset();
});

describe("reportOwnedImage — the append is atomic", () => {
  it("keeps BOTH reporters when two land together", async () => {
    const actors: string[] = [];
    atomicRpcBackedRow(actors);

    const [first, second] = await Promise.all([
      supabaseProfileStore.reportOwnedImage("alice", "avatar", "abusive", "actor-one"),
      supabaseProfileStore.reportOwnedImage("alice", "avatar", undefined, "actor-two"),
    ]);

    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(actors.sort()).toEqual(["actor-one", "actor-two"]);
    // Nothing read the row and wrote it back: the whole race is gone.
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("passes the handle, slot, actor and cleaned reason to the one statement", async () => {
    atomicRpcBackedRow([]);
    await supabaseProfileStore.reportOwnedImage("@Alice", "cover", "  not theirs  ", " hash-1 ");

    expect(supabase.rpc).toHaveBeenCalledWith("append_profile_image_report_actor", {
      p_handle: "alice",
      p_slot: "cover",
      p_actor: "hash-1",
      p_reason: "not theirs",
    });
  });

  it("answers the RPC's own refusal without touching the table", async () => {
    supabase.rpc.mockResolvedValue({ data: false, error: null });
    expect(
      await supabaseProfileStore.reportOwnedImage("alice", "avatar", undefined, "actor-one"),
    ).toBe(false);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("falls back to the older path while migration 0105 is undeployed", async () => {
    supabase.rpc.mockResolvedValue({
      data: null,
      error: { code: "PGRST202", message: "Could not find the function" },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // No profile row behind `from`, so the fallback simply answers false — what
    // matters is that a reader's flag is never refused because of the migration.
    supabase.from.mockImplementation(() => {
      const builder: Record<string, unknown> = {
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: null, error: null }).then(resolve),
      };
      for (const method of ["select", "update", "eq", "limit", "is", "not", "order"]) {
        builder[method] = () => builder;
      }
      builder.maybeSingle = () => Promise.resolve({ data: null, error: null });
      return builder;
    });

    expect(
      await supabaseProfileStore.reportOwnedImage("alice", "avatar", undefined, "actor-one"),
    ).toBe(false);
    expect(supabase.from).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("migration 0105 — SQL shape", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  it("appends in SQL rather than writing a whole array back", () => {
    expect(sql).toContain("array_append");
    expect(sql).not.toMatch(/set\s+avatar_report_actors\s*=\s*\$/i);
  });

  it("guards per-actor uniqueness inside the UPDATE's own predicate", () => {
    for (const column of ["avatar_report_actors", "cover_report_actors"]) {
      expect(sql).toContain(
        `not (coalesce(${column}, '{}'::text[]) @> array[p_actor])`,
      );
    }
  });

  it("keeps the approved-state gate the old path applied", () => {
    expect(sql).toContain("avatar_moderation_state = 'approved'");
    expect(sql).toContain("cover_moderation_state = 'approved'");
  });

  it("is service-role only, because it reads reporter actor hashes", () => {
    expect(sql).toContain("grant execute on function public.append_profile_image_report_actor");
    expect(sql).toContain("to service_role");
    expect(sql).toMatch(/revoke all on function[\s\S]*from anon/i);
    expect(sql).toMatch(/revoke all on function[\s\S]*from authenticated/i);
  });

  it("ships a rollback that drops the function and nothing else", () => {
    const rollback = readFileSync(ROLLBACK, "utf8");
    expect(rollback).toContain("drop function if exists public.append_profile_image_report_actor");
    expect(rollback).not.toMatch(/\bdelete\b|\bdrop table\b|\btruncate\b/i);
  });
});
