// Effective proof for 0146, and for the half of 0034 the review lane now
// depends on. This file APPLIES the migrations to a real PostgreSQL 16 and
// exercises the tables as the three Supabase roles, because a policy is a claim
// about what a role may do and only the database can answer that.
//
// Same host contract as the other effective migration proofs: a host with no
// PostgreSQL binaries skips LOUDLY rather than passing quietly.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  postgresSkipReason,
  startPostgres,
  type PostgresSession,
} from "./helpers/postgres";

const skipReason = postgresSkipReason();

const CLAIMS_MIGRATION = join(
  process.cwd(),
  "supabase/migrations/20260716190000_0034_night_signal_claims.sql",
);
const SEARCH_PATH_MIGRATION = join(
  process.cwd(),
  "supabase/migrations/20260716200100_0036_fix_night_signal_function_search_paths.sql",
);
const RLS_WAVE2 = join(
  process.cwd(),
  "supabase/migrations/20260803203000_0068_rls_wave2_service_role_only.sql",
);
const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations/20260905160000_0146_night_signal_ingest_checkpoint.sql",
);
const ROLLBACK_PATH = join(
  process.cwd(),
  "supabase/migrations/rollback/20260905160000_0146_night_signal_ingest_checkpoint_rollback.sql",
);

/** The night_signal_claims statements of 0068, exactly as that migration ships them. */
function nightSignalBlockOf(wave2: string): string {
  const start = wave2.indexOf("-- night_signal_claims:");
  const end = wave2.lastIndexOf("commit;");
  const block = start >= 0 && end > start ? wave2.slice(start, end) : "";
  if (!block.includes("on table public.night_signal_claims to service_role;")) {
    throw new Error("0068 no longer carries its night_signal_claims grants; this proof is stale.");
  }
  return block;
}

let session: PostgresSession | null = null;

beforeAll(async () => {
  if (skipReason) return;
  session = await startPostgres({ label: "night-signal-checkpoint-0146", database: "pubmax_night_signal_0146" });
  // The Supabase roles these tables are governed by. service_role carries
  // BYPASSRLS in a Supabase project, so the local cluster mirrors that or
  // "the write path still works" would not be the thing under test.
  session.sql(`
    create role anon nologin noinherit;
    create role authenticated nologin noinherit;
    create role service_role nologin noinherit bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    -- A Supabase project ships default privileges that grant EXECUTE on new
    -- public functions to these roles. 0034 revokes its validation helpers
    -- from PUBLIC and relies on that grant surviving, so the local cluster
    -- mirrors it or the write path would fail here for a reason no deployed
    -- database has.
    alter default privileges in schema public
      grant execute on functions to anon, authenticated, service_role;
  `);
  session.applyFile(CLAIMS_MIGRATION);
  session.applyFile(SEARCH_PATH_MIGRATION);
  // 0034 creates the table; the grants the write path needs ship in 0068,
  // which also touches tables this cluster has no reason to hold. So the
  // night_signal_claims block of that migration is applied VERBATIM rather
  // than restated, or this proof would be about a grant nobody deployed.
  session.sql(nightSignalBlockOf(readFileSync(RLS_WAVE2, "utf8")));
  session.applyFile(MIGRATION_PATH);
}, 180_000);

beforeEach(() => {
  session?.sql(
    "truncate public.night_signal_ingest_checkpoint; truncate public.night_signal_claims;",
  );
});

afterAll(async () => {
  await session?.stop();
});

function requireSession(): PostgresSession {
  if (!session) throw new Error("PostgreSQL Night Signal session did not start.");
  return session;
}

const CANDIDATE_ID = "opening:camden:20260901:abcd1234";

function insertCandidate(reviewState: string, reviewer: string | null): string {
  const reviewedAt = reviewer ? "now()" : "null";
  const authority = reviewer ? `'${reviewer}'` : "null";
  return `
    insert into public.night_signal_claims
      (id, kind, entity_type, entity_id, claim, source_url, publisher, published_at,
       observed_at, expires_at, confidence, review_state, verification, route_effect,
       reviewed_at, review_authority)
    values
      ('${CANDIDATE_ID}', 'opening', 'night_area', 'camden',
       'The Camden Arms reopens as a late-night taproom on Chalk Farm Road',
       'https://example.com/london/camden-arms', 'example.com', now() - interval '3 days',
       now() - interval '1 day', now() + interval '20 days', 0.5, '${reviewState}',
       'single_source', 'none', ${reviewedAt}, ${authority})
  `;
}

