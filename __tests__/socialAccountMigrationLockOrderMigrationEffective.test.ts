// Migration 0255 on a real PostgreSQL replay: the legacy Social account migration
// against account deletion of the same person. Before, the migration held the
// profile while the deletion held the auth row, and each waited for the other.
// After, the migration takes the auth row first, so one waits for the other.

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { postgresPoll } from "./helpers/postgresPoll";
import { asBrowserRole, postgresSkipReason } from "./helpers/postgres";
import {
  MIGRATOR, type Person, accountOf, bootCrewAdmissionDatabase, call, db, deleteAccount,
  hold, holdRpc, json, key, outcome, person, rpc, stopCrewAdmissionDatabase, waitsOnAnyLock,
  waitsOnLockHeldBy,
} from "./helpers/crewAdmissionHarness";

const directory = join(process.cwd(), "supabase/migrations");
const forward = "20261121090000_0255_social_account_migration_lock_order.sql";
const rollback = `rollback/${forward.replace(/\.sql$/, "_rollback.sql")}`;
const skipReason = postgresSkipReason();
const DEADLOCK = /40P01|deadlock/;
const GONE = { ok: false, code: "legacy_profile_not_found" };
const CONFLICT = { ok: false, code: "ownership_conflict" };

function apply(file: string) {
  execFileSync(db().psql, [...db().databaseArgs, "-X", "-q", "-c", `set role ${MIGRATOR}`, "-f", join(directory, file)],
    { stdio: ["ignore", "pipe", "pipe"] });
}

beforeAll(async () => {
  if (skipReason) return;
  await bootCrewAdmissionDatabase("social-account-migration-0255", "after");
  const after0246 = "20261117140000_0246_crew_departure_release.sql";
  for (const file of readdirSync(directory).filter((entry) => entry.endsWith(".sql") && entry > after0246 && entry < forward).sort()) {
    apply(file);
  }
}, 600_000);
afterAll(async () => { await stopCrewAdmissionDatabase(); });

/** none: no account yet. bound: already bound to this auth user. unbound: a Clerk account with no auth user. */
type Legacy = "none" | "bound" | "unbound";
type Fixture = { who: Person; clerk: string; plan: string; kind: Legacy };

function legacy(kind: Legacy): Fixture {
  const who = person({ account: false });
  const clerk = `clerk-legacy-${who.handle}`;
  const plan = randomUUID();
  db().sql(`insert into public.plans(id,title,start_time,status,owner_user_id)
    values ('${plan}','Legacy night',now()+interval '1 day','ready','${who.user}')`);
  if (kind !== "none") {
    db().sql(`insert into public.private_social_accounts(id,clerk_user_id,supabase_user_id,profile_id)
      values ('${who.account}','${clerk}',${kind === "bound" ? `'${who.user}'` : "null"},'${who.profile}')`);
  }
  return { who, clerk, plan, kind };
}

const migrateCall = (clerk: string, user: string) => `migrate_social_product_account('${clerk}','${user}')`;
const migrate = (clerk: string, user: string) => call(migrateCall(clerk, user));
const audits = (who: Person) => db().sql(`select count(*) from public.private_social_account_audit audit
  join public.private_social_accounts account on account.id=audit.product_account_id where account.profile_id='${who.profile}'`);
const tombstoned = (who: Person) => db().sql(`select tombstoned_at is not null from public.profiles where id='${who.profile}'`);

/**
 * The schedule from the issue. A held barrier stops the deletion after it holds the
 * auth row: on the person's Plan row, or on a bound account's row. The migration then
 * starts, and the barrier lets go once the migration waits.
 */
async function interleaved(f: Fixture) {
  const barrier = `social_migration_barrier_${key()}`, deletion = `social_migration_delete_${key()}`;
  const migration = `social_migration_bind_${key()}`;
  const target = f.kind === "bound"
    ? `select 1 from public.private_social_accounts where id='${f.who.account}' for key share`
    : `select 1 from public.plans where id='${f.plan}' for update`;
  const held = await hold(`set local application_name='${barrier}'; ${target}`, "postgres");
  const deleting = outcome(deletion, deleteAccount(f.who), "postgres");
  let migrating: ReturnType<typeof outcome> | null = null;
  try {
    await postgresPoll(() => waitsOnLockHeldBy(deletion, barrier)).toBe("t");
    migrating = outcome(migration, rpc(migrateCall(f.clerk, f.who.user)));
    await postgresPoll(() => waitsOnAnyLock(migration)).toBe("t");
  } finally {
    await held.finish();
  }
  return { deleted: await deleting, migrated: await migrating, migration, deletion };
}

describe.skipIf(skipReason !== null)("before 0255", () => {
  it.each(["none", "bound", "unbound"] as const)("a migration and a deletion of a %s legacy account deadlock", async (kind) => {
    const { deleted, migrated } = await interleaved(legacy(kind));
    expect([deleted.said, migrated?.said].filter((said) => DEADLOCK.test(said ?? ""))).toHaveLength(1);
  });
});

