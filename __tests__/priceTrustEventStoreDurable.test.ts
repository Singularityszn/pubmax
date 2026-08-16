import { beforeEach, describe, expect, it, vi } from "vitest";

type EventRow = {
  id: string;
  evidence_fingerprint: string;
  venue_id: string;
  category: string;
  observation_ids: string[];
  created_at: string;
  reversal_of: string | null;
};

const events: EventRow[] = [];
let reversalReadFails = false;

type QueryState = {
  eq: [string, unknown][];
  isNull: string[];
  inFilters: [string, unknown[]][];
};

function matches(row: EventRow, state: QueryState): boolean {
  const record = row as unknown as Record<string, unknown>;
  for (const [column, value] of state.eq) {
    if (record[column] !== value) return false;
  }
  for (const column of state.isNull) {
    if (record[column] !== null) return false;
  }
  for (const [column, values] of state.inFilters) {
    if (!values.includes(record[column])) return false;
  }
  return true;
}

function makeQuery() {
  const state: QueryState = { eq: [], isNull: [], inFilters: [] };
  const query = {
    select() {
      return query;
    },
    eq(column: string, value: unknown) {
      state.eq.push([column, value]);
      return query;
    },
    is(column: string, value: unknown) {
      if (value === null) state.isNull.push(column);
      return query;
    },
    in(column: string, values: unknown[]) {
      state.inFilters.push([column, values]);
      return query;
    },
    contains(column: string, values: unknown[]) {
      state.inFilters.push([column, values]);
      return query;
    },
    then(
      resolve: (value: unknown) => unknown,
      reject?: (reason: unknown) => unknown,
    ) {
      const readsReversals = state.inFilters.some(([column]) => column === "reversal_of");
      if (readsReversals && reversalReadFails) {
        return Promise.resolve({
          data: null,
          error: { message: "database unavailable" },
        }).then(resolve, reject);
      }
      return Promise.resolve({
        data: events.filter((row) => matches(row, state)),
        error: null,
      }).then(resolve, reject);
    },
  };
  return query;
}

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  requireSupabaseAdmin: () => ({ from: () => makeQuery() }),
}));

import { supabasePriceTrustEventStore } from "@/lib/priceTrustEventStore";

const UNLOCK: EventRow = {
  id: "event-one",
  evidence_fingerprint: "fingerprint-one",
  venue_id: "venue-one",
  category: "beer",
  observation_ids: ["obs-a", "obs-b"],
  created_at: "2026-08-16T18:00:00.000Z",
  reversal_of: null,
};

beforeEach(() => {
  events.length = 0;
  reversalReadFails = false;
});

describe("supabasePriceTrustEventStore.liveEventsFor", () => {
  it("answers the live unlock when both reads land", async () => {
    events.push(UNLOCK);
    const live = await supabasePriceTrustEventStore.liveEventsFor("venue-one", "beer");
    expect(live.degraded).toBe(false);
    expect(live.events.map((event) => event.id)).toEqual(["event-one"]);
  });

  it("drops an unlock a reversal already covered", async () => {
    events.push(UNLOCK, {
      ...UNLOCK,
      id: "event-two",
      evidence_fingerprint: "fingerprint-two",
      observation_ids: [],
      reversal_of: "event-one",
    });
    const live = await supabasePriceTrustEventStore.liveEventsFor("venue-one", "beer");
    expect(live.degraded).toBe(false);
    expect(live.events).toEqual([]);
  });

  it("degrades when the reversal read fails instead of reporting a reversed unlock as live", async () => {
    events.push(UNLOCK);
    reversalReadFails = true;
    await expect(
      supabasePriceTrustEventStore.liveEventsFor("venue-one", "beer"),
    ).resolves.toEqual({ events: [], degraded: true });
  });

  it("skips the reversal read when no unlock matched", async () => {
    reversalReadFails = true;
    await expect(
      supabasePriceTrustEventStore.liveEventsFor("venue-one", "beer"),
    ).resolves.toEqual({ events: [], degraded: false });
  });
});
