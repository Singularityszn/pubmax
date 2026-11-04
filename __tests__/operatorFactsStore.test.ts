import { beforeEach, describe, expect, it, vi } from "vitest";

// The Supabase half of lib/operatorFactsStore.ts against an in-memory fluent
// mock (no network): the publish is ONE upsert keyed on the proposal, a
// withdrawal only moves a published row, every read drops a withdrawn row even
// when a query lets one through, and a missing table falls back to memory
// outside production.

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
  rows: [] as Row[],
  schemaMiss: false,
  failWrites: false,
  upserts: [] as { row: Row; onConflict: unknown }[],
  ignoreWithdrawnFilter: false,
}));

vi.mock("@/lib/deploymentEnv", () => ({ isDeployedProduction: () => false }));

vi.mock("@/lib/supabase", () => {
  const TABLE_MISSING = "Could not find the table 'public.operator_facts' in the schema cache";

  function makeQuery() {
    const state: {
      op: "select" | "upsert" | "update";
      row: Row | null;
      patch: Row | null;
      filters: ((r: Row) => boolean)[];
      single: boolean;
    } = { op: "select", row: null, patch: null, filters: [], single: false };

    const run = () => {
      if (db.schemaMiss) return { data: null, error: { message: TABLE_MISSING } };
      if (state.op === "upsert") {
        if (db.failWrites) return { data: null, error: { message: "upsert boom" } };
        const row = state.row ?? {};
        const existing = db.rows.find((r) => r.proposal_id === row.proposal_id);
        if (existing) Object.assign(existing, row);
        else db.rows.push({ id: `fact-${db.rows.length + 1}`, ...row });
        const stored = db.rows.find((r) => r.proposal_id === row.proposal_id) ?? null;
        return { data: state.single ? stored : [stored], error: null };
      }
      const rows = db.rows.filter((r) => state.filters.every((f) => f(r)));
      if (state.op === "update") {
        if (db.failWrites) return { data: null, error: { message: "update boom" } };
        rows.forEach((r) => Object.assign(r, state.patch));
        return { data: rows.map((r) => ({ id: r.id })), error: null };
      }
      return { data: state.single ? rows[0] ?? null : rows, error: null };
    };

    const q: Record<string, unknown> = {
      select: () => q,
      upsert(row: Row, options: { onConflict?: unknown }) {
        state.op = "upsert";
        state.row = row;
        db.upserts.push({ row, onConflict: options?.onConflict });
        return q;
      },
      update(patch: Row) {
        state.op = "update";
        state.patch = patch;
        return q;
      },
      eq(col: string, value: unknown) {
        state.filters.push((r) => r[col] === value);
        return q;
      },
      in(col: string, values: unknown[]) {
        state.filters.push((r) => values.includes(r[col]));
        return q;
      },
      is(col: string, value: unknown) {
        if (!(db.ignoreWithdrawnFilter && col === "withdrawn_at")) {
          state.filters.push((r) => (r[col] ?? null) === value);
        }
        return q;
      },
      order: () => q,
      limit: () => q,
      single() {
        state.single = true;
        return q;
      },
      then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
        return Promise.resolve(run()).then(resolve, reject);
      },
    };
    return q;
  }

  return {
    isSupabaseConfigured: () => true,
    requiresSupabaseStore: () => false,
    requireSupabaseAdmin: () => ({ from: () => makeQuery() }),
  };
});

import { __resetOperatorFacts, supabaseOperatorFactsStore } from "@/lib/operatorFactsStore";
import type { OperatorProposal } from "@/lib/operatorProposals";

const NOW = Date.parse("2026-11-01T19:00:00.000Z");

function proposal(over: Partial<OperatorProposal> = {}): OperatorProposal {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    venueId: "venue-synthetic",
    accountId: "acct-1",
    type: "event",
    payload: { title: "Quiz night", startsAt: "8pm", onDate: "2026-11-01" },
    status: "pending",
    createdAt: "2026-10-30T12:00:00.000Z",
    ...over,
  };
}

beforeEach(() => {
  db.rows = [];
  db.upserts = [];
  db.schemaMiss = false;
  db.failWrites = false;
  db.ignoreWithdrawnFilter = false;
  __resetOperatorFacts();
});

describe("the Supabase operator facts store", () => {
  it("publishes with one upsert keyed on the proposal, and a second accept keeps the row", async () => {
    const first = await supabaseOperatorFactsStore.publish(proposal(), NOW);
    const again = await supabaseOperatorFactsStore.publish(proposal(), NOW + 1000);
    expect(db.upserts.map((u) => u.onConflict)).toEqual(["proposal_id", "proposal_id"]);
    expect(db.upserts[0]?.row).not.toHaveProperty("id");
    expect(db.upserts[0]?.row).toMatchObject({ kind: "event", on_date: "2026-11-01", withdrawn_at: null });
    expect(db.rows).toHaveLength(1);
    expect(again.id).toBe(first.id);
  });

  it("throws on a hard publish failure so the route answers 503", async () => {
    db.failWrites = true;
    await expect(supabaseOperatorFactsStore.publish(proposal(), NOW)).rejects.toThrow("upsert boom");
  });

  it("withdraws a published row once", async () => {
    await supabaseOperatorFactsStore.publish(proposal(), NOW);
    expect(await supabaseOperatorFactsStore.withdraw(proposal().id, NOW)).toBe(true);
    expect(await supabaseOperatorFactsStore.withdraw(proposal().id, NOW)).toBe(false);
    expect((await supabaseOperatorFactsStore.listPublishedForVenue("venue-synthetic")).facts).toEqual([]);
  });

  it("drops a withdrawn row even when a query lets it through", async () => {
    await supabaseOperatorFactsStore.publish(proposal(), NOW);
    await supabaseOperatorFactsStore.withdraw(proposal().id, NOW);
    db.ignoreWithdrawnFilter = true;
    expect((await supabaseOperatorFactsStore.listPublishedForVenue("venue-synthetic")).facts).toEqual([]);
    expect((await supabaseOperatorFactsStore.listPublishedForDay("2026-11-01")).facts).toEqual([]);
  });

  it("reads a night's events and offers by date", async () => {
    await supabaseOperatorFactsStore.publish(proposal(), NOW);
    await supabaseOperatorFactsStore.publish(
      proposal({ id: "22222222-2222-4222-8222-222222222222", payload: { title: "Later", startsAt: "9pm", onDate: "2026-11-02" } }),
      NOW,
    );
    const night = await supabaseOperatorFactsStore.listPublishedForDay("2026-11-01");
    expect(night.status).toBe("ready");
    expect(night.facts.map((f) => f.title)).toEqual(["Quiz night"]);
  });

  it("falls back to memory when the table is missing outside production", async () => {
    db.schemaMiss = true;
    const fact = await supabaseOperatorFactsStore.publish(proposal(), NOW);
    expect(fact.title).toBe("Quiz night");
    const read = await supabaseOperatorFactsStore.listPublishedForVenue("venue-synthetic");
    expect(read.facts.map((f) => f.id)).toEqual([fact.id]);
    expect(await supabaseOperatorFactsStore.withdraw(proposal().id, NOW)).toBe(true);
  });
});
