import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { pintDropCreateRequest } from "@/lib/pintDropCreate.server";
import { validatePintDrop, type PintDrop } from "@/lib/pintDrops";
import { postgresSkipReason, startPostgres, type PostgresSession } from "./helpers/postgres";

const skipReason = postgresSkipReason();
const migrations = join(process.cwd(), "supabase/migrations");
const forward = "20260908010000_0157_pint_drop_create_idempotency.sql";
const rollback = "20260908010000_0157_pint_drop_create_idempotency_rollback.sql";
const alice = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";
let database: PostgresSession | null = null;
function db(): PostgresSession {
  if (!database) throw new Error("PostgreSQL session unavailable.");
  return database;
}
function literal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function candidate(options: {
  venue?: string; key?: string; actor?: string; fields?: Partial<PintDrop>;
} = {}) {
  const parsed = validatePintDrop({
    venueId: options.venue ?? randomUUID(), handle: "fixturealice", drink: "Lager",
    passedDownNote: "The piano stood beside the door.", ...options.fields,
  });
  if (!parsed.ok) throw new Error(parsed.error);
  const drop = { ...parsed.value, createdAt: options.fields?.createdAt ?? "2026-09-08T12:00:00Z" };
  const request = await pintDropCreateRequest(options.actor ?? alice, options.key ?? randomUUID(), drop, {
    pint: null, venue: null, receipt: null,
  });
  const row = {
    id: drop.id, venue_id: drop.venueId, handle: drop.handle, drink: drop.drink,
    passed_down_note: drop.passedDownNote, price_gbp: drop.priceGbp,
    measure: drop.measure, measure_label: drop.measureLabel ?? null,
    era: drop.era, vibe_tags: [], visibility: drop.visibility, provenance: drop.provenance,
    status: "visible", created_at: drop.createdAt,
    price_day: drop.priceGbp === null ? null : "2026-09-08",
    receipt_photo_key: drop.priceGbp === null ? null : `${drop.id}/receipt.jpg`,
  };
  return { request, row };
}
type Candidate = Awaited<ReturnType<typeof candidate>>;
function call(input: Candidate, role = "service_role"): string {
  return `set role ${role}; select public.create_pint_drop_idempotent(
    ${literal(input.request.actorKeyHash)}, ${literal(input.request.requestDigest)},
    ${literal(JSON.stringify(input.row))}::jsonb);`;
}
function create(input: Candidate) {
  return JSON.parse(db().sql(call(input))) as { outcome: string; drop?: Record<string, unknown> };
}

beforeAll(async () => {
  if (skipReason) return;
  try {
    database = await startPostgres({ label: "pint-create-0157", database: "pubmax_pint_create_0157", maxConnections: 6 });
    database.applyFile(join(process.cwd(), "scripts/rls/session-fixture.sql"));
    for (const name of readdirSync(migrations).filter(name => name.endsWith(".sql") && name < forward).sort()) {
      database.applyFile(join(migrations, name));
    }
    database.applyFile(join(migrations, forward));
  } catch (error) {
    await database?.stop();
    database = null;
    throw error;
  }
}, 180_000);
afterAll(async () => { await database?.stop(); });

