// Effective proof for 0192 on a real PostgreSQL 16, over every migration
// before it. The fault is reproduced first: under 0126 a failed run goes back
// on the queue with no count, so the pair is retried forever. Then 0192: the
// column and its default, the failure function (version-bound, the cap, the
// dead letter), the fresh budget on a new write through both doors, the
// refused browser roles, and the rollback back to the 0126 shape.

import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { listMigrations } from "../scripts/qa/migration-apply-list.mjs";
import { postgresSkipReason, startPostgres, type PostgresSession } from "./helpers/postgres";

const skipReason = postgresSkipReason();
const MIGRATIONS = join(process.cwd(), "supabase/migrations");
const NAME = "20261018120100_0192_price_trust_queue_attempts";
const FORWARD = join(MIGRATIONS, `${NAME}.sql`);
const ROLLBACK = join(MIGRATIONS, "rollback", `${NAME}_rollback.sql`);
const CAP = 5;

let session: PostgresSession | null = null;

function db(): PostgresSession {
  if (!session) throw new Error("Price trust queue PostgreSQL session unavailable.");
  return session;
}

function asService(statement: string): string {
  return db().sql(`set role service_role; ${statement}`);
}

function enqueue(venueId: string): string {
  return asService(
    `select version from public.enqueue_price_trust_reconciliation('${venueId}', 'beer')`,
  );
}

function fail(venueId: string, version: string, cap = CAP): string {
  return asService(
    `select attempts || ':' || dead_lettered
       from public.record_price_trust_reconciliation_failure('${venueId}', 'beer', ${version}, ${cap})`,
  );
}

function row(venueId: string): string {
  return db().sql(
    `select attempts || '|' || (dead_lettered_at is not null)
       from public.price_trust_reconciliation_queue
      where venue_id = '${venueId}' and category = 'beer'`,
  );
}

function queueColumns(): string {
  return db().sql(
    `select string_agg(column_name, ',' order by ordinal_position)
       from information_schema.columns
      where table_schema = 'public' and table_name = 'price_trust_reconciliation_queue'`,
  );
}

function enqueueDefinition(): string {
  return db().sql(
    `select md5(pg_get_functiondef('public.enqueue_price_trust_reconciliation(text, text)'::regprocedure))`,
  );
}

let enqueueBefore = "";

beforeAll(async () => {
  if (skipReason) return;
  session = await startPostgres({ label: "price-trust-0192", database: "pubmax_price_trust_0192" });
  db().applyFile(join(process.cwd(), "scripts/rls/session-fixture.sql"));
  for (const filename of listMigrations(MIGRATIONS).filter((file) => file < `${NAME}.sql`)) {
    db().applyFile(join(MIGRATIONS, filename));
  }
  enqueueBefore = enqueueDefinition();
}, 600_000);

afterAll(async () => {
  await session?.stop();
});

