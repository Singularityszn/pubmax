import { describe, expect, it } from "vitest";

import { upsertPalFromServer } from "@/convex/commands";
import { rollbackPubPalsBatch } from "@/convex/migrations";

// There is no Convex test harness in this repo, so these drive the registered
// handlers against a minimal in-memory `ctx.db`. It models only what the two
// mutations touch: an equality index lookup, insert, patch and delete.

type Row = Record<string, unknown> & { _id: string };

const INDEX_FIELDS: Record<string, string[]> = {
  by_owner_issuer_subject: ["ownerIssuer", "ownerSubject"],
  by_migration_batch: ["migrationBatchId"],
  by_pal_proposed_at: ["palId"],
  by_pal_occurred_at: ["palId"],
  by_pal_unlocked_at: ["palId"],
};

function fakeDb() {
  const tables = new Map<string, Row[]>();
  let next = 0;
  const rows = (table: string) => {
    if (!tables.has(table)) tables.set(table, []);
    return tables.get(table)!;
  };
  const tableOf = (id: string) => id.split(":")[0]!;
  const db = {
    query(table: string) {
      return {
        withIndex(index: string, build: (q: unknown) => unknown) {
          const wanted: unknown[] = [];
          const q = { eq: (_field: string, value: unknown) => (wanted.push(value), q) };
          build(q);
          const fields = INDEX_FIELDS[index] ?? [];
          const hits = () => rows(table).filter((row) => fields.every((f, i) => i >= wanted.length || row[f] === wanted[i]));
          return {
            take: async (n: number) => hits().slice(0, n),
            first: async () => hits()[0] ?? null,
            unique: async () => hits()[0] ?? null,
            collect: async () => hits(),
          };
        },
      };
    },
    get: async (id: string) => rows(tableOf(id)).find((row) => row._id === id) ?? null,
    insert: async (table: string, value: Record<string, unknown>) => {
      const _id = `${table}:${++next}`;
      rows(table).push({ ...value, _id });
      return _id;
    },
    patch: async (id: string, value: Record<string, unknown>) => {
      const row = rows(tableOf(id)).find((r) => r._id === id)!;
      Object.assign(row, value);
    },
    delete: async (id: string) => {
      const list = rows(tableOf(id));
      list.splice(list.findIndex((r) => r._id === id), 1);
    },
  };
  return { ctx: { db }, rows };
}

type Handler = (ctx: unknown, args: Record<string, unknown>) => Promise<unknown>;
const handlerOf = (fn: unknown) => (fn as { _handler: Handler })._handler;

const PAL_ARGS = {
  ownerIssuer: "https://issuer.test",
  ownerSubject: "drinker-1",
  name: "Rook",
  adultAttestedAt: 1,
  appearance: {},
  personality: { playfulness: 50, energy: 50, storytelling: 50 },
  voice: { pace: 50, warmth: 50, energy: 50 },
  muted: false,
  hidden: false,
  now: 10,
};

describe("Convex Pub Pal migration batch tags", () => {
  it("sets migrationBatchId on insert only, so a later upsert never retags or untags a pal", async () => {
    const { ctx, rows } = fakeDb();
    const upsert = handlerOf(upsertPalFromServer);

    const organic = await upsert(ctx, PAL_ARGS);
    await upsert(ctx, { ...PAL_ARGS, migrationBatchId: "migrationBatches:import", now: 20 });
    expect(rows("pubPals").find((r) => r._id === organic)?.migrationBatchId).toBeUndefined();

    const imported = await upsert(ctx, {
      ...PAL_ARGS,
      ownerSubject: "drinker-2",
      migrationBatchId: "migrationBatches:import",
    });
    await upsert(ctx, { ...PAL_ARGS, ownerSubject: "drinker-2", now: 30 });
    const row = rows("pubPals").find((r) => r._id === imported);
    expect(row?.migrationBatchId).toBe("migrationBatches:import");
    expect(row?.updatedAt).toBe(30);
  });

  it("refuses to roll back a batch while a pal in it has children, and deletes nothing", async () => {
    const { ctx, rows } = fakeDb();
    const rollback = handlerOf(rollbackPubPalsBatch);
    const pal = await ctx.db.insert("pubPals", { migrationBatchId: "migrationBatches:b" });
    const bare = await ctx.db.insert("pubPals", { migrationBatchId: "migrationBatches:b" });
    const unlock = await ctx.db.insert("palUnlocks", { palId: pal });

    await expect(rollback(ctx, { batchId: "migrationBatches:b", limit: 100 })).rejects.toThrow(
      new RegExp(`Refusing to roll back 1 Pub Pal\\(s\\).*${pal}`),
    );
    expect(rows("pubPals").map((r) => r._id).sort()).toEqual([pal, bare].sort());

    await ctx.db.delete(unlock);
    await expect(rollback(ctx, { batchId: "migrationBatches:b", limit: 100 })).resolves.toBe(2);
    expect(rows("pubPals")).toEqual([]);
  });
});
