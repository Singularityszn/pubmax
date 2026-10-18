// The durable price trust queue under migration 0192: one unreadable row is
// skipped and the rest of the batch is worked, only a failed read is degraded,
// and a failed run is counted against the version the worker read. A deploy
// ahead of 0192 (no column, no function) keeps the 0126 behaviour.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type QueueRead = {
  data: unknown[] | null;
  error: { code?: string; message: string } | null;
};

const state = vi.hoisted(() => ({
  rows: [] as unknown[],
  readError: null as { code?: string; message: string } | null,
  deadLetterColumnMissing: false,
  filteredOnDeadLetter: [] as boolean[],
  rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
  rpcAnswer: { data: null as unknown, error: null as { code?: string; message: string } | null },
}));

function makeQueueQuery() {
  let deadLetterFilter = false;
  const query = {
    select() {
      return query;
    },
    is(column: string, value: unknown) {
      if (column === "dead_lettered_at" && value === null) deadLetterFilter = true;
      return query;
    },
    order() {
      return query;
    },
    limit() {
      return query;
    },
    then(resolve: (value: QueueRead) => unknown, reject?: (reason: unknown) => unknown) {
      state.filteredOnDeadLetter.push(deadLetterFilter);
      let answer: QueueRead;
      if (deadLetterFilter && state.deadLetterColumnMissing) {
        answer = {
          data: null,
          error: {
            code: "42703",
            message: "column price_trust_reconciliation_queue.dead_lettered_at does not exist",
          },
        };
      } else if (state.readError) {
        answer = { data: null, error: state.readError };
      } else {
        answer = { data: state.rows, error: null };
      }
      return Promise.resolve(answer).then(resolve, reject);
    },
  };
  return query;
}

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  requiresSupabaseStore: () => true,
  requireSupabaseAdmin: () => ({
    from: () => makeQueueQuery(),
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args });
      return state.rpcAnswer;
    },
  }),
}));

import { supabasePriceTrustEventStore } from "@/lib/priceTrustEventStore";

const GOOD_A = {
  venue_id: "venue-a",
  category: "beer",
  version: 3,
  enqueued_at: "2026-10-18T10:00:00.000Z",
};
const GOOD_B = {
  venue_id: "venue-b",
  category: "wine",
  version: 4,
  enqueued_at: "2026-10-18T10:00:01.000Z",
};
// A row the parser refuses: its version is not a positive integer.
const POISON = {
  venue_id: "venue-poison",
  category: "beer",
  version: "not-a-version",
  enqueued_at: "2026-10-18T09:59:59.000Z",
};

function loggedEvents(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown>[] {
  return spy.mock.calls
    .map((call: unknown[]) => {
      try {
        return JSON.parse(String(call[0])) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((line: Record<string, unknown> | null): line is Record<string, unknown> => line !== null);
}

beforeEach(() => {
  state.rows = [];
  state.readError = null;
  state.deadLetterColumnMissing = false;
  state.filteredOnDeadLetter = [];
  state.rpcCalls = [];
  state.rpcAnswer = { data: null, error: null };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("supabasePriceTrustEventStore.listPendingReconciliations", () => {
  it("skips one unparseable row, logs it, and returns the rest of the batch", async () => {
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    state.rows = [POISON, GOOD_A, GOOD_B];

    const listed = await supabasePriceTrustEventStore.listPendingReconciliations(20);

    expect(listed.degraded).toBe(false);
    expect(listed.tasks).toEqual([
      { venueId: "venue-a", category: "beer", version: 3, enqueuedAt: GOOD_A.enqueued_at },
      { venueId: "venue-b", category: "wine", version: 4, enqueuedAt: GOOD_B.enqueued_at },
    ]);
    const warned = loggedEvents(out).filter(
      (line) => line.event === "price_trust.queue_row_unparseable",
    );
    expect(warned).toHaveLength(1);
    expect(warned[0]).toMatchObject({ level: "warn", venueId: "venue-poison", category: "beer" });
  });

  it("stays degraded when the whole read fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    state.readError = { code: "57014", message: "canceling statement due to statement timeout" };

    expect(await supabasePriceTrustEventStore.listPendingReconciliations(20)).toEqual({
      tasks: [],
      degraded: true,
    });
  });

  it("lists only live rows, and reads as 0126 did when the 0192 column is absent", async () => {
    state.rows = [GOOD_A];
    expect((await supabasePriceTrustEventStore.listPendingReconciliations(20)).tasks).toHaveLength(1);
    expect(state.filteredOnDeadLetter).toEqual([true]);

    state.filteredOnDeadLetter = [];
    state.deadLetterColumnMissing = true;
    const listed = await supabasePriceTrustEventStore.listPendingReconciliations(20);
    expect(listed).toMatchObject({ degraded: false });
    expect(listed.tasks.map((task) => task.venueId)).toEqual(["venue-a"]);
    expect(state.filteredOnDeadLetter).toEqual([true, false]);
  });
});

describe("supabasePriceTrustEventStore.recordReconciliationFailure", () => {
  const TASK = {
    venueId: "venue-a",
    category: "beer" as const,
    version: 3,
    enqueuedAt: GOOD_A.enqueued_at,
  };

  it("sends the read version and the cap, and reports a retry", async () => {
    state.rpcAnswer = { data: [{ attempts: 2, dead_lettered: false }], error: null };

    expect(await supabasePriceTrustEventStore.recordReconciliationFailure(TASK, 5)).toEqual({
      status: "retrying",
      attempts: 2,
    });
    expect(state.rpcCalls).toEqual([
      {
        name: "record_price_trust_reconciliation_failure",
        args: { p_venue_id: "venue-a", p_category: "beer", p_version: 3, p_max_attempts: 5 },
      },
    ]);
  });

  it("reports the dead letter at the cap", async () => {
    state.rpcAnswer = { data: [{ attempts: 5, dead_lettered: true }], error: null };
    expect(await supabasePriceTrustEventStore.recordReconciliationFailure(TASK, 5)).toEqual({
      status: "dead-lettered",
      attempts: 5,
    });
  });

  it("charges nothing when a newer write moved the version on", async () => {
    state.rpcAnswer = { data: [], error: null };
    expect(await supabasePriceTrustEventStore.recordReconciliationFailure(TASK, 5)).toEqual({
      status: "superseded",
    });
  });

  it("answers legacy when the 0192 function is absent", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    state.rpcAnswer = {
      data: null,
      error: {
        code: "PGRST202",
        message:
          "Could not find the function public.record_price_trust_reconciliation_failure(p_category, p_max_attempts, p_venue_id, p_version) in the schema cache",
      },
    };
    expect(await supabasePriceTrustEventStore.recordReconciliationFailure(TASK, 5)).toEqual({
      status: "legacy",
    });
  });

  it("answers failed on any other error, and refuses a cap below one", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    state.rpcAnswer = { data: null, error: { code: "08006", message: "connection failure" } };
    expect(await supabasePriceTrustEventStore.recordReconciliationFailure(TASK, 5)).toEqual({
      status: "failed",
    });

    state.rpcCalls = [];
    expect(await supabasePriceTrustEventStore.recordReconciliationFailure(TASK, 0)).toEqual({
      status: "failed",
    });
    expect(state.rpcCalls).toEqual([]);
  });
});
