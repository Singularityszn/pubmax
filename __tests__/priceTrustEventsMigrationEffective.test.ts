// Effective proof for 0108. This file APPLIES the migration to a real
// PostgreSQL 16 and exercises both tables as the three Supabase roles, because
// "service-role only", "one credit per account per unlock" and "a reversal is a
// new row" are claims about what the database does, and only the database can
// answer them.
//
// Same host contract as the other effective migration proofs
// (occupancyMigrationEffective, foundingMembersMigration): a host with no
// PostgreSQL binaries skips loudly rather than passing quietly.

import { join } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  postgresSkipReason,
  startPostgres,
  type PostgresSession,
} from "./helpers/postgres";

const skipReason = postgresSkipReason();

import { trustEventFingerprint, reversalFingerprint } from "@/lib/priceTrustEvents";

const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations/20260816210000_0108_price_trust_events.sql",
);
const ROLLBACK_PATH = join(
  process.cwd(),
  "supabase/migrations/rollback/20260816210000_0108_price_trust_events_rollback.sql",
);

const ANNA = "00000000-0000-4000-8000-000000000021";
const BEN = "00000000-0000-4000-8000-000000000022";
const VENUE = "venue-16pnwmm";
const OBSERVATIONS = ["obs-2", "obs-1"];
const FINGERPRINT = trustEventFingerprint(VENUE, "beer", OBSERVATIONS);
const EVENT_ID = "10000000-0000-4000-8000-000000000001";
const REVERSAL_ID = "10000000-0000-4000-8000-000000000002";

let session: PostgresSession | null = null;

beforeAll(async () => {
  if (skipReason) return;
  session = await startPostgres({ label: "price-trust-0108", database: "pubmax_price_trust_0108" });
  // The Supabase roles these tables are governed by. service_role carries
  // BYPASSRLS in a Supabase project, so the local cluster mirrors that or
  // "the write path still works" would not be the thing under test.
  session.sql(`
    create role anon nologin noinherit;
    create role authenticated nologin noinherit;
    create role service_role nologin noinherit bypassrls;
    grant usage on schema public to anon, authenticated, service_role;

    create schema auth;
    grant usage on schema auth to anon, authenticated, service_role;
    create table auth.users (id uuid primary key);
    insert into auth.users (id) values ('${ANNA}'), ('${BEN}');
  `);
  session.applyFile(MIGRATION_PATH);
}, 180_000);

beforeEach(() => {
  // The cascade proof deletes an account, so both accounts are re-seeded per
  // test rather than once, and a failed assertion cannot strand the next test.
  session?.sql(
    `truncate public.price_trust_credits, public.price_trust_events;
     insert into auth.users (id) values ('${ANNA}'), ('${BEN}') on conflict do nothing;`,
  );
});

afterAll(async () => {
  await session?.stop();
});

function requireSession(): PostgresSession {
  if (!session) throw new Error("PostgreSQL price trust session did not start.");
  return session;
}

/** The insert the store issues for a first-cluster unlock, idempotent by fingerprint. */
function insertUnlock(
  options: { id?: string; fingerprint?: string; category?: string } = {},
): string {
  const id = options.id ?? EVENT_ID;
  const fingerprint = options.fingerprint ?? FINGERPRINT;
  const category = options.category ?? "beer";
  return `
    insert into public.price_trust_events
      (id, evidence_fingerprint, venue_id, category, observation_ids)
    values ('${id}', '${fingerprint}', '${VENUE}', '${category}',
            array['obs-1','obs-2']::text[])
    on conflict (evidence_fingerprint) do nothing
  `;
}

/** The credit the store issues per independent contributor, idempotent per pair. */
function insertCredit(userId: string, eventId: string = EVENT_ID): string {
  return `
    insert into public.price_trust_credits (user_id, trust_event_id)
    values ('${userId}', '${eventId}')
    on conflict (user_id, trust_event_id) do nothing
  `;
}

