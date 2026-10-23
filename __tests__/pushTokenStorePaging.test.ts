import { describe, expect, it, vi } from "vitest";

// LIB-S4: PostgREST answers at most max-rows (hosted default 1000) per
// response, with or without a Range. The fake below does the same, so an
// unpaged list() sees only the oldest 1000 devices and a broadcast skips the
// rest. The durable list() has to page until a short page comes back.

const POSTGREST_MAX_ROWS = 1000;

const db = vi.hoisted(() => ({
  rows: [] as Array<{ token: string; platform: string; created_at: string; last_seen_at: string }>,
  ranges: [] as Array<[number, number]>,
  orders: [] as string[],
}));

vi.mock("@/lib/storeBackend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storeBackend")>();
  return {
    ...actual,
    selectStore: <T,>(_memory: T, supabase: T) => supabase,
    admin: () => ({
      from: (table: string) => {
        if (table !== "push_tokens") throw new Error(`unexpected table ${table}`);
        let from = 0;
        let to = Number.POSITIVE_INFINITY;
        const chain: Record<string, unknown> = {};
        chain.select = () => chain;
        chain.order = (column: string) => {
          db.orders.push(column);
          return chain;
        };
        chain.range = (start: number, end: number) => {
          db.ranges.push([start, end]);
          from = start;
          to = end;
          return chain;
        };
        chain.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
          Promise.resolve({
            data: db.rows.slice(from, Math.min(to + 1, from + POSTGREST_MAX_ROWS)),
            error: null,
          }).then(resolve, reject);
        return chain;
      },
    }),
  };
});

import { PUSH_TOKEN_PAGE_ROWS, pushTokenStore } from "@/lib/pushTokenStore";

function seed(count: number) {
  db.rows = Array.from({ length: count }, (_, at) => ({
    token: `apns-${String(at).padStart(5, "0")}`,
    platform: at % 2 === 0 ? "ios" : "android",
    created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, at)).toISOString(),
    last_seen_at: new Date(Date.UTC(2026, 0, 1, 0, 0, at)).toISOString(),
  }));
  db.ranges = [];
  db.orders = [];
}

describe("durable push token list pages past the PostgREST row cap", () => {
  it("returns every device when there are more than 1000", async () => {
    seed(2_345);
    const tokens = await pushTokenStore().list();
    expect(tokens).toHaveLength(2_345);
    expect(new Set(tokens.map((row) => row.token)).size).toBe(2_345);
    expect(tokens.at(-1)?.token).toBe("apns-02344");
    expect(db.ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("asks once more after an exactly full page and stops on the empty one", async () => {
    seed(PUSH_TOKEN_PAGE_ROWS);
    const tokens = await pushTokenStore().list();
    expect(tokens).toHaveLength(PUSH_TOKEN_PAGE_ROWS);
    expect(db.ranges).toEqual([[0, 999], [1000, 1999]]);
  });

  it("orders on a unique tiebreak so offset pages cannot repeat or skip a row", async () => {
    seed(3);
    await pushTokenStore().list();
    expect(db.orders).toEqual(["created_at", "token"]);
  });
});
