import { beforeEach, describe, expect, it, vi } from "vitest";

// lib/tableRequestsStore.ts, both halves. The memory store is read directly;
// the Supabase half runs against an in-memory fluent mock (no network). Three
// rules: a request is stored `pending` and only an `emailed` one is ever
// listed, a discarded request is gone, and a hard write failure THROWS so the
// delivery can tell the person PUBMAXX did not send it. A missing table falls
// back to memory outside production and refuses in production.

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
  rows: [] as Row[],
  schemaMiss: false,
  failWrites: false,
  production: false,
}));

vi.mock("@/lib/deploymentEnv", () => ({ isDeployedProduction: () => db.production }));

vi.mock("@/lib/venueAliases", () => ({
  storedVenueIds: async (id: string) => (id === "venue-new" ? ["venue-new", "venue-old"] : [id]),
}));

vi.mock("@/lib/supabase", () => {
  const TABLE_MISSING = "Could not find the table 'public.table_requests' in the schema cache";

  function makeQuery() {
    const state: {
      op: "select" | "insert" | "update" | "delete";
      row: Row | null;
      patch: Row | null;
      filters: ((r: Row) => boolean)[];
    } = { op: "select", row: null, patch: null, filters: [] };

    const run = () => {
      if (db.schemaMiss) return { data: null, error: { message: TABLE_MISSING } };
      if (state.op === "insert") {
        if (db.failWrites) return { data: null, error: { message: "insert boom" } };
        db.rows.push({ ...(state.row ?? {}) });
        return { data: null, error: null };
      }
      const rows = db.rows.filter((r) => state.filters.every((f) => f(r)));
      if (state.op === "update") {
        if (db.failWrites) return { data: null, error: { message: "update boom" } };
        rows.forEach((r) => Object.assign(r, state.patch));
        return { data: rows.map((r) => ({ id: r.id })), error: null };
      }
      if (state.op === "delete") {
        if (db.failWrites) return { data: null, error: { message: "delete boom" } };
        db.rows = db.rows.filter((r) => !rows.includes(r));
        return { data: rows.map((r) => ({ id: r.id })), error: null };
      }
      return { data: rows, error: null };
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
      delete() {
        state.op = "delete";
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
      order: () => q,
      limit: () => q,
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

import type { TableRequestFields } from "@/lib/tableRequests";
import {
  __resetTableRequests,
  memoryTableRequestsStore,
  supabaseTableRequestsStore,
  type TableRequestsStore,
} from "@/lib/tableRequestsStore";

const NOW = Date.parse("2026-11-02T18:00:00.000Z");

function fields(over: Partial<TableRequestFields> = {}): TableRequestFields {
  return {
    venueId: "venue-crown",
    requesterUserId: "a1111111-1111-4111-8111-111111111111",
    name: "Sam",
    partySize: 8,
    date: "2026-11-14",
    time: "19:30",
    note: null,
    contactKind: "email",
    contactValue: "sam@example.com",
    ...over,
  };
}

beforeEach(() => {
  db.rows = [];
  db.schemaMiss = false;
  db.failWrites = false;
  db.production = false;
  __resetTableRequests();
});

describe.each([
  ["memory", memoryTableRequestsStore],
  ["supabase", supabaseTableRequestsStore],
] as Array<[string, TableRequestsStore]>)("the %s table requests store", (_name, store) => {
  it("keeps a request pending and lists it only once it is emailed", async () => {
    const request = await store.create(fields(), NOW);
    expect(request).toMatchObject({ delivery: "pending", deliveredAt: null, partySize: 8 });
    expect((await store.listEmailedForVenue("venue-crown")).requests).toEqual([]);

    expect(await store.markEmailed(request.id, NOW + 1000)).toBe(true);
    expect(await store.markEmailed(request.id, NOW + 2000)).toBe(false);
    const listed = await store.listEmailedForVenue("venue-crown");
    expect(listed.status).toBe("ready");
    expect(listed.requests.map((r) => r.id)).toEqual([request.id]);
    expect(listed.requests[0]).toMatchObject({
      delivery: "emailed",
      deliveredAt: new Date(NOW + 1000).toISOString(),
      date: "2026-11-14",
      time: "19:30",
    });
  });

  it("forgets a discarded request", async () => {
    const request = await store.create(fields(), NOW);
    expect(await store.discard(request.id)).toBe(true);
    expect(await store.discard(request.id)).toBe(false);
    expect(await store.markEmailed(request.id)).toBe(false);
    expect((await store.listEmailedForVenue("venue-crown")).requests).toEqual([]);
  });

  it("reads the requester's own requests, pending and emailed, newest first, and nobody else's", async () => {
    const pending = await store.create(fields(), NOW);
    const emailed = await store.create(fields({ venueId: "venue-other" }), NOW + 60_000);
    await store.markEmailed(emailed.id, NOW + 61_000);
    await store.create(fields({ requesterUserId: "b1111111-1111-4111-8111-111111111111" }), NOW + 120_000);
    const read = await store.listForRequester("a1111111-1111-4111-8111-111111111111");
    expect(read.status).toBe("ready");
    expect(read.requests.map((r) => [r.id, r.delivery])).toEqual([
      [emailed.id, "emailed"],
      [pending.id, "pending"],
    ]);
    expect((await store.listForRequester("a1111111-1111-4111-8111-111111111111", 1)).requests).toHaveLength(1);
  });

  it("lists a pub under every id it was stored under, newest first, and no other pub", async () => {
    const older = await store.create(fields({ venueId: "venue-old" }), NOW);
    const newer = await store.create(fields({ venueId: "venue-new" }), NOW + 60_000);
    const other = await store.create(fields({ venueId: "venue-crown" }), NOW);
    for (const request of [older, newer, other]) await store.markEmailed(request.id, NOW + 120_000);
    const listed = await store.listEmailedForVenue("venue-new");
    expect(listed.requests.map((r) => r.id)).toEqual([newer.id, older.id]);
  });
});

describe("the Supabase table requests store on a bad day", () => {
  it("writes the row it was given, columns named for the migration", async () => {
    await supabaseTableRequestsStore.create(fields({ note: "Birthday" }), NOW);
    expect(db.rows[0]).toMatchObject({
      venue_id: "venue-crown",
      requester_name: "Sam",
      party_size: 8,
      requested_date: "2026-11-14",
      requested_time: "19:30",
      note: "Birthday",
      contact_kind: "email",
      contact_value: "sam@example.com",
      delivery: "pending",
      delivered_at: null,
    });
  });

  it("throws on a hard write failure", async () => {
    db.failWrites = true;
    await expect(supabaseTableRequestsStore.create(fields(), NOW)).rejects.toThrow("insert boom");
  });

  it("drops a row it cannot read, and a pending row a query let through", async () => {
    db.rows = [
      { id: "broken", venue_id: "venue-crown", delivery: "emailed" },
      {
        id: "pending-row", venue_id: "venue-crown", requester_user_id: "u", requester_name: "Sam",
        party_size: 8, requested_date: "2026-11-14", requested_time: "19:30:00", contact_kind: "email",
        contact_value: "sam@example.com", delivery: "pending", created_at: "2026-11-02T18:00:00.000Z",
      },
    ];
    const read = await supabaseTableRequestsStore.listEmailedForVenue("venue-crown");
    expect(read).toEqual({ status: "ready", requests: [] });
  });

  it("answers the requester's read degraded and empty when the query fails", async () => {
    await supabaseTableRequestsStore.create(fields(), NOW);
    db.schemaMiss = false;
    const original = db.rows;
    db.rows = new Proxy([] as Row[], {
      get(target, key) {
        if (key === "filter") throw new Error("read boom");
        return Reflect.get(target, key);
      },
    });
    const read = await supabaseTableRequestsStore.listForRequester("a1111111-1111-4111-8111-111111111111");
    expect(read).toEqual({ status: "degraded", requests: [] });
    db.rows = original;
  });

  it("falls back to memory when the table is missing outside production", async () => {
    db.schemaMiss = true;
    const request = await supabaseTableRequestsStore.create(fields(), NOW);
    expect(await supabaseTableRequestsStore.markEmailed(request.id, NOW)).toBe(true);
    const read = await supabaseTableRequestsStore.listEmailedForVenue("venue-crown");
    expect(read.requests.map((r) => r.id)).toEqual([request.id]);
  });

  it("refuses a write in production while the table is missing", async () => {
    db.schemaMiss = true;
    db.production = true;
    await expect(supabaseTableRequestsStore.create(fields(), NOW)).rejects.toThrow(/apply migration 0219/);
  });
});
