import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hermetic tests for BOTH backends of the area-demand store. The memory backend
// is exercised directly; the Supabase backend runs against an in-memory fluent
// mock of the admin client (no network), proving the durable path's insert +
// count-by-area-key match the process-memory contract, while schema misses fall
// back only outside deployed production.

import {
  __resetAreaDemand,
  memoryAreaDemandStore,
  supabaseAreaDemandStore,
} from "@/lib/areaDemandStore";
import type { NormalisedAreaDemand } from "@/lib/areaDemand";

type Row = {
  id?: string;
  area: string;
  area_key: string;
  matched_patch_id: string | null;
  source: string;
  email: string | null;
  created_at: string;
};

const db = vi.hoisted(() => ({
  rows: [] as Row[],
  failInsert: false,
  failRead: false,
  schemaMiss: false,
  selectedColumns: "",
  orderColumns: [] as string[],
  rangePages: [] as string[][],
}));

vi.mock("@/lib/supabase", () => {
  function makeQuery() {
    let op: "insert" | "select" | null = null;
    let selectCount = false;
    let lowerBound: string | null = null;
    let upperBound: string | null = null;
    const orderRules: Array<{
      column: "created_at" | "id";
      ascending: boolean;
    }> = [];
    const filters: { column: string; value: unknown }[] = [];

    const query = {
      insert(row: Row) {
        op = "insert";
        if (db.schemaMiss) {
          return Promise.resolve({
            error: { message: "Could not find the table 'public.area_demand'" },
          });
        }
        if (db.failInsert) {
          return Promise.resolve({ error: { message: "insert boom" } });
        }
        db.rows.push(row);
        return Promise.resolve({ error: null });
      },
      select(_cols: string, opts?: { count?: string; head?: boolean }) {
        op = "select";
        db.selectedColumns = _cols;
        selectCount = Boolean(opts?.count);
        return query;
      },
      gte(column: string, value: unknown) {
        filters.push({ column, value });
        if (column === "created_at" && typeof value === "string") lowerBound = value;
        return query;
      },
      lte(column: string, value: unknown) {
        filters.push({ column, value });
        if (column === "created_at" && typeof value === "string") upperBound = value;
        return query;
      },
      order(column: string, options?: { ascending?: boolean }) {
        db.orderColumns.push(column);
        if (column === "created_at" || column === "id") {
          orderRules.push({
            column,
            ascending: options?.ascending === true,
          });
        }
        return query;
      },
      range(from: number, to: number) {
        if (db.schemaMiss) {
          return Promise.resolve({
            data: null,
            error: { message: "Could not find the table 'public.area_demand'" },
          });
        }
        if (db.failRead) {
          return Promise.resolve({ data: null, error: { message: "read boom" } });
        }
        const ordered = db.rows
          .filter(
            (row) =>
              (!lowerBound || row.created_at >= lowerBound) &&
              (!upperBound || row.created_at <= upperBound),
          )
          .sort((a, b) => {
            for (const rule of orderRules) {
              const aValue =
                rule.column === "created_at" ? a.created_at : (a.id ?? "");
              const bValue =
                rule.column === "created_at" ? b.created_at : (b.id ?? "");
              const comparison = aValue.localeCompare(bValue);
              if (comparison !== 0) {
                return rule.ascending ? comparison : -comparison;
              }
            }
            return 0;
          });
        const data = ordered.slice(from, to + 1);
        db.rangePages.push(data.map((row) => row.id ?? ""));
        return Promise.resolve({ data, error: null });
      },
      eq(column: string, value: unknown) {
        filters.push({ column, value });
        if (db.schemaMiss) {
          return Promise.resolve({
            count: null,
            error: { message: "Could not find the table 'public.area_demand'" },
          });
        }
        const key = filters.find((f) => f.column === "area_key")?.value;
        const count = db.rows.filter((r) => r.area_key === key).length;
        return Promise.resolve({ count: selectCount ? count : null, error: null });
      },
    };
    void op;
    return query;
  }

  return {
    isSupabaseConfigured: () => true,
    requireSupabaseAdmin: () => ({ from: () => makeQuery() }),
  };
});

const input = (over: Partial<NormalisedAreaDemand> = {}): NormalisedAreaDemand => ({
  area: "Peckham",
  matchedPatchId: null,
  source: "area-picker",
  email: null,
  ...over,
});

