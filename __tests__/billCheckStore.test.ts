// lib/billCheckStore.ts: one row per bill read, the moderation queue of bills
// that do not show their price, and a review that stamps a row and never
// deletes it. Memory backend first, then the Supabase half over a fluent mock.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
  rows: [] as Row[],
  inserts: [] as Row[],
  updates: [] as { patch: Row; filters: string[] }[],
  schemaMiss: false,
  failWrites: false,
  uniqueViolation: false,
}));

vi.mock("@/lib/deploymentEnv", () => ({ isDeployedProduction: () => false }));

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const TABLE_MISSING = "Could not find the table 'public.price_bill_checks' in the schema cache";
  function makeQuery() {
    const state = {
      op: "select" as "select" | "insert" | "update",
      row: null as Row | null,
      patch: null as Row | null,
      filters: [] as ((r: Row) => boolean)[],
      described: [] as string[],
      limit: Number.POSITIVE_INFINITY,
      single: false,
    };
    const run = () => {
      if (db.schemaMiss) return { data: null, error: { message: TABLE_MISSING } };
      if (state.op === "insert") {
        if (db.failWrites) return { data: null, error: { message: "insert boom" } };
        if (db.uniqueViolation) {
          return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
        }
        const stored = { id: `check-${db.rows.length + 1}`, checked_at: "2026-11-05T19:30:00.000Z", ...state.row };
        db.inserts.push(state.row ?? {});
        db.rows.push(stored);
        return { data: state.single ? stored : [stored], error: null };
      }
      const rows = db.rows.filter((r) => state.filters.every((f) => f(r)));
      if (state.op === "update") {
        db.updates.push({ patch: state.patch ?? {}, filters: state.described });
        rows.forEach((r) => Object.assign(r, state.patch));
        return { data: state.single ? rows[0] ?? null : rows, error: null };
      }
      const limited = rows.slice(0, state.limit);
      return { data: state.single ? limited[0] ?? null : limited, error: null };
    };
    const q: Record<string, unknown> = {
      select: () => q,
      insert(row: Row) {
        state.op = "insert";
        state.row = row;
        return q;
      },
      update(patch: Row) {
        state.op = "update";
        state.patch = patch;
        return q;
      },
      eq(col: string, value: unknown) {
        state.described.push(`${col}=${String(value)}`);
        state.filters.push((r) => r[col] === value);
        return q;
      },
      is(col: string, value: unknown) {
        state.described.push(`${col} is ${String(value)}`);
        state.filters.push((r) => (r[col] ?? null) === value);
        return q;
      },
      order: () => q,
      limit(n: number) {
        state.limit = n;
        return q;
      },
      single() {
        state.single = true;
        return q;
      },
      maybeSingle() {
        state.single = true;
        return q;
      },
      then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
        return Promise.resolve(run()).then(resolve, reject);
      },
    };
    return q;
  }
  return {
    ...actual,
    isSupabaseConfigured: () => true,
    requireSupabaseAdmin: () => ({ from: () => makeQuery() }),
  };
});

import {
  __resetBillChecks,
  memoryBillCheckStore,
  supabaseBillCheckStore,
} from "@/lib/billCheckStore";

const MATCH = {
  pintDropId: "drop-1",
  venueId: "venue-1vle947",
  priceGbp: 6.2,
  result: "match" as const,
  lines: [{ name: "Guinness", priceGbp: 6.2 }],
};

const MISMATCH = {
  pintDropId: "drop-2",
  communityPriceId: "price-2",
  venueId: "venue-1vle947",
  priceGbp: 4.5,
  result: "mismatch" as const,
  lines: [{ name: "Guinness", priceGbp: 6.2 }],
};