describe.skipIf(skipReason !== null)("0146 applied to PostgreSQL", () => {
  it("takes one checkpoint per scope from the service role", () => {
    const db = requireSession();
    db.sql(`
      set role service_role;
      insert into public.night_signal_ingest_checkpoint (scope, version, deferred, terminal)
      values ('london', 1, '[{"key":"opening|new London pub","attempts":1}]'::jsonb, '[]'::jsonb);
    `);
    expect(
      db.sql(
        "set role service_role; select scope, jsonb_array_length(deferred) from public.night_signal_ingest_checkpoint",
      ),
    ).toBe("london|1");

    expect(
      db.expectRefusal(`
        set role service_role;
        insert into public.night_signal_ingest_checkpoint (scope) values ('london');
      `),
    ).toMatch(/duplicate key value|night_signal_ingest_checkpoint_pkey/i);
  });

  it("refuses half a lease, in either direction", () => {
    const db = requireSession();
    expect(
      db.expectRefusal(`
        set role service_role;
        insert into public.night_signal_ingest_checkpoint (scope, lease_owner)
        values ('london', 'run-a');
      `),
    ).toMatch(/violates check constraint/i);
    expect(
      db.expectRefusal(`
        set role service_role;
        insert into public.night_signal_ingest_checkpoint (scope, lease_expires_at)
        values ('london', now() + interval '2 minutes');
      `),
    ).toMatch(/violates check constraint/i);
  });

  it("gives exactly one of two racing runs the lease", () => {
    const db = requireSession();
    db.sql(`
      set role service_role;
      insert into public.night_signal_ingest_checkpoint (scope) values ('london');
    `);
    // The claim the store issues: a conditional UPDATE that matches only a null
    // or expired lease. The first run takes the row; the second matches nothing.
    const claim = (owner: string): string => `
      set role service_role;
      update public.night_signal_ingest_checkpoint
      set lease_owner = '${owner}', lease_expires_at = now() + interval '150 seconds'
      where scope = 'london' and (lease_owner is null or lease_expires_at < now())
      returning lease_owner;
    `;
    expect(db.sql(claim("run-a"))).toBe("run-a");
    expect(db.sql(claim("run-b"))).toBe("");

    // A commit guarded on the lease we hold: the run that lost writes nothing.
    const commit = (owner: string): string => `
      set role service_role;
      update public.night_signal_ingest_checkpoint
      set terminal = '[{"key":"x","attempts":3}]'::jsonb, lease_owner = null, lease_expires_at = null
      where scope = 'london' and lease_owner = '${owner}'
      returning scope;
    `;
    expect(db.sql(commit("run-b"))).toBe("");
    expect(db.sql(commit("run-a"))).toBe("london");
  });

  it("keeps the browser out of the checkpoint entirely", () => {
    const db = requireSession();
    db.sql(`
      set role service_role;
      insert into public.night_signal_ingest_checkpoint (scope) values ('london');
    `);
    for (const role of ["anon", "authenticated"]) {
      expect(
        db.expectRefusal(
          `set role ${role}; select scope from public.night_signal_ingest_checkpoint;`,
        ),
      ).toMatch(/permission denied/i);
      expect(
        db.expectRefusal(
          `set role ${role}; insert into public.night_signal_ingest_checkpoint (scope) values ('leeds');`,
        ),
      ).toMatch(/permission denied/i);
    }
  });
});

describe.skipIf(skipReason !== null)("the candidate queue 0146 exists to feed", () => {
  it("stores a pending candidate that no reader may see", () => {
    const db = requireSession();
    db.sql(`set role service_role; ${insertCandidate("pending", null)};`);
    expect(
      db.sql("set role service_role; select review_state from public.night_signal_claims"),
    ).toBe("pending");
    // 0034's policy admits approved, current rows only, so an unreviewed
    // third-party claim is invisible to anon and to a signed-in member.
    for (const role of ["anon", "authenticated"]) {
      expect(db.sql(`set role ${role}; select id from public.night_signal_claims;`)).toBe("");
    }
  });

  it("refuses an approval that names no reviewer, and takes one that does", () => {
    const db = requireSession();
    expect(db.expectRefusal(`set role service_role; ${insertCandidate("approved", null)};`)).toMatch(
      /violates check constraint/i,
    );

    db.sql(`set role service_role; ${insertCandidate("approved", "operations")};`);
    // Approved, dated and in window: now a reader sees it.
    expect(db.sql("set role anon; select entity_id from public.night_signal_claims;")).toBe(
      "camden",
    );
  });

  it("keeps a rejected candidate out of every reader's answer", () => {
    const db = requireSession();
    db.sql(`set role service_role; ${insertCandidate("rejected", "operations")};`);
    expect(db.sql("set role anon; select id from public.night_signal_claims;")).toBe("");
  });
});

describe.skipIf(skipReason !== null)("the 0146 rollback", () => {
  it("drops the checkpoint and leaves the candidates alone", () => {
    const db = requireSession();
    db.sql(`set role service_role; ${insertCandidate("pending", null)};`);
    db.applyFile(ROLLBACK_PATH);
    expect(db.sql("select to_regclass('public.night_signal_ingest_checkpoint') is null")).toBe("t");
    expect(db.sql("set role service_role; select count(*) from public.night_signal_claims")).toBe(
      "1",
    );
    // Put it back for any case that runs after this one.
    db.applyFile(MIGRATION_PATH);
  });
});
