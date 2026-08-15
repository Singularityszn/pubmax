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
  schemaMiss: false,
  selectedColumns: "",
}));

vi.mock("@/lib/supabase", () => {
  function makeQuery() {
    let op: "insert" | "select" | null = null;
    let selectCount = false;
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
        return query;
      },
      order() {
        return query;
      },
      range(from: number, to: number) {
        if (db.schemaMiss) {
          return Promise.resolve({
            data: null,
            error: { message: "Could not find the table 'public.area_demand'" },
          });
        }
        const since = filters.find((f) => f.column === "created_at")?.value;
        const data = db.rows
          .filter((row) => typeof since !== "string" || row.created_at >= since)
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .slice(from, to + 1);
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
  db.schemaMiss = false;
  db.selectedColumns = "";
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
      input({
        area: "Camden",
        matchedPatchId: "camden",
        source: "area-picker",
      }),
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
      input({
        area: "Sheffield",
        source: "map-miss",
        email: "one@example.com",
      }),
      now - 2_000,
    );
    await supabaseAreaDemandStore.record(
      input({
        area: "sheffield",
        source: "near-empty",
        email: "two@example.com",
      }),
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
    expect(db.selectedColumns).not.toContain("email");
  });
});
