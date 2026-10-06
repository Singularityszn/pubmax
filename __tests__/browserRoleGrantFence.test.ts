// The browser roles' grants in public, read off a full migration replay.
//
// 0170 and 0171 each found a public table still holding the grants Supabase
// gives anon and authenticated by default. 0172 swept them and revoked that
// default for new tables, sequences and functions. This suite replays every
// migration on the session fixture and holds what anon, authenticated and
// PUBLIC hold on public relations and their columns to the lists below, and
// holds the migration role's default privileges to nothing for either
// browser role. A new browser grant fails here until a migration's author
// adds it below on purpose, and a revoked one fails until it comes off.

import { readdirSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  postgresSkipReason,
  startPostgres,
  type PostgresSession,
} from "./helpers/postgres";

const skipReason = postgresSkipReason();

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase/migrations");
const SESSION_FIXTURE = join(ROOT, "scripts/rls/session-fixture.sql");

type BrowserRole = "anon" | "authenticated";

const SIGNED_IN: readonly BrowserRole[] = ["authenticated"];
const EVERYONE: readonly BrowserRole[] = ["anon", "authenticated"];

/** Whole-table SELECT, each behind a SELECT policy that admits the role. */
const TABLE_SELECT: Readonly<Record<string, readonly BrowserRole[]>> = {
  adult_self_assertions: SIGNED_IN,
  check_ins: SIGNED_IN,
  conversation_members: SIGNED_IN,
  conversations: SIGNED_IN,
  crawl_stories: EVERYONE,
  diary_entries: SIGNED_IN,
  drinks: EVERYONE,
  follows: SIGNED_IN,
  message_poll_votes: SIGNED_IN,
  messages: SIGNED_IN,
  night_memories: SIGNED_IN,
  night_moment_consents: SIGNED_IN,
  night_moments: SIGNED_IN,
  night_profiles: SIGNED_IN,
  night_stories: SIGNED_IN,
  night_story_contributors: SIGNED_IN,
  night_story_moments: SIGNED_IN,
  night_story_publish_proposals: SIGNED_IN,
  notifications: SIGNED_IN,
  plan_stops: SIGNED_IN,
  private_account_identities: SIGNED_IN,
  profile_handle_aliases: SIGNED_IN,
  profiles: SIGNED_IN,
  pub_heritage: EVERYONE,
  pub_pal_mastery_events: SIGNED_IN,
  pub_pal_memories: SIGNED_IN,
  pub_pal_voice_usage: SIGNED_IN,
  pub_pals: SIGNED_IN,
  saved_list_follows: SIGNED_IN,
  saved_lists: SIGNED_IN,
  saved_pubs: SIGNED_IN,
  step_out_nudge_prefs: SIGNED_IN,
  wanteds: SIGNED_IN,
};

/** Column SELECT where the whole row may not leave. */
const COLUMN_SELECT: Readonly<
  Record<string, { roles: readonly BrowserRole[]; columns: readonly string[] }>
> = {
  community_prices: {
    roles: SIGNED_IN,
    columns: [
      "id",
      "venue_id",
      "drink_category",
      "price_pennies",
      "submitted_at",
      "corroborated_at",
      "contradicted_at",
    ],
  },
  night_signal_claims: {
    roles: EVERYONE,
    columns: [
      "id",
      "kind",
      "entity_type",
      "entity_id",
      "claim",
      "source_url",
      "publisher",
      "published_at",
      "observed_at",
      "expires_at",
      "confidence",
      "review_state",
      "verification",
      "route_effect",
      "corroborating_sources",
      "reviewed_at",
      "review_authority",
      "created_at",
    ],
  },
  plan_crew_members: {
    roles: SIGNED_IN,
    columns: ["id", "plan_id", "name", "status", "user_id", "joined_at", "updated_at"],
  },
  plans: {
    roles: SIGNED_IN,
    columns: [
      "id",
      "title",
      "start_time",
      "owner_user_id",
      "created_at",
      "status",
      "night_context",
      "ending",
      "route_revision",
      "creation_key_hash",
      "creation_request_hash",
      "anchor_venue_id",
      "anchor_source",
      "plan_outcome",
      "route_ready_at",
    ],
  },
};

const BROWSER_GRANTEES = `(0, 'anon'::regrole, 'authenticated'::regrole)`;
const GRANTEE_NAME = `case when a.grantee = 0 then 'public' else a.grantee::regrole::text end`;

let database: PostgresSession | null = null;

function requireDatabase(): PostgresSession {
  if (!database) throw new Error("PostgreSQL session unavailable.");
  return database;
}

function rows(statement: string): string[] {
  const said = requireDatabase().sql(statement);
  return said.length === 0 ? [] : said.split("\n");
}

function expectedRelationGrants(): string[] {
  return Object.entries(TABLE_SELECT)
    .flatMap(([table, roles]) => roles.map((role) => `${table} ${role} SELECT`))
    .sort();
}

function expectedColumnGrants(): string[] {
  return Object.entries(COLUMN_SELECT)
    .flatMap(([table, { roles, columns }]) =>
      roles.flatMap((role) => columns.map((column) => `${table}.${column} ${role} SELECT`)),
    )
    .sort();
}

beforeAll(async () => {
  if (skipReason) return;
  database = await startPostgres({ label: "grant-fence", database: "pubmax_grant_fence" });
  const session = requireDatabase();
  session.applyFile(SESSION_FIXTURE);
  for (const name of readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql")).sort()) {
    session.applyFile(join(MIGRATIONS, name));
  }
}, 300_000);

afterAll(async () => {
  await database?.stop();
  database = null;
});

describe.skipIf(skipReason !== null)("browser-role grants in public", () => {
  it("hold no relation privilege off the allow-list", () => {
    const observed = rows(
      `select c.relname || ' ' || ${GRANTEE_NAME} || ' ' || a.privilege_type
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        cross join lateral aclexplode(c.relacl) a
        where n.nspname = 'public'
          and a.grantee in ${BROWSER_GRANTEES}
        order by 1;`,
    );
    expect(observed.sort()).toEqual(expectedRelationGrants());
  });

  it("hold no column privilege off the allow-list", () => {
    const observed = rows(
      `select c.relname || '.' || att.attname || ' ' || ${GRANTEE_NAME} || ' ' || a.privilege_type
         from pg_attribute att
         join pg_class c on c.oid = att.attrelid
         join pg_namespace n on n.oid = c.relnamespace
        cross join lateral aclexplode(att.attacl) a
        where n.nspname = 'public'
          and a.grantee in ${BROWSER_GRANTEES}
        order by 1;`,
    );
    expect(observed.sort()).toEqual(expectedColumnGrants());
  });

  it("take nothing by default on a new public table, sequence or function", () => {
    const observed = rows(
      `select d.defaclobjtype::text || ' ' || ${GRANTEE_NAME} || ' ' || a.privilege_type
         from pg_default_acl d
        cross join lateral aclexplode(d.defaclacl) a
        where (d.defaclnamespace = 0 or d.defaclnamespace = 'public'::regnamespace)
          and a.grantee in ('anon'::regrole, 'authenticated'::regrole)
        order by 1;`,
    );
    expect(observed).toEqual([]);
  });
});
