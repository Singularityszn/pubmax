import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetWhatsOnListingStore,
  memoryWhatsOnListingStore,
  supabaseWhatsOnListingStore,
  whatsOnListingStore,
} from "@/lib/whatsOnListingStore";
import type { WhatsOnRow } from "@/lib/whatsOn";
import { defined } from "@/__tests__/helpers/defined";

type Row = Record<string, unknown> & { id: string; kind: string };

const MAX_ROWS = vi.hoisted(() => 1_000);

const db = vi.hoisted(() => ({
  rows: [] as Row[],
  generations: [] as Array<{ kind: string; generated_at: string }>,
  failWrite: false,
  schemaMiss: false,
  configured: true,
  requiresStore: false,
  boundFilters: [] as string[],
  rowsServed: 0,
}));

// PostgREST's `payload->>key` column: the payload's field read as text.
function payloadText(row: Row, field: string): unknown {
  const [column, key] = field.split("->>");
  const value = row[defined(column)];
  return key ? (value as Record<string, unknown> | undefined)?.[key] : value;
}

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => db.configured,
  requiresSupabaseStore: () => db.requiresStore,
  requireSupabaseAdmin: () => ({
    rpc(_name: string, args: { p_kind: string; p_rows: Row[]; p_generated_at: string }) {
      if (db.schemaMiss) {
        return Promise.resolve({
          data: null,
          error: { message: "Could not find the table 'public.whats_on_listings'" },
        });
      }
      if (db.failWrite) return Promise.resolve({ data: null, error: { message: "write boom" } });
      db.rows = db.rows.filter((row) => row.kind !== args.p_kind);
      db.rows.push(...args.p_rows);
      db.generations = db.generations.filter((row) => row.kind !== args.p_kind);
      db.generations.push({ kind: args.p_kind, generated_at: args.p_generated_at });
      return Promise.resolve({ data: args.p_rows.length, error: null });
    },
    from: (table: string) => ({
      select() {
        if (table === "whats_on_listings") {
          const filters: Array<(row: Row) => boolean> = [];
          const query = {
            eq(field: string, value: string) {
              filters.push((row) => row[field] === value);
              return query;
            },
            neq(field: string, value: string) {
              filters.push((row) => row[field] !== value);
              return query;
            },
            gte(field: string, value: string) {
              db.boundFilters.push(`${field}>=${value}`);
              filters.push((row) => String(payloadText(row, field)) >= value);
              return query;
            },
            lt(field: string, value: string) {
              db.boundFilters.push(`${field}<${value}`);
              filters.push((row) => String(payloadText(row, field)) < value);
              return query;
            },
            order(column: string) {
              return {
                range(from: number, to: number) {
                  if (db.schemaMiss) {
                    return Promise.resolve({
                      data: null,
                      error: { message: "Could not find the table 'public.whats_on_listings'" },
                    });
                  }
                  const matching = db.rows
                    .filter((row) => filters.every((keep) => keep(row)))
                    .sort((a, b) => String(a[column]).localeCompare(String(b[column])));
                  // PostgREST's hosted max-rows cap: one response never exceeds it.
                  const page = matching.slice(from, Math.min(to + 1, from + MAX_ROWS));
                  db.rowsServed += page.length;
                  return Promise.resolve({ data: page, error: null });
                },
              };
            },
          };
          return query;
        }
        if (db.schemaMiss) {
          return Promise.resolve({
            data: null,
            error: { message: "Could not find the table 'public.whats_on_listings'" },
          });
        }
        return Promise.resolve({ data: db.generations, error: null });
      },
    }),
  }),
}));

const GENERATED = "2026-08-24T05:30:00.000Z";

function eventRow(id: string, over: Partial<WhatsOnRow> = {}): WhatsOnRow {
  return {
    id,
    placeName: "Jazz Cafe",
    kind: "event",
    startsAt: "2026-08-24T19:00:00.000Z",
    endsAt: "2026-08-24T22:00:00.000Z",
    title: "Live jazz",
    source: { label: "Ticketmaster", url: `https://www.ticketmaster.co.uk/event/${id}` },
    observedAt: "2026-08-24T10:00:00.000Z",
    confidence: "listed",
    sourceId: id,
    ...over,
  };
}