describe.skipIf(skipReason !== null)("after 0255", () => {
  beforeAll(() => { if (!skipReason) apply(forward); });

  it.each(["none", "bound", "unbound"] as const)("a migration waits for a %s account's deletion in flight, then binds nothing", async (kind) => {
    const f = legacy(kind);
    const { deleted, migrated } = await interleaved(f);
    expect(deleted.ok, deleted.said).toBe(true);
    expect(migrated?.ok, migrated?.said).toBe(true);
    expect(json(migrated?.said ?? "{}")).toEqual(GONE);
    expect(accountOf(f.who)).toBe(kind === "none" ? "none" : `${f.who.account}|${kind === "bound" ? "suspended" : "active"}|true`);
    expect(audits(f.who)).toBe("0");
    expect(tombstoned(f.who)).toBe("t");
  });

  it.each(["none", "bound", "unbound"] as const)("a deletion waits for a %s account's migration in flight, then unbinds it", async (kind) => {
    const f = legacy(kind);
    const binding = await holdRpc(migrateCall(f.clerk, f.who.user));
    expect(binding.result).toMatchObject({ ok: true, migrated: kind !== "bound" });
    const deletion = `social_migration_delete_${key()}`;
    const deleting = outcome(deletion, deleteAccount(f.who), "postgres");
    try {
      await postgresPoll(() => waitsOnAnyLock(deletion)).toBe("t");
    } finally { await binding.finish(); }
    const deleted = await deleting;
    expect(deleted.ok, deleted.said).toBe(true);
    const account = binding.result.product_account_id as string;
    expect(accountOf(f.who)).toBe(`${account}|suspended|true`);
    expect(audits(f.who)).toBe(kind === "bound" ? "0" : "1");
    expect(tombstoned(f.who)).toBe("t");
  });

  it("refuses a missing or deleted auth user and writes nothing", () => {
    expect(migrate("clerk-nobody", randomUUID())).toEqual(GONE);
    const f = legacy("unbound");
    db().sql(deleteAccount(f.who));
    expect(migrate(f.clerk, f.who.user)).toEqual(GONE);
    expect(accountOf(f.who)).toBe(`${f.who.account}|active|true`);
    expect(audits(f.who)).toBe("0");
  });

  it("binds once, answers a repeat without a second audit row, and binds an unbound account", () => {
    const fresh = legacy("none");
    const first = migrate(fresh.clerk, fresh.who.user);
    expect(first).toMatchObject({ ok: true, migrated: true });
    expect(migrate(fresh.clerk, fresh.who.user)).toEqual({ ok: true, migrated: false, product_account_id: first.product_account_id });
    expect(audits(fresh.who)).toBe("1");
    const unbound = legacy("unbound");
    expect(migrate(unbound.clerk, unbound.who.user)).toEqual({ ok: true, migrated: true, product_account_id: unbound.who.account });
    expect(accountOf(unbound.who)).toBe(`${unbound.who.account}|active|false`);
    expect(audits(unbound.who)).toBe("1");
  });

  it("keeps every ownership conflict answer and writes nothing for one", () => {
    const owner = legacy("bound"), other = legacy("none"), stray = legacy("unbound");
    expect(migrate(owner.clerk, other.who.user)).toEqual(CONFLICT);
    expect(migrate(`clerk-another-${owner.who.handle}`, owner.who.user)).toEqual(CONFLICT);
    expect(migrate(stray.clerk, owner.who.user)).toEqual(CONFLICT);
    expect(migrate("  ", owner.who.user)).toEqual(CONFLICT);
    expect(accountOf(other.who)).toBe("none");
    expect(accountOf(stray.who)).toBe(`${stray.who.account}|active|true`);
    for (const f of [owner, other, stray]) expect(audits(f.who)).toBe("0");
  });

  it("stays service-only", async () => {
    const f = legacy("none");
    for (const role of ["anon", "authenticated"] as const) {
      const attempt = await db().attempt(asBrowserRole(role, f.who.user, rpc(migrateCall(f.clerk, f.who.user))));
      expect(attempt.ok).toBe(false);
      expect(attempt.said).toContain("permission denied");
    }
    expect(accountOf(f.who)).toBe("none");
  });

  it("rollback restores the 0071 order and its deadlock, and reapplying fixes it again", async () => {
    apply(rollback);
    try {
      const old = await interleaved(legacy("none"));
      expect([old.deleted.said, old.migrated?.said].filter((said) => DEADLOCK.test(said ?? ""))).toHaveLength(1);
    } finally { apply(forward); }
    apply(forward);
    const fixed = await interleaved(legacy("none"));
    expect(fixed.deleted.ok, fixed.deleted.said).toBe(true);
    expect(json(fixed.migrated?.said ?? "{}")).toEqual(GONE);
  });
});