describe.skipIf(skipReason !== null)("0192 applied to PostgreSQL", () => {
  it("reproduces the fault before 0192: a failed pair is re-queued with no count", () => {
    expect(queueColumns()).toBe("venue_id,category,version,enqueued_at");
    const first = enqueue("venue-before");
    // The 0126 worker's only move on failure: enqueue again. Nothing counts.
    let latest = first;
    for (let run = 0; run < CAP + 3; run += 1) latest = enqueue("venue-before");
    expect(Number(latest)).toBeGreaterThan(Number(first));
    expect(
      db().sql(
        `select count(*) from public.price_trust_reconciliation_queue where venue_id = 'venue-before'`,
      ),
    ).toBe("1");
    expect(
      db().sql(
        `select to_regprocedure('public.record_price_trust_reconciliation_failure(text, text, bigint, integer)') is null`,
      ),
    ).toBe("t");
  });

  it("adds attempts with default 0 to rows already queued, and refuses a negative count", () => {
    db().applyFile(FORWARD);
    expect(queueColumns()).toBe(
      "venue_id,category,version,enqueued_at,attempts,dead_lettered_at",
    );
    expect(
      db().sql(
        `select is_nullable || '|' || column_default
           from information_schema.columns
          where table_schema = 'public' and table_name = 'price_trust_reconciliation_queue'
            and column_name = 'attempts'`,
      ),
    ).toBe("NO|0");
    expect(row("venue-before")).toBe("0|false");
    expect(
      db().expectRefusal(
        `update public.price_trust_reconciliation_queue set attempts = -1 where venue_id = 'venue-before'`,
      ),
    ).toMatch(/price_trust_reconciliation_queue_attempts_check/);
    expect(
      db().sql(
        `select indexdef from pg_indexes
          where schemaname = 'public' and indexname = 'price_trust_reconciliation_queue_live_idx'`,
      ),
    ).toMatch(/WHERE \(dead_lettered_at IS NULL\)/);
  });

  it("counts each failure, moves the row back, and dead-letters at the cap", () => {
    const version = enqueue("venue-cap");
    const enqueuedAt = db().sql(
      `select enqueued_at::text from public.price_trust_reconciliation_queue where venue_id = 'venue-cap'`,
    );
    for (let run = 1; run < CAP; run += 1) {
      expect(fail("venue-cap", version)).toBe(`${run}:false`);
    }
    expect(row("venue-cap")).toBe(`${CAP - 1}|false`);
    // The version does not move, so a direct sync holding it can still ack.
    expect(
      db().sql(
        `select version from public.price_trust_reconciliation_queue where venue_id = 'venue-cap'`,
      ),
    ).toBe(version);
    expect(
      db().sql(
        `select enqueued_at > '${enqueuedAt}'::timestamptz
           from public.price_trust_reconciliation_queue where venue_id = 'venue-cap'`,
      ),
    ).toBe("t");

    expect(fail("venue-cap", version)).toBe(`${CAP}:true`);
    expect(row("venue-cap")).toBe(`${CAP}|true`);
    // A dead-lettered row is charged no further, and the row is kept.
    expect(fail("venue-cap", version)).toBe("");
    expect(row("venue-cap")).toBe(`${CAP}|true`);
  });

  it("never charges a newer version for an older failure", () => {
    const old = enqueue("venue-race");
    const newer = enqueue("venue-race");
    expect(fail("venue-race", old)).toBe("");
    expect(row("venue-race")).toBe("0|false");
    expect(fail("venue-race", newer)).toBe("1:false");
    expect(fail("venue-race", newer, 0)).toBe("");
  });

  it("gives a new write a fresh budget, through the RPC and through the 0126 trigger", () => {
    expect(row("venue-cap")).toBe(`${CAP}|true`);
    enqueue("venue-cap");
    expect(row("venue-cap")).toBe("0|false");

    const version = enqueue("venue-trigger");
    for (let run = 0; run < CAP; run += 1) fail("venue-trigger", version);
    expect(row("venue-trigger")).toBe(`${CAP}|true`);
    db().sql(
      `insert into public.community_prices (venue_id, drink_category, price_pennies, actor)
       values ('venue-trigger', 'beer', 575, 'profile:fixture-0192')`,
    );
    expect(row("venue-trigger")).toBe("0|false");
  });

  it("keeps the failure function away from the browser roles", () => {
    const version = enqueue("venue-browser");
    for (const role of ["anon", "authenticated"]) {
      expect(
        db().expectRefusal(
          `set role ${role};
           select * from public.record_price_trust_reconciliation_failure('venue-browser', 'beer', ${version}, ${CAP})`,
        ),
      ).toMatch(/permission denied for function record_price_trust_reconciliation_failure/);
    }
    expect(row("venue-browser")).toBe("0|false");
  });

  it("rolls back to the 0126 shape, and re-applies", () => {
    db().applyFile(ROLLBACK);
    expect(queueColumns()).toBe("venue_id,category,version,enqueued_at");
    expect(enqueueDefinition()).toBe(enqueueBefore);
    expect(
      db().sql(
        `select to_regprocedure('public.record_price_trust_reconciliation_failure(text, text, bigint, integer)') is null`,
      ),
    ).toBe("t");
    expect(db().sql(`select to_regclass('public.price_trust_reconciliation_queue_live_idx') is null`)).toBe("t");
    // Queue rows survive, and the 0126 enqueue still works.
    expect(
      db().sql(`select count(*) from public.price_trust_reconciliation_queue where venue_id = 'venue-cap'`),
    ).toBe("1");
    expect(Number(enqueue("venue-after-rollback"))).toBeGreaterThan(0);

    db().applyFile(FORWARD);
    expect(row("venue-cap")).toBe("0|false");
    expect(row("venue-after-rollback")).toBe("0|false");
  });
});