beforeEach(() => {
  db.rows = [];
  db.generations = [];
  db.failWrite = false;
  db.schemaMiss = false;
  db.configured = true;
  db.requiresStore = false;
  db.boundFilters = [];
  db.rowsServed = 0;
  __resetWhatsOnListingStore();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("whatsOnListingStore selection", () => {
  it("answers an unavailable store where a durable store is required and absent", async () => {
    db.configured = false;
    db.requiresStore = true;
    const store = whatsOnListingStore();
    expect(store).not.toBe(memoryWhatsOnListingStore);
    expect(store).not.toBe(supabaseWhatsOnListingStore);
    await expect(store.readAll()).resolves.toEqual({ rows: [], generatedAt: null, failed: true });
  });

  // Playwright's keyless production server runs NODE_ENV=production with
  // PUBMAX_E2E_KEYLESS=1, so requiresSupabaseStore() is false there. The store
  // used to ask isDeployedProduction() instead, and every keyless read failed.
  it("reads memory on a keyless production server, as selectStore does", async () => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NODE_ENV", "production");
    db.configured = false;
    db.requiresStore = false;
    await memoryWhatsOnListingStore.replaceKind("event", [eventRow("keyless")], GENERATED);
    const store = whatsOnListingStore();
    expect(store).toBe(memoryWhatsOnListingStore);
    const snap = await store.readAll();
    expect(snap.failed).toBeUndefined();
    expect(snap.rows.map((row) => row.id)).toEqual(["keyless"]);
  });

  it("reads Supabase when it is configured", () => {
    db.configured = true;
    db.requiresStore = true;
    expect(whatsOnListingStore()).toBe(supabaseWhatsOnListingStore);
  });
});

describe("memoryWhatsOnListingStore", () => {
  it("replaces one kind and leaves the others", async () => {
    await memoryWhatsOnListingStore.replaceKind(
      "quiz",
      [eventRow("quiz-1", { kind: "quiz", id: "quiz-1", sourceId: "quiz-1" })],
      GENERATED,
    );
    await memoryWhatsOnListingStore.replaceKind("event", [eventRow("tm-1")], GENERATED);
    await memoryWhatsOnListingStore.replaceKind("event", [eventRow("tm-2")], GENERATED);
    const snap = await memoryWhatsOnListingStore.readAll();
    expect(snap.rows.map((row) => row.id).sort()).toEqual(["quiz-1", "tm-2"]);
    expect(snap.generatedAt).toBe(GENERATED);
  });

  it("reads empty when nothing has been written", async () => {
    expect(await memoryWhatsOnListingStore.readAll()).toEqual({ rows: [], generatedAt: null });
  });

  it("keeps the durable generation stamp when a successful refresh wrote zero rows", async () => {
    db.generations = [{ kind: "event", generated_at: GENERATED }];
    expect(await supabaseWhatsOnListingStore.readAll()).toEqual({
      rows: [],
      generatedAt: GENERATED,
    });
  });

  it("rejects a stale replacement", async () => {
    await memoryWhatsOnListingStore.replaceKind("event", [eventRow("new")], "2026-08-24T06:00:00.000Z");
    const outcome = await memoryWhatsOnListingStore.replaceKind(
      "event",
      [eventRow("old")],
      "2026-08-24T05:00:00.000Z",
    );
    expect(outcome).toEqual({ written: 0, failed: true });
    expect((await memoryWhatsOnListingStore.readAll()).rows.map((row) => row.id)).toEqual(["new"]);
  });

  it("uses the oldest kind generation for the combined freshness stamp", async () => {
    await memoryWhatsOnListingStore.replaceKind("event", [eventRow("event")], "2026-08-24T05:00:00.000Z");
    await memoryWhatsOnListingStore.replaceKind(
      "quiz",
      [eventRow("quiz", { kind: "quiz", sourceId: "quiz" })],
      "2026-08-24T06:00:00.000Z",
    );
    expect((await memoryWhatsOnListingStore.readAll()).generatedAt).toBe("2026-08-24T05:00:00.000Z");
  });
});

describe("supabaseWhatsOnListingStore", () => {
  it("writes and reads against the durable backend", async () => {
    const outcome = await supabaseWhatsOnListingStore.replaceKind("event", [eventRow("tm-1")], GENERATED);
    expect(outcome).toEqual({ written: 1 });
    const snap = await supabaseWhatsOnListingStore.readAll();
    expect(snap.rows).toHaveLength(1);
    expect(defined(snap.rows[0]).id).toBe("tm-1");
  });

  it("uses the oldest durable kind generation for combined freshness", async () => {
    await supabaseWhatsOnListingStore.replaceKind("event", [eventRow("event")], "2026-08-24T05:00:00.000Z");
    await supabaseWhatsOnListingStore.replaceKind(
      "quiz",
      [eventRow("quiz", { kind: "quiz", sourceId: "quiz" })],
      "2026-08-24T06:00:00.000Z",
    );
    expect((await supabaseWhatsOnListingStore.readAll()).generatedAt).toBe("2026-08-24T05:00:00.000Z");
  });

  it("reads every durable row past the PostgREST max-rows cap", async () => {
    const rows = Array.from({ length: 2_500 }, (_, i) =>
      eventRow(`tm-${String(i).padStart(4, "0")}`),
    );
    await supabaseWhatsOnListingStore.replaceKind("event", rows, GENERATED);
    await supabaseWhatsOnListingStore.replaceKind(
      "quiz",
      [eventRow("quiz-1", { kind: "quiz", sourceId: "quiz-1" })],
      GENERATED,
    );

    const snap = await supabaseWhatsOnListingStore.readAll();
    expect(snap.failed).toBeUndefined();
    expect(snap.rows).toHaveLength(2_501);
    expect(snap.rows.some((row) => row.id === "quiz-1")).toBe(true);
  });

  it("leaves sport rows outside a bounded read in the table", async () => {
    const sport = (id: string, startsAt: string) =>
      eventRow(id, { kind: "sport", startsAt, endsAt: undefined, sourceId: id });
    const outside = Array.from({ length: 60 }, (_, i) =>
      sport(`later-${i}`, `2026-10-${String(10 + (i % 5)).padStart(2, "0")}T20:00:00+01:00`),
    );
    await supabaseWhatsOnListingStore.replaceKind(
      "sport",
      [
        ...outside,
        sport("edge-in", "2026-10-06T20:00:00+01:00"),
        sport("edge-out", "2026-10-06T19:30:00+01:00"),
        sport("tonight", "2026-10-06T21:00:00+01:00"),
      ],
      GENERATED,
    );
    await supabaseWhatsOnListingStore.replaceKind(
      "quiz",
      [eventRow("quiz-1", { kind: "quiz", sourceId: "quiz-1" })],
      GENERATED,
    );
    db.rowsServed = 0;

    const snap = await supabaseWhatsOnListingStore.readAll({
      sportStartsFrom: Date.parse("2026-10-06T19:00:00.000Z"),
      sportStartsBefore: Date.parse("2026-10-07T03:00:00.000Z"),
    });

    expect(snap.rows.map((row) => row.id).sort()).toEqual(["edge-in", "quiz-1", "tonight"]);
    expect(db.boundFilters.length).toBe(2);
    expect(db.rowsServed).toBeLessThan(10);
  });

  it("reads one kind without pulling sport rows", async () => {
    await supabaseWhatsOnListingStore.replaceKind(
      "sport",
      [eventRow("sport-1", { kind: "sport", sourceId: "sport-1", endsAt: undefined })],
      GENERATED,
    );
    await supabaseWhatsOnListingStore.replaceKind("event", [eventRow("tm-1")], GENERATED);
    db.rowsServed = 0;

    const snap = await supabaseWhatsOnListingStore.readAll({ kind: "event" });
    expect(snap.rows.map((row) => row.id)).toEqual(["tm-1"]);
    expect(db.rowsServed).toBe(1);
  });

  it("reads the generation stamp without reading listing rows", async () => {
    await supabaseWhatsOnListingStore.replaceKind("event", [eventRow("tm-1")], GENERATED);
    db.rowsServed = 0;
    await expect(supabaseWhatsOnListingStore.readGeneratedAt()).resolves.toEqual({
      generatedAt: GENERATED,
    });
    expect(db.rowsServed).toBe(0);
  });

  it("reads only London rows from the durable table", async () => {
    await supabaseWhatsOnListingStore.replaceKind("event", [eventRow("london")], GENERATED);
    db.rows.push({
      id: "manchester",
      kind: "event",
      city: "manchester",
      payload: eventRow("manchester", { placeName: "Manchester Arena" }),
      observed_at: "2026-08-24T10:00:00.000Z",
      generated_at: GENERATED,
    });

    expect((await supabaseWhatsOnListingStore.readAll()).rows.map((row) => row.id)).toEqual([
      "london",
    ]);
  });

  it("flags a hard write failure", async () => {
    await supabaseWhatsOnListingStore.replaceKind("event", [eventRow("kept")], GENERATED);
    db.failWrite = true;
    const outcome = await supabaseWhatsOnListingStore.replaceKind("event", [eventRow("tm-1")], GENERATED);
    expect(outcome.failed).toBe(true);
    expect(outcome.written).toBe(0);
    expect((await supabaseWhatsOnListingStore.readAll()).rows.map((row) => row.id)).toEqual(["kept"]);
  });

  it("refuses a schema-miss memory write in deployed production", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    db.schemaMiss = true;
    const outcome = await supabaseWhatsOnListingStore.replaceKind("event", [eventRow("lost")], GENERATED);
    expect(outcome).toEqual({ written: 0, failed: true });
    expect(await memoryWhatsOnListingStore.readAll()).toEqual({ rows: [], generatedAt: null });
  });

  it("marks a schema-miss read as failed while retaining memory fallback rows", async () => {
    await memoryWhatsOnListingStore.replaceKind("event", [eventRow("memory")], GENERATED);
    db.schemaMiss = true;
    await expect(supabaseWhatsOnListingStore.readAll()).resolves.toEqual({
      rows: [eventRow("memory")],
      generatedAt: GENERATED,
      failed: true,
      failure: "durable table missing (apply migration 0119)",
    });
  });
});