describe.skipIf(skipReason !== null)("0157 Pint Drop creation on PostgreSQL", () => {
  it.each([false, true])("creates once under concurrent exact retries, priced=%s", async (priced) => {
    const first = await candidate({ fields: priced ? { priceGbp: 5.8 } : {} });
    const attempts = [first, { ...first, row: { ...first.row, id: randomUUID() } }, { ...first, row: { ...first.row, id: randomUUID() } }];
    const results = await db().concurrentResults(attempts.map(input => call(input)));
    const replies = results.map(result => JSON.parse(result) as { outcome: string; drop: { id: string } });
    expect(replies.map(reply => reply.outcome).sort()).toEqual(["created", "replayed", "replayed"]);
    expect(new Set(replies.map(reply => reply.drop.id)).size).toBe(1);
    expect(db().sql(`select count(*) from public.pint_drops where venue_id = ${literal(first.row.venue_id)}`)).toBe("1");
    expect(db().sql(`select count(*) from public.pint_drop_create_requests where actor_key_hash = ${literal(first.request.actorKeyHash)}`)).toBe("1");
  });
  it("refuses a changed measure label and leaves the first content intact", async () => {
    const venue = randomUUID();
    const key = randomUUID();
    const first = await candidate({ venue, key, fields: { priceGbp: 5.8, measure: "other", measureLabel: "330ml" } });
    const changed = await candidate({ venue, key, fields: { priceGbp: 5.8, measure: "other", measureLabel: "500ml" } });
    expect(create(first).outcome).toBe("created");
    expect(create(changed).outcome).toBe("conflict");
    expect(create(first).drop?.measure_label).toBe("330ml");
  });
  it("scopes the same client key to separate verified account UUIDs", async () => {
    const key = randomUUID();
    const venue = randomUUID();
    const a = await candidate({ key, venue });
    const b = await candidate({ key, venue, actor: bob, fields: { handle: "fixturebob" } });
    expect(a.request.actorKeyHash).not.toBe(b.request.actorKeyHash);
    expect(create(a).outcome).toBe("created");
    expect(create(b).outcome).toBe("created");
    expect(create(b).drop?.handle).toBe("fixturebob");
  });
  it.each(["public", "legacy"])("counts a non-hidden %s priced row without price_day", async (visibility) => {
    const input = await candidate({ fields: { priceGbp: 5.8 } });
    db().sql(`insert into public.pint_drops(id, venue_id, handle, drink, price_gbp, passed_down_note, era, provenance, status, visibility, created_at, price_day)
      values (${literal(randomUUID())}, ${literal(input.row.venue_id)}, 'fixturealice', 'Lager', 5.8, '', '', 'contributor', 'visible', ${literal(visibility)}, '2026-09-08T00:01:00+01', null)`);
    expect(create(input).outcome).toBe("daily_cap");
    expect(db().sql(`select count(*) from public.pint_drop_create_requests where actor_key_hash = ${literal(input.request.actorKeyHash)}`)).toBe("0");
  });
  it("returns current moderation before considering a replacement price in the same bucket", async () => {
    const venue = randomUUID();
    const first = await candidate({ venue, fields: { priceGbp: 5.8 } });
    const replacement = await candidate({ venue, fields: { priceGbp: 6.1 } });
    expect(create(first).outcome).toBe("created");
    db().sql(`update public.pint_drops set status = 'hidden', moderator_note = 'Review only' where id = ${literal(first.row.id)}`);
    expect(create(replacement).outcome).toBe("created");
    const replay = create(first);
    expect(replay).toMatchObject({ outcome: "replayed", drop: { id: first.row.id, status: "hidden" } });
    expect(db().sql(`select count(*) from public.pint_drops where venue_id = ${literal(venue)}`)).toBe("2");
  });
  it("keeps the original ID across London midnight and admits a distinct next-day intent", async () => {
    const venue = randomUUID();
    const key = randomUUID();
    const first = await candidate({ venue, key, fields: { priceGbp: 5.8, createdAt: "2026-09-08T22:30:00Z" } });
    const retry = await candidate({ venue, key, fields: { priceGbp: 5.8, createdAt: "2026-09-08T23:30:00Z" } });
    expect(create(first).drop?.price_day).toBe("2026-09-08");
    expect(create(retry)).toMatchObject({ outcome: "replayed", drop: { id: first.row.id } });
    const next = await candidate({ venue, fields: { priceGbp: 5.8, createdAt: "2026-09-08T23:30:00Z" } });
    expect(create(next)).toMatchObject({ outcome: "created", drop: { price_day: "2026-09-09" } });
  });
  it("keeps the broader cap atomic for competing request keys", async () => {
    const venue = randomUUID();
    const a = await candidate({ venue, fields: { priceGbp: 5.8 } });
    const b = await candidate({ venue, fields: { priceGbp: 6.1 } });
    const results = await db().concurrentResults([call(a), call(b)]);
    expect(results.map(value => JSON.parse(value).outcome).sort()).toEqual(["created", "daily_cap"]);
  });
  it("keeps the request ledger and RPC inaccessible to browser roles", async () => {
    const input = await candidate();
    for (const role of ["anon", "authenticated"]) {
      expect(db().expectRefusal(call(input, role))).toMatch(/permission denied/i);
      expect(db().expectRefusal(`set role ${role}; select * from public.pint_drop_create_requests`)).toMatch(/permission denied/i);
    }
    expect(create(input).outcome).toBe("created");
  });
  it("rolls back replay identity without deleting contributions or their photo keys", async () => {
    const input = await candidate({ fields: { priceGbp: 5.8 } });
    create(input);
    const rows = db().sql("select jsonb_agg(to_jsonb(d) order by id) from public.pint_drops d");
    db().applyFile(join(migrations, "rollback", rollback));
    expect(db().sql("select jsonb_agg(to_jsonb(d) order by id) from public.pint_drops d")).toBe(rows);
    expect(db().sql("select to_regclass('public.pint_drop_create_requests') is null")).toBe("t");
    expect(db().expectRefusal(call(input))).toMatch(/does not exist/i);
  });
});
