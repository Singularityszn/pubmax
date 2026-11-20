import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { resetVenueAliasesForTests, setVenueAliasesPathForTests } from "@/lib/venueAliases";
import { dealPriceStore } from "@/lib/dealPriceStore";

const database = vi.hoisted(() => ({ durable: false, rows: [] as Record<string, unknown>[] }));
vi.mock("@/lib/storeBackend", () => ({
  selectStore: <T,>(memory: T, durable: T) => database.durable ? durable : memory,
  admin: () => ({ from: () => {
    let rows = database.rows;
    const query = {
      select: () => query,
      eq: (field: string, value: unknown) => { rows = rows.filter((row) => row[field] === value); return query; },
      in: (field: string, values: unknown[]) => { rows = rows.filter((row) => values.includes(row[field])); return query; },
      order: () => query,
      range: () => query,
      then: (resolve: (result: { data: Record<string, unknown>[]; error: null }) => unknown) => Promise.resolve(resolve({ data: rows, error: null })),
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
  const input = { venueId: "venue-olddeal", drinkCategory: "beer" as const, drink: "Lager", measure: "pint" as const, measureLabel: "", priceGbp: 4.5, schedule: { days: [5], start: "16:00", end: "19:00" }, endDate: null, conditions: "With a meal", actor: "alias-test" };
  const saved = await dealPriceStore().submit(input);
  database.rows = [{ id: saved.deal.id, venue_id: input.venueId, drink_category: "beer", drink: "Lager", measure: "pint", measure_label: "", price_pennies: 450, days: [5], starts_at: "16:00:00", ends_at: "19:00:00", end_date: null, conditions: "With a meal", submitted_at: saved.deal.reportedAt, hidden: false }];
  await writeFile(file, JSON.stringify({ aliases: { "venue-olddeal": "venue-middledeal", "venue-middledeal": "venue-currentdeal" } }));
  setVenueAliasesPathForTests(file);
  database.durable = durable;
  for (const venueId of ["venue-olddeal", "venue-middledeal", "venue-currentdeal"]) {
    const rows = await dealPriceStore().read(venueId);
    expect(rows).toContainEqual({ ...saved.deal, venueId: "venue-currentdeal" });
  }
  expect(await dealPriceStore().read("venue-unrelateddeal")).toEqual([]);
});
