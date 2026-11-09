// Migration 0124, proved against a real PostgreSQL 16 holding every migration
// before it.
//
// An admin moderation choice is bound to the exact held revision the moderator
// reviewed.
//
//   BEFORE 0124: no revision-bound overload exists.
//   AFTER  0124: a stale or missing revision is refused and nothing moves; the
//                reviewed revision is approved once; the legacy four-argument
//                overload answers false and moves nothing; no browser role can
//                call the new overload.
//   ROLLBACK:    the revision-bound overload goes and the legacy one stays
//                fail closed.

import { readdirSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  asBrowserRole,
  asServiceRole,
  postgresSkipReason,
  startPostgres,
  type PostgresSession,
} from "./helpers/postgres";

const skipReason = postgresSkipReason();

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase/migrations");
const FORWARD_NAME = "20260830120000_0124_social_admin_revision_guard.sql";
const FORWARD = join(MIGRATIONS, FORWARD_NAME);
const ROLLBACK = join(MIGRATIONS, "rollback/20260830120000_0124_social_admin_revision_guard_rollback.sql");
const SESSION_FIXTURE = join(ROOT, "scripts/rls/session-fixture.sql");
const PREREQUISITES = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith(".sql") && name < FORWARD_NAME)
  .sort()
  .map((name) => join(MIGRATIONS, name));

const AUTHOR = "a1240000-0000-4000-8000-000000000001";
const MODERATOR = "a1240000-0000-4000-8000-000000000002";
const STAFF = "c1240000-0000-4000-8000-000000000001";
const POST = "b1240000-0000-4000-8000-000000000001";
const GUARDED = "public.moderate_social_post_admin(uuid,uuid,uuid,integer,text)";
const LEGACY = "public.moderate_social_post_admin(uuid,uuid,uuid,text)";

let database: PostgresSession | null = null;

function db(): PostgresSession {
  if (!database) throw new Error("the 0124 proof cluster is not running");
  return database;
}

function value(statement: string): string {
  return db().sql(statement);
}

function guarded(revision: number | null, action = "approve"): string {
  return `select public.moderate_social_post_admin('${STAFF}', '${POST}', null, ${revision ?? "null"}, '${action}')`;
}

/** The post as a moderator would see it moved: state, status, action count. */
function postState(): string {
  return value(`select format('%s|%s|%s', post.moderation_state, post.status,
      (select count(*) from public.social_post_moderation_actions action where action.post_id = post.id))
    from public.social_posts post where post.id = '${POST}'`);
}

beforeAll(async () => {
  if (skipReason) return;
  database = await startPostgres({ label: "social-admin-revision-0124", database: "pubmax_social_admin_revision_0124" });
  database.applyFile(SESSION_FIXTURE);
  for (const path of PREREQUISITES) database.applyFile(path);
  database.sql(`
    insert into public.profiles (id, handle) values
      ('${AUTHOR}', 'revisionauthor'), ('${MODERATOR}', 'revisionmoderator');
    insert into public.private_social_staff_roles (id, profile_id, display_name, role)
      values ('${STAFF}', '${MODERATOR}', 'Moderator', 'moderator');
    insert into public.social_posts
      (id, author_profile_id, author_handle, kind, visibility, body, area_slug, comment_policy, moderation_state)
    values
      ('${POST}', '${AUTHOR}', 'revisionauthor', 'standard', 'public', 'held words', 'camden', 'open', 'pending');
    -- The classifier finished this revision and held it for a person.
    update public.social_post_moderation_jobs set state = 'done' where post_id = '${POST}';
    update public.social_posts set moderation_state = 'needs_review', revision = 3 where id = '${POST}';
    update public.social_post_moderation_jobs set revision = 3 where post_id = '${POST}';
  `);
}, 180_000);

afterAll(async () => database?.stop());

describe.skipIf(skipReason !== null)("migration 0124: Social admin moderation is bound to the reviewed revision", () => {
  it("BEFORE: there is no revision-bound overload", () => {
    expect(value(`select to_regprocedure('${GUARDED}') is null`)).toBe("t");
    expect(postState()).toBe("needs_review|visible|0");
  });

  it("AFTER: a stale or missing revision is refused and nothing moves", () => {
    db().applyFile(FORWARD);
    expect(value(asServiceRole(guarded(2)))).toBe("f");
    expect(value(asServiceRole(guarded(4)))).toBe("f");
    expect(value(asServiceRole(guarded(null)))).toBe("f");
    expect(postState()).toBe("needs_review|visible|0");
  });

  it("AFTER: the legacy overload carries no revision, so it answers false and moves nothing", () => {
    expect(value(asServiceRole(`select public.moderate_social_post_admin('${STAFF}', '${POST}', null, 'approve')`))).toBe("f");
    expect(postState()).toBe("needs_review|visible|0");
  });

  it("AFTER: no browser role can call the revision-bound overload", () => {
    for (const role of ["anon", "authenticated"] as const) {
      const sub = role === "anon" ? null : MODERATOR;
      expect(db().expectRefusal(asBrowserRole(role, sub, guarded(3)))).toMatch(/permission denied/);
    }
    expect(postState()).toBe("needs_review|visible|0");
  });

  it("AFTER: the reviewed revision is approved once, and a replay is refused", () => {
    expect(value(asServiceRole(guarded(3)))).toBe("t");
    expect(postState()).toBe("approved|visible|1");
    expect(value(asServiceRole(guarded(3, "hide")))).toBe("f");
    expect(postState()).toBe("approved|visible|1");
  });

  it("ROLLBACK: the revision-bound overload goes and the legacy one stays fail closed", () => {
    db().applyFile(ROLLBACK);
    expect(value(`select to_regprocedure('${GUARDED}') is null`)).toBe("t");
    expect(value(`select to_regprocedure('${LEGACY}') is null`)).toBe("f");
    expect(value(asServiceRole(`select public.moderate_social_post_admin('${STAFF}', '${POST}', null, 'hide')`))).toBe("f");
    expect(postState()).toBe("approved|visible|1");

    db().applyFile(ROLLBACK);
    db().applyFile(FORWARD);
    expect(value(`select to_regprocedure('${GUARDED}') is null`)).toBe("f");
  });
});
