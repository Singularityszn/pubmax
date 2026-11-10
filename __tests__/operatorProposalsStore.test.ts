import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetOperatorProposals,
  memoryOperatorProposalStore,
  supabaseOperatorProposalStore,
} from "@/lib/operatorProposalsStore";
import type { OperatorProposalFields } from "@/lib/operatorProposals";
import { __resetOperatorFacts, memoryOperatorFactsStore } from "@/lib/operatorFactsStore";
import { defined } from "@/__tests__/helpers/defined";

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({ rows: [] as Row[], schemaMiss: false, failWrites: false }));

vi.mock("@/lib/supabase", () => {
  const TABLE_MISSING = "Could not find the table 'public.operator_proposals'";

  function makeQuery() {
    const state: {
      op: "select" | "insert" | null;
      insertRow: Row | null;
      filters: { col: string; value?: unknown; values?: readonly unknown[] }[];
    } = { op: null, insertRow: null, filters: [] };

    const matches = (r: Row) =>
      state.filters.every((f) => (f.values ? f.values.includes(r[f.col]) : r[f.col] === f.value));

    const result = () => {
      if (db.schemaMiss) return { data: null, error: { message: TABLE_MISSING } };
      const rows = db.rows.filter(matches);
      if (state.op === "insert") {
        if (db.failWrites) return { data: null, error: { message: "insert boom" } };
        db.rows.push({ ...state.insertRow! });
        return { data: null, error: null };
      }
      return { data: rows, error: null };
    };

    const q: Record<string, unknown> = {
      select() {
        if (!state.op) state.op = "select";
        return q;
      },
      insert(row: Row) {
        state.op = "insert";
        state.insertRow = row;
        return q;
      },
      in(col: string, values: readonly unknown[]) {
        state.filters.push({ col, values });
        return q;
      },
      eq(col: string, value: unknown) {
        state.filters.push({ col, value });
        return q;
      },
      order() {
        return q;
      },
      limit() {
        return q;
      },
      then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
        return Promise.resolve(result()).then(onFulfilled, onRejected);
      },
    };
    return q;
  }

  return {
    isSupabaseConfigured: () => true,
    requireSupabaseAdmin: () => ({
      from: () => makeQuery(),
      rpc: (_name: string, args: { p_id: string; p_status: string; p_note: string | null }) => {
        if (db.schemaMiss || db.failWrites) return { data: null, error: { message: "decision unavailable" } };
        const row = db.rows.find((r) => r.id === args.p_id);
        if (!row) return { data: { outcome: "missing" }, error: null };
        if (row.status !== "pending" && !(args.p_status === "declined" && row.status === "accepted")) {
          return { data: { outcome: "conflict" }, error: null };
        }
        Object.assign(row, { status: args.p_status, reviewed_at: "2026-11-10T09:00:00.000Z" });
        return {
          data: args.p_status === "declined" ? { outcome: "declined" } : {
            outcome: "accepted", proposal: row, fact: {
              id: "fact-1", proposal_id: row.id, venue_id: row.venue_id, account_id: row.account_id,
              kind: "correction", field: "hours", body: "Open until midnight Fri/Sat",
              published_at: row.reviewed_at, withdrawn_at: null,
            },
          },
          error: null,
        };
      },
    }),
  };
});

const fields = (over: Partial<OperatorProposalFields> = {}): OperatorProposalFields => ({
  venueId: "venue-1",
  accountId: "acct-1",
  type: "correction",
  payload: { field: "hours", body: "Open until midnight Fri/Sat" },
  ...over,
});

