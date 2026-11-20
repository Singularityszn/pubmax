import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { resetVenueAliasesForTests, setVenueAliasesPathForTests } from "@/lib/venueAliases";
import { pintDropAuthorityKey } from "@/lib/pintDropAuthority.server";
import { dealPriceStore } from "@/lib/dealPriceStore";

const database = vi.hoisted(() => ({ durable: false, rows: [] as Record<string, unknown>[] }));
vi.mock("@/lib/storeBackend", () => ({
  selectStore: <T,>(memory: T, durable: T) => database.durable ? durable : memory,
  admin: () => ({ from: () => {
    let rows = database.rows;
    let saved: Record<string, unknown> | undefined;
    let offset = 0;
    let count = Infinity;
    const query = {
      select: () => query,
      eq: (field: string, value: unknown) => { rows = rows.filter((row) => row[field] === value); return query; },
      in: (field: string, values: unknown[]) => { rows = rows.filter((row) => values.includes(row[field])); return query; },
      upsert: (input: Record<string, unknown>) => {
        const fields = ["venue_id", "drink_category", "drink", "measure", "measure_label", "actor"];
        const old = database.rows.find((row) => fields.every((field) => row[field] === input[field]));
        saved = { id: randomUUID(), hidden: false, ...old, ...input };
        if (old) Object.assign(old, saved);
        else database.rows.push(saved);
        return query;
      },
      single: async () => ({ data: saved, error: null }),
      order: () => query,
      range: (start: number, end: number) => { offset = start; count = end - start + 1; return query; },
      limit: (limit: number) => { count = limit; return query; },
      gt: (field: string, value: string) => { rows = rows.filter((row) => String(row[field]) > value); return query; },
      then: (resolve: (result: { data: Record<string, unknown>[]; error: null }) => unknown) => Promise.resolve(resolve({ data: rows.slice(offset, offset + count), error: null })),
    };
    return query;
  } }),
}));

let directory: string | undefined;
afterEach(async () => {
  resetVenueAliasesForTests();
  if (directory) await rm(directory, { recursive: true, force: true });
});

it.each([false, true])("reads historical and current IDs after a pack refresh, durable=%s", async (durable) => {
  directory = await mkdtemp(path.join(process.cwd(), ".deal-alias-test-"));
  const file = path.join(directory, "aliases.json");
  await writeFile(file, JSON.stringify({ aliases: {} }));
  setVenueAliasesPathForTests(file);
  database.durable = false;
  const input = { venueId: "venue-olddeal", drinkCategory: "beer" as const, drink: "Lager", measure: "pint" as const, measureLabel: "", priceGbp: 4.5, schedule: { days: [5], start: "16:00", end: "19:00" }, endDate: null, conditions: "With a meal", accountId: "alias-test" };
  const saved = await dealPriceStore().submit(input);
  database.rows = [{ id: saved.deal.id, venue_id: input.venueId, drink_category: "beer", drink: "Lager", measure: "pint", measure_label: "", price_pennies: 450, days: [5], starts_at: "16:00:00", ends_at: "19:00:00", end_date: null, conditions: "With a meal", submitted_at: saved.deal.reportedAt, hidden: false, actor: pintDropAuthorityKey(input.venueId, input.accountId) }];
  await writeFile(file, JSON.stringify({ aliases: { "venue-olddeal": "venue-middledeal", "venue-middledeal": "venue-currentdeal" } }));
  setVenueAliasesPathForTests(file);
  database.durable = durable;
  for (const venueId of ["venue-olddeal", "venue-middledeal", "venue-currentdeal"]) {
    const rows = await dealPriceStore().read(venueId);
    expect(rows).toContainEqual({ ...saved.deal, venueId: "venue-currentdeal" });
  }
  expect(await dealPriceStore().read("venue-unrelateddeal")).toEqual([]);
});


it.each([false, true])("corrects the same owned deal across all alias IDs, durable=%s", async (durable) => {
  directory = await mkdtemp(path.join(process.cwd(), ".deal-alias-test-"));
  const file = path.join(directory, "aliases.json");
  await writeFile(file, JSON.stringify({ aliases: {} }));
  setVenueAliasesPathForTests(file);
  database.durable = durable;
  database.rows = [];
  const store = dealPriceStore();
  const input = { venueId: "venue-correction-old", drinkCategory: "beer" as const, drink: "Lager", measure: "pint" as const, measureLabel: "", priceGbp: 4.5, schedule: { days: [5], start: "16:00", end: "19:00" }, endDate: null, conditions: "With a meal", accountId: `correction-${durable}` };
  const original = await store.submit(input);
  await writeFile(file, JSON.stringify({ aliases: { "venue-correction-old": "venue-correction-middle", "venue-correction-middle": "venue-correction-current" } }));
  setVenueAliasesPathForTests(file);
  for (const venueId of ["venue-correction-current", "venue-correction-middle", "venue-correction-old"]) {
    const corrected = await store.submit({ ...input, venueId, priceGbp: 5 });
    expect(corrected.deal).toMatchObject({ id: original.deal.id, venueId: "venue-correction-current", priceGbp: 5 });
    expect(await store.read(venueId)).toEqual([corrected.deal]);
  }
  await store.submit({ ...input, venueId: "venue-correction-current", accountId: "another-account", priceGbp: 6 });
  expect((await store.read("venue-correction-current")).map((row) => row.priceGbp).sort()).toEqual([5, 6]);
  const owned = await store.listForAccount(input.accountId, 10);
  expect(owned).toHaveLength(1);
  expect(owned[0]).toMatchObject({ id: original.deal.id, priceGbp: 5 });
});


it("exports hidden and expired owned deals beyond the first durable page", async () => {
  database.durable = true;
  const accountId = "paged-deal-owner";
  const base = { venue_id: "venue-paged-deal", drink_category: "beer", drink: "Lager", measure: "pint", measure_label: "", price_pennies: 450, days: [5], starts_at: "16:00:00", ends_at: "19:00:00", end_date: "2001-01-01", conditions: "With a meal", submitted_at: "2000-12-01T12:00:00.000Z", hidden: true };
  database.rows = Array.from({ length: 1002 }, (_, index) => ({
    ...base, id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    actor: index < 1000 ? "another-owner" : pintDropAuthorityKey(base.venue_id, accountId),
  }));
  const store = dealPriceStore();
  expect(await store.read(base.venue_id)).toEqual([]);
  const rows = await store.listForAccount(accountId, 10);
  expect(rows).toHaveLength(2);
  expect(rows[0]).toEqual({ id: "00000000-0000-4000-8000-000000001001", venueId: base.venue_id, drinkCategory: "beer", drink: "Lager", measure: "pint", measureLabel: "", priceGbp: 4.5, schedule: { days: [5], start: "16:00", end: "19:00" }, endDate: "2001-01-01", conditions: "With a meal", reportedAt: base.submitted_at, hidden: true });
  expect(await store.listForAccount(accountId, 1)).toEqual([rows[0]]);
});