describe("the memory bill check store", () => {
  beforeEach(() => __resetBillChecks());

  it("records a check and lists only an unreviewed mismatch for a moderator", async () => {
    await memoryBillCheckStore.record(MATCH);
    const mismatch = await memoryBillCheckStore.record(MISMATCH);
    await memoryBillCheckStore.record({ ...MATCH, pintDropId: "drop-3", result: "unreadable", lines: [] });

    const queue = await memoryBillCheckStore.listMismatchesForReview();
    expect(queue.map((check) => check.id)).toEqual([mismatch.id]);
    expect(queue[0]).toMatchObject({ communityPriceId: "price-2", priceGbp: 4.5, result: "mismatch" });
  });

  it("stamps a review, keeps the row, and answers null to a second review or an unknown id", async () => {
    const mismatch = await memoryBillCheckStore.record(MISMATCH);

    const reviewed = await memoryBillCheckStore.review(mismatch.id, "hidden", 1_793_900_000_000);
    expect(reviewed).toMatchObject({ id: mismatch.id, reviewDecision: "hidden", result: "mismatch" });
    expect(reviewed?.reviewedAt).toBe(new Date(1_793_900_000_000).toISOString());
    expect(await memoryBillCheckStore.listMismatchesForReview()).toEqual([]);
    expect(await memoryBillCheckStore.review(mismatch.id, "kept")).toBeNull();
    expect(await memoryBillCheckStore.review("check-unknown", "kept")).toBeNull();
  });

  it("never reviews a match or an unreadable bill", async () => {
    const match = await memoryBillCheckStore.record(MATCH);
    expect(await memoryBillCheckStore.review(match.id, "kept")).toBeNull();
  });

  it("keeps one check per bill: a second record for the same drop is refused", async () => {
    await memoryBillCheckStore.record(MATCH);
    await expect(memoryBillCheckStore.record(MATCH)).rejects.toThrow(/already checked/);
  });
});

describe("the Supabase bill check store", () => {
  beforeEach(() => {
    db.rows.length = 0;
    db.inserts.length = 0;
    db.updates.length = 0;
    db.schemaMiss = false;
    db.failWrites = false;
    db.uniqueViolation = false;
    __resetBillChecks();
  });

  it("writes the verdict, the lines it needs and the price in pennies, and nothing else", async () => {
    const stored = await supabaseBillCheckStore.record(MISMATCH);

    expect(db.inserts).toEqual([
      {
        pint_drop_id: "drop-2",
        community_price_id: "price-2",
        venue_id: "venue-1vle947",
        price_pennies: 450,
        result: "mismatch",
        lines: [{ name: "Guinness", price_gbp: 6.2 }],
      },
    ]);
    expect(stored).toMatchObject({ id: "check-1", priceGbp: 4.5, lines: [{ name: "Guinness", priceGbp: 6.2 }] });
  });

  it("refuses a second check of one bill as already checked", async () => {
    db.uniqueViolation = true;
    await expect(supabaseBillCheckStore.record(MATCH)).rejects.toThrow(/already checked/);
  });

  it("throws on a hard write failure so the run can say it did not land", async () => {
    db.failWrites = true;
    await expect(supabaseBillCheckStore.record(MATCH)).rejects.toThrow(/insert boom/);
  });

  it("reviews only an unreviewed mismatch, by stamp, and never deletes", async () => {
    const stored = await supabaseBillCheckStore.record(MISMATCH);

    const reviewed = await supabaseBillCheckStore.review(stored.id, "kept", 1_793_900_000_000);

    expect(reviewed).toMatchObject({ id: stored.id, reviewDecision: "kept" });
    expect(db.updates[0]?.filters).toEqual([`id=${stored.id}`, "result=mismatch", "reviewed_at is null"]);
    expect(db.updates[0]?.patch).toEqual({
      reviewed_at: new Date(1_793_900_000_000).toISOString(),
      review_decision: "kept",
    });
    expect(db.rows).toHaveLength(1);
  });

  it("reads the queue as unreviewed mismatches and drops a row it cannot read", async () => {
    await supabaseBillCheckStore.record(MISMATCH);
    db.rows.push({ id: "check-bad", result: "mismatch", reviewed_at: null, lines: "oops" });
    const queue = await supabaseBillCheckStore.listMismatchesForReview();
    expect(queue.map((check) => check.id)).toEqual(["check-1"]);
  });

  it("falls back to memory outside production when the table is missing", async () => {
    db.schemaMiss = true;
    const stored = await supabaseBillCheckStore.record(MATCH);
    expect(stored.result).toBe("match");
    expect(await memoryBillCheckStore.listMismatchesForReview()).toEqual([]);
  });
});