beforeEach(() => {
  db.rows = [];
  db.schemaMiss = false;
  db.failWrites = false;
  __resetOperatorProposals();
  __resetOperatorFacts();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("memoryOperatorProposalStore", () => {
  it("creates a pending proposal and lists it for review", async () => {
    const dto = await memoryOperatorProposalStore.create(fields());
    expect(dto.status).toBe("pending");
    expect(dto.payload.body).toBe("Open until midnight Fri/Sat");
    expect(await memoryOperatorProposalStore.listForReview("pending")).toHaveLength(1);
  });

  it("accept moves it out of pending and into the venue's accepted set", async () => {
    const dto = await memoryOperatorProposalStore.create(fields());
    expect(await memoryOperatorProposalStore.decide(dto.id, "accepted", "verified change")).toMatchObject({ outcome: "accepted" });
    expect(await memoryOperatorProposalStore.listForReview("pending")).toHaveLength(0);
    const accepted = await memoryOperatorProposalStore.listAcceptedForVenue("venue-1");
    expect(accepted).toHaveLength(1);
    expect(defined(accepted[0]).id).toBe(dto.id);
  });

  it("decline leaves nothing accepted", async () => {
    const dto = await memoryOperatorProposalStore.create(fields());
    await memoryOperatorProposalStore.decide(dto.id, "declined");
    expect(await memoryOperatorProposalStore.listAcceptedForVenue("venue-1")).toHaveLength(0);
  });

  it.each(["publish", "withdraw"] as const)("a failed %s changes neither status nor facts", async (effect) => {
    const proposal = await memoryOperatorProposalStore.create(fields());
    if (effect === "withdraw") await memoryOperatorProposalStore.decide(proposal.id, "accepted");
    const before = await memoryOperatorFactsStore.listPublishedForVenue("venue-1");
    const spy = vi.spyOn(memoryOperatorFactsStore, effect).mockImplementationOnce(() => { throw new Error("write failed"); });
    await expect(memoryOperatorProposalStore.decide(proposal.id, effect === "publish" ? "accepted" : "declined")).rejects.toThrow("write failed");
    spy.mockRestore();
    expect(await memoryOperatorProposalStore.listForReview(effect === "publish" ? "pending" : "accepted")).toMatchObject([{ id: proposal.id }]);
    expect(await memoryOperatorFactsStore.listPublishedForVenue("venue-1")).toEqual(before);
  });

  it("unknown decisions report missing", async () => {
    expect(await memoryOperatorProposalStore.decide("nope", "accepted")).toEqual({ outcome: "missing" });
  });
});

describe("supabaseOperatorProposalStore", () => {
  it("inserts, lists, and accepts", async () => {
    const dto = await supabaseOperatorProposalStore.create(fields());
    expect(db.rows).toHaveLength(1);
    expect(await supabaseOperatorProposalStore.listForReview("pending")).toHaveLength(1);
    expect(await supabaseOperatorProposalStore.decide(dto.id, "accepted")).toMatchObject({ outcome: "accepted" });
    expect(await supabaseOperatorProposalStore.listAcceptedForVenue("venue-1")).toHaveLength(1);
  });

  it("throws on a hard write failure (route maps that to 503)", async () => {
    db.failWrites = true;
    await expect(supabaseOperatorProposalStore.create(fields())).rejects.toThrow();
  });

  it("refuses moderation when the durable RPC is unavailable", async () => {
    const proposal = await memoryOperatorProposalStore.create(fields());
    db.schemaMiss = true;
    await expect(supabaseOperatorProposalStore.decide(proposal.id, "accepted")).rejects.toThrow("decision unavailable");
    expect(await memoryOperatorProposalStore.listForReview("pending")).toMatchObject([{ id: proposal.id }]);
    expect((await memoryOperatorFactsStore.listPublishedForVenue("venue-1")).facts).toEqual([]);
  });

  it("fails soft to memory on a schema miss", async () => {
    db.schemaMiss = true;
    const dto = await supabaseOperatorProposalStore.create(fields());
    expect(dto.status).toBe("pending");
    expect(await memoryOperatorProposalStore.listForReview("pending")).toHaveLength(1);
    expect(await supabaseOperatorProposalStore.listForReview("pending")).toHaveLength(1);
  });
});