beforeEach(() => {
  db.rows = [];
  db.failInsert = false;
  db.failRead = false;
  db.schemaMiss = false;
  db.selectedColumns = "";
  db.orderColumns = [];
  db.rangePages = [];
  __resetAreaDemand();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("memoryAreaDemandStore", () => {
  it("records a demand signal without an email", async () => {
    const outcome = await memoryAreaDemandStore.record(input());
    expect(outcome).toEqual({ status: "recorded" });
    expect(await memoryAreaDemandStore.countForArea("peckham")).toBe(1);
  });

  it("counts by normalised area key, case-insensitively", async () => {
    await memoryAreaDemandStore.record(input({ area: "Peckham" }));
    await memoryAreaDemandStore.record(input({ area: "peckham" }));
    await memoryAreaDemandStore.record(input({ area: "Deptford" }));
    expect(await memoryAreaDemandStore.countForArea("PECKHAM")).toBe(2);
    expect(await memoryAreaDemandStore.countForArea("deptford")).toBe(1);
  });

  it("keeps an offered email but never requires it", async () => {
    await memoryAreaDemandStore.record(input({ email: "me@example.com" }));
    await memoryAreaDemandStore.record(input());
    expect(await memoryAreaDemandStore.countForArea("peckham")).toBe(2);
  });

  it("flags a blank area as a degraded write", async () => {
    const outcome = await memoryAreaDemandStore.record(input({ area: "   " }));
    expect(outcome.failed).toBe(true);
  });

  it("ranks recent demand without merging different matched patches", async () => {
    const now = Date.UTC(2026, 7, 15, 12);
    await memoryAreaDemandStore.record(
      input({ area: "Camden", matchedPatchId: "camden", source: "area-picker" }),
      now - 4 * 86_400_000,
    );
    await memoryAreaDemandStore.record(
      input({ area: "camden", matchedPatchId: "camden", source: "map-miss" }),
      now - 2 * 86_400_000,
    );
    await memoryAreaDemandStore.record(
      input({ area: "Camden", matchedPatchId: null, source: "near-empty" }),
      now - 86_400_000,
    );
    for (let day = 5; day >= 3; day -= 1) {
      await memoryAreaDemandStore.record(
        input({ area: "Deptford", matchedPatchId: null, source: "map-miss" }),
        now - day * 86_400_000,
      );
    }
    await memoryAreaDemandStore.record(
      input({ area: "Old Kent Road", source: "map-miss" }),
      now - 40 * 86_400_000,
    );

    expect(
      await memoryAreaDemandStore.listSummary({ limit: 3, sinceDays: 30 }, now),
    ).toEqual({
      items: [
        expect.objectContaining({
          area: "Deptford",
          areaKey: "deptford",
          matchedPatchId: null,
          signalCount: 3,
          sourceCounts: {
            "area-picker": 0,
            "map-miss": 3,
            "near-empty": 0,
          },
        }),
        expect.objectContaining({
          area: "camden",
          areaKey: "camden",
          matchedPatchId: "camden",
          signalCount: 2,
          sourceCounts: {
            "area-picker": 1,
            "map-miss": 1,
            "near-empty": 0,
          },
        }),
        expect.objectContaining({
          area: "Camden",
          areaKey: "camden",
          matchedPatchId: null,
          signalCount: 1,
        }),
      ],
      partial: false,
      status: "ready",
    });
  });

  it("keeps keyless records across separate Next route bundles", async () => {
    await memoryAreaDemandStore.record(input({ area: "Sheffield" }));

    vi.resetModules();
    const reloaded = await import("@/lib/areaDemandStore");

    expect(await reloaded.memoryAreaDemandStore.countForArea("sheffield")).toBe(1);
    reloaded.__resetAreaDemand();
  });

  it("uses latest activity as the tie-break and reports exact bounds", async () => {
    const now = Date.UTC(2026, 7, 15, 12);
    await memoryAreaDemandStore.record(
      input({ area: "Alpha", source: "map-miss" }),
      now - 2_000,
    );
    await memoryAreaDemandStore.record(
      input({ area: "Beta", source: "area-picker" }),
      now - 1_000,
    );

    const result = await memoryAreaDemandStore.listSummary(
      { limit: 10, sinceDays: 30 },
      now,
    );

    expect(result.items.map((row) => row.area)).toEqual(["Beta", "Alpha"]);
    expect(result.items[0]).toMatchObject({
      firstSeen: new Date(now - 1_000).toISOString(),
      lastSeen: new Date(now - 1_000).toISOString(),
    });
  });

  it("marks memory results partial only when an eviction can overlap the window", async () => {
    const now = Date.UTC(2026, 7, 15, 12);
    await memoryAreaDemandStore.record(input({ area: "Old demand" }), now - 40 * 86_400_000);
    for (let index = 0; index < 50_000; index += 1) {
      await memoryAreaDemandStore.record(input({ area: "Recent demand" }), now - index);
    }

    await expect(
      memoryAreaDemandStore.listSummary({ limit: 10, sinceDays: 30 }, now),
    ).resolves.toMatchObject({ partial: false, status: "ready" });

    await memoryAreaDemandStore.record(input({ area: "Recent demand" }), now);
    await expect(
      memoryAreaDemandStore.listSummary({ limit: 10, sinceDays: 30 }, now),
    ).resolves.toMatchObject({ partial: true, status: "ready" });
  });
});

describe("supabaseAreaDemandStore", () => {
  it("inserts and counts against the durable backend", async () => {
    expect(await supabaseAreaDemandStore.record(input())).toEqual({ status: "recorded" });
    await supabaseAreaDemandStore.record(input({ area: "Peckham", email: "me@example.com" }));
    expect(db.rows).toHaveLength(2);
    expect(db.rows[0].area_key).toBe("peckham");
    expect(await supabaseAreaDemandStore.countForArea("peckham")).toBe(2);
  });

  it("answers 503-shaped failed:true on a hard insert error", async () => {
    db.failInsert = true;
    const outcome = await supabaseAreaDemandStore.record(input());
    expect(outcome.failed).toBe(true);
  });

  it("fails soft to memory on a schema miss (table not yet applied)", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    db.schemaMiss = true;
    const outcome = await supabaseAreaDemandStore.record(input());
    expect(outcome).toEqual({ status: "recorded" });
    // The memory fallback holds the row, so a subsequent memory read sees it.
    expect(await memoryAreaDemandStore.countForArea("peckham")).toBe(1);
  });

  it("returns a failed outcome without writing memory on a production schema miss", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    db.schemaMiss = true;

    expect(await supabaseAreaDemandStore.record(input())).toEqual({
      status: "recorded",
      failed: true,
    });
    expect(await memoryAreaDemandStore.countForArea("peckham")).toBe(0);
  });

  it("keeps schema-miss reads fail-soft in deployed production", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    await memoryAreaDemandStore.record(input());
    db.schemaMiss = true;

    expect(await supabaseAreaDemandStore.countForArea("peckham")).toBe(1);
  });

  it("summarises durable rows without selecting contact data", async () => {
    const now = Date.UTC(2026, 7, 15, 12);
    await supabaseAreaDemandStore.record(
      input({ area: "Sheffield", source: "map-miss", email: "one@example.com" }),
      now - 2_000,
    );
    await supabaseAreaDemandStore.record(
      input({ area: "sheffield", source: "near-empty", email: "two@example.com" }),
      now - 1_000,
    );

    const result = await supabaseAreaDemandStore.listSummary(
      { limit: 10, sinceDays: 30 },
      now,
    );

    expect(result.items).toEqual([
      expect.objectContaining({
        area: "sheffield",
        areaKey: "sheffield",
        signalCount: 2,
        sourceCounts: {
          "area-picker": 0,
          "map-miss": 1,
          "near-empty": 1,
        },
      }),
    ]);
    expect(db.selectedColumns).toBe(
      "id,area,area_key,matched_patch_id,source,created_at",
    );
  });

  it("excludes rows after the frozen upper time bound", async () => {
    const now = Date.UTC(2026, 7, 15, 12);
    db.rows = [
      {
        id: "inside",
        area: "York",
        area_key: "york",
        matched_patch_id: null,
        source: "map-miss",
        email: null,
        created_at: new Date(now - 1_000).toISOString(),
      },
      {
        id: "future",
        area: "York",
        area_key: "york",
        matched_patch_id: null,
        source: "map-miss",
        email: null,
        created_at: new Date(now + 1_000).toISOString(),
      },
    ];

    const result = await supabaseAreaDemandStore.listSummary(
      { limit: 10, sinceDays: 30 },
      now,
    );

    expect(result.items[0]).toMatchObject({
      area: "York",
      signalCount: 1,
      lastSeen: new Date(now - 1_000).toISOString(),
    });
  });

  it("reads every bounded page in a stable order", async () => {
    const now = Date.UTC(2026, 7, 15, 12);
    db.rows = Array.from({ length: 1_001 }, (_, index) => ({
      id: String(index).padStart(4, "0"),
      area: "Leeds",
      area_key: "leeds",
      matched_patch_id: null,
      source: "map-miss",
      email: `person-${index}@example.com`,
      created_at: new Date(now).toISOString(),
    }));

    const result = await supabaseAreaDemandStore.listSummary(
      { limit: 10, sinceDays: 30 },
      now,
    );

    expect(result).toMatchObject({ partial: false, status: "ready" });
    expect(result.items[0]).toMatchObject({ area: "Leeds", signalCount: 1_001 });
    expect(db.orderColumns.slice(0, 2)).toEqual(["created_at", "id"]);
    expect(db.rangePages[0]?.at(-1)).toBe("0001");
    expect(db.rangePages[1]).toEqual(["0000"]);
  });

  it("marks the durable result partial at the safety cap", async () => {
    const now = Date.UTC(2026, 7, 15, 12);
    db.rows = Array.from({ length: 20_001 }, (_, index) => ({
      id: String(index).padStart(5, "0"),
      area: "Bristol",
      area_key: "bristol",
      matched_patch_id: null,
      source: "map-miss",
      email: null,
      created_at: new Date(now - index).toISOString(),
    }));

    const result = await supabaseAreaDemandStore.listSummary(
      { limit: 10, sinceDays: 30 },
      now,
    );

    expect(result).toMatchObject({ partial: true, status: "ready" });
    expect(result.items[0]).toMatchObject({ area: "Bristol", signalCount: 20_000 });
  });

  it("does not report a hard durable read failure as zero demand", async () => {
    db.failRead = true;

    await expect(
      supabaseAreaDemandStore.listSummary({ limit: 10, sinceDays: 30 }),
    ).resolves.toEqual({
      items: [],
      partial: false,
      status: "degraded",
    });
  });
});