describe.skipIf(skipReason !== null)("0108 applied to PostgreSQL", () => {
  it("records one unlock and credits every independent contributor in it", () => {
    const db = requireSession();
    db.sql(
      `set role service_role;
       ${insertUnlock()};
       ${insertCredit(ANNA)};
       ${insertCredit(BEN)};`,
    );

    expect(
      db.sql(
        `set role service_role;
         select venue_id, category, array_to_string(observation_ids, ','), reversal_of is null
         from public.price_trust_events`,
      ),
    ).toBe(`${VENUE}|beer|obs-1,obs-2|t`);
    expect(
      db.sql(
        `set role service_role;
         select count(*) from public.price_trust_credits where trust_event_id = '${EVENT_ID}'`,
      ),
    ).toBe("2");
  });

  it("makes a repeat of the same evidence a no-op, so nobody is credited twice", () => {
    const db = requireSession();
    db.sql(`set role service_role; ${insertUnlock()}; ${insertCredit(ANNA)};`);

    // A later agreeing report re-derives the SAME fingerprint from the same
    // first cluster. The second write must add neither an event nor a credit.
    db.sql(
      `set role service_role;
       ${insertUnlock({ id: "10000000-0000-4000-8000-0000000000ff" })};
       ${insertCredit(ANNA)};`,
    );

    expect(
      db.sql("set role service_role; select count(*) from public.price_trust_events"),
    ).toBe("1");
    expect(
      db.sql(
        `set role service_role; select id::text from public.price_trust_events`,
      ),
    ).toBe(EVENT_ID);
    expect(
      db.sql("set role service_role; select count(*) from public.price_trust_credits"),
    ).toBe("1");
  });

  it("takes a reversal as a NEW row and leaves the original untouched", () => {
    const db = requireSession();
    db.sql(`set role service_role; ${insertUnlock()}; ${insertCredit(ANNA)};`);
    const originalCreatedAt = db.sql(
      `set role service_role; select created_at::text from public.price_trust_events`,
    );

    // The moderator hide path: an immutable reversal row plus the revoked credit.
    db.sql(
      `set role service_role;
       insert into public.price_trust_events
         (id, evidence_fingerprint, venue_id, category, observation_ids, reversal_of)
       values ('${REVERSAL_ID}', '${reversalFingerprint(FINGERPRINT)}', '${VENUE}', 'beer',
               array['obs-1','obs-2']::text[], '${EVENT_ID}');
       delete from public.price_trust_credits where trust_event_id = '${EVENT_ID}';`,
    );

    expect(
      db.sql(
        `set role service_role;
         select created_at::text from public.price_trust_events where id = '${EVENT_ID}'`,
      ),
    ).toBe(originalCreatedAt);
    expect(
      db.sql(
        `set role service_role;
         select reversal_of::text from public.price_trust_events where id = '${REVERSAL_ID}'`,
      ),
    ).toBe(EVENT_ID);
    expect(
      db.sql("set role service_role; select count(*) from public.price_trust_credits"),
    ).toBe("0");

    // A replacement unlock off the remaining evidence is a different cluster,
    // so it carries its own fingerprint and lands beside the reversal.
    const replacement = trustEventFingerprint(VENUE, "beer", ["obs-2", "obs-3"]);
    expect(replacement).not.toBe(FINGERPRINT);
    db.sql(
      `set role service_role;
       ${insertUnlock({ id: "10000000-0000-4000-8000-000000000003", fingerprint: replacement })};`,
    );
    expect(
      db.sql("set role service_role; select count(*) from public.price_trust_events"),
    ).toBe("3");
  });

  it("gives the browser roles neither a read nor a write on either table", () => {
    const db = requireSession();
    db.sql(`set role service_role; ${insertUnlock()}; ${insertCredit(ANNA)};`);

    for (const role of ["anon", "authenticated"]) {
      expect(
        db.expectRefusal(
          `set role ${role}; select evidence_fingerprint from public.price_trust_events`,
        ),
      ).toMatch(/permission denied for table price_trust_events/);
      expect(db.expectRefusal(`set role ${role}; ${insertUnlock()};`)).toMatch(
        /permission denied for table price_trust_events/,
      );
      expect(
        db.expectRefusal(
          `set role ${role}; select user_id from public.price_trust_credits`,
        ),
      ).toMatch(/permission denied for table price_trust_credits/);
      expect(db.expectRefusal(`set role ${role}; ${insertCredit(ANNA)};`)).toMatch(
        /permission denied for table price_trust_credits/,
      );
    }

    // The rows are still there: the browser was refused, not the write path.
    expect(
      db.sql("set role service_role; select count(*) from public.price_trust_credits"),
    ).toBe("1");
  });

  it("binds a credit to a live account and takes it with the account", () => {
    const db = requireSession();
    db.sql(`set role service_role; ${insertUnlock()}; ${insertCredit(ANNA)}; ${insertCredit(BEN)};`);

    expect(
      db.expectRefusal(
        `set role service_role; ${insertCredit("00000000-0000-4000-8000-0000000000aa")};`,
      ),
    ).toMatch(/price_trust_credits_user_id_fkey/);

    db.sql(`delete from auth.users where id = '${ANNA}'`);
    expect(
      db.sql("set role service_role; select user_id::text from public.price_trust_credits"),
    ).toBe(BEN);
    // The unlock itself is a fact about the pub, so it outlives the account.
    expect(
      db.sql("set role service_role; select count(*) from public.price_trust_events"),
    ).toBe("1");
  });

  it("refuses a category outside the drink taxonomy", () => {
    const db = requireSession();
    expect(
      db.expectRefusal(`set role service_role; ${insertUnlock({ category: "pint" })};`),
    ).toMatch(/price_trust_events_category_check/);
  });

  it("rolls back to a database with neither table, and re-applies", () => {
    const db = requireSession();
    db.sql(`set role service_role; ${insertUnlock()}; ${insertCredit(ANNA)};`);

    db.applyFile(ROLLBACK_PATH);
    expect(db.sql("select to_regclass('public.price_trust_events') is null")).toBe("t");
    expect(db.sql("select to_regclass('public.price_trust_credits') is null")).toBe("t");

    db.applyFile(MIGRATION_PATH);
    expect(
      db.sql("set role service_role; select count(*) from public.price_trust_events"),
    ).toBe("0");
  });
});
