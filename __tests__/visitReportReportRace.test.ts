// Two readers flagging the same visit report must both be recorded.
//
// `visitReportStore().report` read `report_actors`, appended in JavaScript and
// wrote the whole array back, so two concurrent reporters each wrote
// [base, self] and the later write dropped the earlier reporter. The append
// now happens in Postgres in one statement (migration 0158), and the store
// falls back to the old path only when that function is not deployed.

import { beforeEach, describe, expect, it, vi } from "vitest";

const supabase = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/supabase", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase")>()),
  requireSupabaseAdmin: () => ({ rpc: supabase.rpc, from: supabase.from }),
}));

import { supabaseVisitReportStore } from "@/lib/visitReportsStore";

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

describe("visitReportStore.report — the append is atomic", () => {
  it("keeps BOTH reporters when two land together", async () => {
    const actors: string[] = [];
    atomicRpcBackedRow(actors);

    const [first, second] = await Promise.all([
      supabaseVisitReportStore.report("report-1", "not accurate", "actor-one"),
      supabaseVisitReportStore.report("report-1", undefined, "actor-two"),
    ]);

    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(actors.sort()).toEqual(["actor-one", "actor-two"]);
    // Nothing read the row and wrote it back: the whole race is gone.
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("passes the id, actor and reason to the one statement", async () => {
    atomicRpcBackedRow([]);
    await supabaseVisitReportStore.report("report-1", "not accurate", "hash-1");

    expect(supabase.rpc).toHaveBeenCalledWith("append_visit_report_report_actor", {
      p_id: "report-1",
      p_actor: "hash-1",
      p_reason: "not accurate",
    });
  });

  it("answers the RPC's own refusal without touching the table", async () => {
    supabase.rpc.mockResolvedValue({ data: false, error: null });
    expect(await supabaseVisitReportStore.report("report-1", undefined, "actor-one")).toBe(false);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("falls back to the older path while migration 0158 is undeployed", async () => {
    supabase.rpc.mockResolvedValue({
      data: null,
      error: { code: "PGRST202", message: "Could not find the function" },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // No report row behind `from`, so the fallback simply answers false —
    // what matters is that a reader's flag is never refused because of the
    // migration.
    supabase.from.mockImplementation(() => {
      const builder: Record<string, unknown> = {
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: null, error: null }).then(resolve),
      };
      for (const method of ["select", "update", "eq"]) {
        builder[method] = () => builder;
      }
      builder.maybeSingle = () => Promise.resolve({ data: null, error: null });
      return builder;
    });

    expect(await supabaseVisitReportStore.report("report-1", undefined, "actor-one")).toBe(false);
    expect(supabase.from).toHaveBeenCalled();
    warn.mockRestore();
  });
});
