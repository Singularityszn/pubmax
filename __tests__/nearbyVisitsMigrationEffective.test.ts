import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { asServiceRole, postgresSkipReason, startMigratedPostgres, type PostgresSession } from "./helpers/postgres";

const skip = postgresSkipReason();
const forward = join(process.cwd(), "supabase/migrations/20261115210000_0240_nearby_visits.sql");
const rollback = join(process.cwd(), "supabase/migrations/rollback/20261115210000_0240_nearby_visits_rollback.sql");
const owner = "a0000000-0000-4000-8000-000000000001";
let session: PostgresSession;

beforeAll(async () => {
  if (skip) return;
  session = await startMigratedPostgres({ label: "nearby-visits", database: "nearby_visits" });
});
afterAll(async () => { await session?.stop(); });

describe.skipIf(skip !== null)("nearby visit storage", () => {
  it("needs the migration, keeps the first proof once, and deletes it with the account", async () => {
    session.applyFile(rollback);
    expect((await session.attempt(asServiceRole("select * from public.nearby_visits"))).ok).toBe(false);
    session.applyFile(forward);
    session.sql(`insert into auth.users(id) values ('${owner}')`);
    session.sql(asServiceRole(`insert into public.nearby_visits(user_id, venue_id, checked_at)
      values ('${owner}', 'lamb', '2026-11-15T20:00:00Z')`));
    session.sql(asServiceRole(`insert into public.nearby_visits(user_id, venue_id)
      values ('${owner}', 'lamb') on conflict (user_id, venue_id) do nothing`));
    expect(session.sql(`select count(*) from public.nearby_visits where checked_at = '2026-11-15T20:00:00Z'`)).toBe("1");
    expect((await session.attempt(asServiceRole(`insert into public.nearby_visits(user_id, venue_id) values ('${owner}', '')`))).ok).toBe(false);
    expect((await session.attempt(asServiceRole(`update public.nearby_visits set checked_at = now()`))).ok).toBe(false);
    session.sql(`delete from auth.users where id = '${owner}'`);
    expect(session.sql("select count(*) from public.nearby_visits")).toBe("0");
    session.applyFile(rollback);
    expect(session.sql("select to_regclass('public.nearby_visits') is null")).toBe("t");
    session.applyFile(forward);
  });
});
