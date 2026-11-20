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
    let offset = 0;
    let count = Infinity;
    const equal = (field: string, left: unknown, right: unknown) => field === "starts_at" || field === "ends_at"
      ? String(left).slice(0, 5) === String(right).slice(0, 5)
      : JSON.stringify(left) === JSON.stringify(right);
    const query = {
      select: () => query,
      eq: (field: string, value: unknown) => { rows = rows.filter((row) => equal(field, row[field], value)); return query; },
      in: (field: string, values: unknown[]) => { rows = rows.filter((row) => values.includes(row[field])); return query; },
      contains: (field: string, values: unknown[]) => { rows = rows.filter((row) => values.every((value) => (row[field] as unknown[]).includes(value))); return query; },
      containedBy: (field: string, values: unknown[]) => { rows = rows.filter((row) => (row[field] as unknown[]).every((value) => values.includes(value))); return query; },
      upsert: (input: Record<string, unknown>[], options: { onConflict: string }) => {
        const fields = options.onConflict.split(",");
        rows = input.map((value) => {
          const old = database.rows.find((row) => fields.every((field) => equal(field, row[field], value[field])));
          const row = { id: randomUUID(), hidden: false, ...old, ...value };
          if (old) Object.assign(old, row);
          else database.rows.push(row);
          return row;
        });
        return query;
      },
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

it.each([false, true])("corrects every merged owned offer and preserves moderation, durable=%s", async (durable) => {
  directory = await mkdtemp(path.join(process.cwd(), ".deal-alias-test-"));
  const file = path.join(directory, "aliases.json");
  await writeFile(file, JSON.stringify({ aliases: {} }));
  setVenueAliasesPathForTests(file);
  database.durable = durable;
  database.rows = [];
  const store = dealPriceStore();
  const venueIds = ["venue-collision-current", "venue-collision-middle", "venue-collision-old"] as const;
  const input = { venueId: venueIds[0], drinkCategory: "beer" as const, drink: "Lager", measure: "pint" as const, measureLabel: "", priceGbp: 4, schedule: { days: [1, 3], start: "16:00", end: "19:00" }, endDate: null, conditions: "With a meal", accountId: `collision-${durable}` };
  const originals = [];
  for (const venueId of venueIds) originals.push((await store.submit({ ...input, venueId })).deal);
  const hiddenId = originals[0]!.id;
  let reviewedRevision: string | undefined;
  if (durable) {
    const hidden = database.rows.find((row) => row.id === hiddenId)!;
    hidden.hidden = true;
    hidden.reviewed_at = "2026-01-01T12:00:00.000Z";
  } else {
    await store.report(hiddenId, "moderator-report");
    const reportedRevision = (await store.review()).find((row) => row.id === hiddenId)!.revision;
    expect(await store.moderate(hiddenId, true, reportedRevision)).toBe(true);
    reviewedRevision = (await store.review()).find((row) => row.id === hiddenId)!.revision;
    await store.report(originals[2]!.id, "unresolved-report");
  }
  const untouched = [];
  for (const change of [
    { schedule: { ...input.schedule, days: [5] } },
    { schedule: { ...input.schedule, start: "15:00" } },
    { schedule: { ...input.schedule, end: "20:00" } },
    { accountId: "collision-other-owner" },
    { drink: "Ale" },
    { measure: "half" as const },
  ]) untouched.push((await store.submit({ ...input, venueId: venueIds[2], ...change, priceGbp: 5 })).deal);
  await writeFile(file, JSON.stringify({ aliases: { [venueIds[2]]: venueIds[1], [venueIds[1]]: venueIds[0] } }));
  setVenueAliasesPathForTests(file);
  for (const [index, venueId] of venueIds.entries()) {
    const priceGbp = 6 + index;
    const corrected = await store.submit({ ...input, venueId, priceGbp, conditions: "No meal needed", schedule: { ...input.schedule, days: [3, 1, 3] } });
    expect(corrected.hidden).toBe(true);
    expect(corrected.deal).toMatchObject({ id: hiddenId, venueId: venueIds[0], priceGbp });
    const owned = await store.listForAccount(input.accountId, 20);
    for (const original of originals) {
      expect(owned.find((row) => row.id === original.id)).toMatchObject({ priceGbp, conditions: "No meal needed", hidden: original.id === hiddenId });
    }
    for (const readId of venueIds) {
      const visible = await store.read(readId);
      expect(visible).toHaveLength(8);
      expect(visible).not.toContainEqual(expect.objectContaining({ id: hiddenId }));
      for (const original of originals.slice(1)) {
        expect(visible).toContainEqual(expect.objectContaining({ id: original.id, venueId: venueIds[0], priceGbp, conditions: "No meal needed" }));
      }
      for (const sibling of untouched) expect(visible).toContainEqual({ ...sibling, venueId: venueIds[0] });
    }
  }
  if (durable) {
    expect(database.rows.find((row) => row.id === hiddenId)?.reviewed_at).toBe("2026-01-01T12:00:00.000Z");
  } else {
    const review = (await store.review()).filter((row) => originals.some((original) => original.id === row.id));
    expect(review.map((row) => row.id).sort()).toEqual([hiddenId, originals[2]!.id].sort());
    expect(review.every((row) => row.priceGbp === 8)).toBe(true);
    expect(await store.moderate(hiddenId, false, reviewedRevision!)).toBe(false);
  }
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

it.each([false, true])("rejects unavailable alias reads and recovers after repair, durable=%s", async (durable) => {
  directory = await mkdtemp(path.join(process.cwd(), ".deal-alias-test-"));
  const file = path.join(directory, "aliases.json");
  const sibling = path.join(directory, "base-aliases.json");
  await writeFile(file, JSON.stringify({ aliases: {} }));
  await writeFile(sibling, JSON.stringify({ aliases: {} }));
  setVenueAliasesPathForTests([file, sibling]);
  database.durable = durable;
  database.rows = [];
  const store = dealPriceStore();
  const saved = await store.submit({ venueId: "venue-outage-old", drinkCategory: "beer", drink: "Lager", measure: "pint", measureLabel: "", priceGbp: 4.5, schedule: { days: [5], start: "16:00", end: "19:00" }, endDate: null, conditions: "", accountId: `outage-${durable}` });
  await writeFile(file, JSON.stringify({ aliases: { "venue-outage-old": "venue-outage-current" } }));
  for (const failure of ["missing", "corrupt"]) {
    if (failure === "missing") await rm(sibling);
    else await writeFile(sibling, "{");
    setVenueAliasesPathForTests([file, sibling]);
    for (const venueId of ["venue-outage-old", "venue-outage-current", "venue-outage-unrelated"]) {
      await expect(store.read(venueId)).rejects.toThrow("Could not resolve the deal venue.");
    }
    await writeFile(sibling, JSON.stringify({ aliases: {} }));
    expect(await store.read("venue-outage-current")).toEqual([{ ...saved.deal, venueId: "venue-outage-current" }]);
  }
});

it.each([false, true])("preserves distinct offer windows and corrects the same day set through aliases, durable=%s", async (durable) => {
  directory = await mkdtemp(path.join(process.cwd(), ".deal-alias-test-"));
  const file = path.join(directory, "aliases.json");
  await writeFile(file, JSON.stringify({ aliases: {} }));
  setVenueAliasesPathForTests(file);
  database.durable = durable;
  database.rows = [];
  const store = dealPriceStore();
  const input = { venueId: "venue-windows-old", drinkCategory: "beer" as const, drink: "Lager", measure: "pint" as const, measureLabel: "", priceGbp: 4, schedule: { days: [1, 3], start: "16:00", end: "19:00" }, endDate: null, conditions: "", accountId: `windows-${durable}` };
  const original = await store.submit(input);
  await writeFile(file, JSON.stringify({ aliases: { "venue-windows-old": "venue-windows-current" } }));
  setVenueAliasesPathForTests(file);
  const siblings = [];
  for (const schedule of [
    { days: [5], start: "16:00", end: "19:00" },
    { days: [1], start: "16:00", end: "19:00" },
    { days: [1, 3, 5], start: "16:00", end: "19:00" },
    { days: [1, 3], start: "15:00", end: "19:00" },
    { days: [1, 3], start: "16:00", end: "20:00" },
  ]) {
    const saved = await store.submit({ ...input, venueId: "venue-windows-current", priceGbp: 5, schedule });
    expect(saved.deal.id).not.toBe(original.deal.id);
    siblings.push(saved.deal);
  }
  for (const venueId of ["venue-windows-current", "venue-windows-old"]) {
    const corrected = await store.submit({ ...input, venueId, priceGbp: 4.5, schedule: { ...input.schedule, days: [3, 1, 3] } });
    expect(corrected.deal).toMatchObject({ id: original.deal.id, schedule: input.schedule, priceGbp: 4.5 });
    const rows = await store.read(venueId);
    expect(rows).toHaveLength(6);
    expect(rows).toEqual(expect.arrayContaining([corrected.deal, ...siblings]));
  }
  const owned = await store.listForAccount(input.accountId, 10);
  expect(owned).toHaveLength(6);
  expect(owned).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: original.deal.id, priceGbp: 4.5 }),
    ...siblings.map((deal) => expect.objectContaining({ id: deal.id, priceGbp: 5 })),
  ]));
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
