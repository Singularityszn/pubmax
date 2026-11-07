// Migration 0223, proved against a real PostgreSQL replay of every migration:
// a person can be reported (not by themselves), the admin report queue names
// the reported person, the flagged DM queue empties as a moderator reviews it,
// every suspend or reinstate writes exactly one audit row in the same
// transaction, a deleted account is never reinstated, a revoked or missing
// staff role is refused, no browser role reaches any of it, and the rollback
// applies cleanly and lets the forward file apply again.

import { join } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  asBrowserRole,
  asServiceRole,
  postgresSkipReason,
  startMigratedPostgres,
  type PostgresSession,
} from "./helpers/postgres";

const skipReason = postgresSkipReason();

const MIGRATIONS = join(process.cwd(), "supabase/migrations");
const FORWARD = join(MIGRATIONS, "20261107190000_0223_social_safety_moderation.sql");
const ROLLBACK = join(MIGRATIONS, "rollback/20261107190000_0223_social_safety_moderation_rollback.sql");

const MOD_USER = "a0000000-0000-4000-8000-000000000223";
const MOD_PROFILE = "a1000000-0000-4000-8000-000000000223";
const REPORTER_USER = "b0000000-0000-4000-8000-000000000223";
const REPORTER_PROFILE = "b1000000-0000-4000-8000-000000000223";
const REPORTER_ACCOUNT = "b2000000-0000-4000-8000-000000000223";
const TARGET_USER = "c0000000-0000-4000-8000-000000000223";
const TARGET_PROFILE = "c1000000-0000-4000-8000-000000000223";
const TARGET_ACCOUNT = "c2000000-0000-4000-8000-000000000223";
const GONE_PROFILE = "d1000000-0000-4000-8000-000000000223";
const GONE_ACCOUNT = "d2000000-0000-4000-8000-000000000223";
const STAFF = "e0000000-0000-4000-8000-000000000223";
const REVOKED_STAFF = "e1000000-0000-4000-8000-000000000223";
const REVOKED_PROFILE = "e2000000-0000-4000-8000-000000000223";
const POST = "f0000000-0000-4000-8000-000000000223";
const CONVERSATION = "f1000000-0000-4000-8000-000000000223";
const FLAGGED = "f2000000-0000-4000-8000-000000000223";
const UNFLAGGED = "f3000000-0000-4000-8000-000000000223";

let session: PostgresSession | null = null;

function db(): PostgresSession {
  if (!session) throw new Error("PostgreSQL 0223 session did not start.");
  return session;
}

function last(said: string): string {
  return said.split("\n").pop() ?? "";
}

function json(statement: string): unknown {
  return JSON.parse(last(db().sql(asServiceRole(statement))));
}

function scalar(statement: string): string {
  return last(db().sql(asServiceRole(statement)));
}

function auditRows(): number {
  return Number(last(db().sql(`select count(*) from public.social_account_moderation_audit`)));
}

function accountState(account: string): string {
  return last(db().sql(`select ownership_state from public.private_social_accounts where id='${account}'`));
}

function suspend(action: "suspend" | "reinstate", staff = STAFF, profile = TARGET_PROFILE, reason = "Threats in DMs"): Record<string, unknown> {
  return json(`select public.set_social_account_suspension_admin('${staff}','${profile}','${action}','${reason}',null)`) as Record<string, unknown>;
}

function seed(): void {
  db().sql(`
    delete from public.social_account_moderation_audit;
    delete from public.message_flag_reviews;
    delete from public.social_content_reports;
    update public.private_social_accounts set ownership_state='active' where id='${TARGET_ACCOUNT}';
    update public.messages set flagged_at=now()-interval '1 hour', flagged_by='reporter' where id='${FLAGGED}';
  `);
}

beforeAll(async () => {
  if (skipReason) return;
  session = await startMigratedPostgres({ label: "social-safety-0223", database: "pubmax_social_safety_0223" });
  session.sql(`
    insert into auth.users(id) values ('${MOD_USER}'),('${REPORTER_USER}'),('${TARGET_USER}');
    insert into public.profiles(id,user_id,handle) values
      ('${MOD_PROFILE}','${MOD_USER}','modcarol'),
      ('${REPORTER_PROFILE}','${REPORTER_USER}','reporter'),
      ('${TARGET_PROFILE}','${TARGET_USER}','targetted'),
      ('${GONE_PROFILE}',null,'goneaway'),
      ('${REVOKED_PROFILE}',null,'oldmod');
    insert into public.private_social_accounts(id,clerk_user_id,supabase_user_id,profile_id,ownership_state) values
      ('${REPORTER_ACCOUNT}','clerk-0223-reporter','${REPORTER_USER}','${REPORTER_PROFILE}','active'),
      ('${TARGET_ACCOUNT}','clerk-0223-target','${TARGET_USER}','${TARGET_PROFILE}','active'),
      ('${GONE_ACCOUNT}','clerk-0223-gone',null,'${GONE_PROFILE}','suspended');
    insert into public.private_social_staff_roles(id,profile_id,display_name,role,active,revoked_at) values
      ('${STAFF}','${MOD_PROFILE}','Carol','moderator',true,null),
      ('${REVOKED_STAFF}','${REVOKED_PROFILE}','Old mod','moderator',false,now());
    insert into public.social_posts (id, author_profile_id, author_handle, kind, visibility, body, comment_policy, moderation_state)
      values ('${POST}','${TARGET_PROFILE}','targetted','standard','public','Meet me outside, I know where you live','open','approved');
    insert into public.conversations (id, handle_a, handle_b, user_id_a, user_id_b)
      values ('${CONVERSATION}','reporter','targetted','${REPORTER_USER}','${TARGET_USER}');
    insert into public.messages (id, conversation_id, sender_handle, body) values
      ('${FLAGGED}','${CONVERSATION}','targetted','You will regret coming tonight'),
      ('${UNFLAGGED}','${CONVERSATION}','targetted','See you at eight');
  `);
}, 300_000);

beforeEach(() => {
  if (session) seed();
});

afterAll(async () => {
  await session?.stop();
});

describe.skipIf(skipReason !== null)("0223 social safety moderation applied to PostgreSQL", () => {
  it("lets a person be reported, but never by themselves, and queues it for a moderator", () => {
    db().sql(asServiceRole(
      `select id from public.report_social_content('${REPORTER_PROFILE}','profile','${TARGET_PROFILE}','harassment')`,
    ));
    expect(
      db().expectRefusal(asServiceRole(
        `select id from public.report_social_content('${TARGET_PROFILE}','profile','${TARGET_PROFILE}','harassment')`,
      )),
    ).toMatch(/content not found/);

    const queue = json(`select public.read_social_report_queue_admin('${STAFF}',20)`) as Record<string, unknown>[];
    expect(queue).toEqual([
      expect.objectContaining({
        kind: "profile",
        contentId: TARGET_PROFILE,
        reason: "harassment",
        reporterHandle: "reporter",
        targetProfileId: TARGET_PROFILE,
        targetHandle: "targetted",
        targetAccountState: "active",
        excerpt: null,
      }),
    ]);
  });

  it("names a post's author with an excerpt, and puts threats first", () => {
    db().sql(asServiceRole(`
      select id from public.report_social_content('${REPORTER_PROFILE}','profile','${TARGET_PROFILE}','spam');
      select id from public.report_social_content('${REPORTER_PROFILE}','post','${POST}','threat');
    `));
    const queue = json(`select public.read_social_report_queue_admin('${STAFF}',20)`) as Record<string, unknown>[];
    expect(queue.map((row) => [row.kind, row.reason])).toEqual([["post", "threat"], ["profile", "spam"]]);
    expect(queue[0]).toMatchObject({ targetHandle: "targetted", excerpt: "Meet me outside, I know where you live" });

    const reportId = String(queue[0]?.reportId);
    expect(scalar(`select public.resolve_social_report_admin('${STAFF}','${reportId}')`)).toBe("t");
    expect(scalar(`select public.resolve_social_report_admin('${STAFF}','${reportId}')`)).toBe("f");
    expect((json(`select public.read_social_report_queue_admin('${STAFF}',20)`) as unknown[]).length).toBe(1);
  });

  it("lists flagged DMs until a moderator reviews them", () => {
    const queue = json(`select public.read_flagged_messages_admin('${STAFF}',20)`) as Record<string, unknown>[];
    expect(queue).toEqual([
      expect.objectContaining({
        messageId: FLAGGED,
        body: "You will regret coming tonight",
        senderHandle: "targetted",
        senderProfileId: TARGET_PROFILE,
        senderAccountState: "active",
        flaggedBy: "reporter",
      }),
    ]);
    expect(scalar(`select public.review_flagged_message_admin('${STAFF}','${FLAGGED}')`)).toBe("t");
    expect(scalar(`select public.review_flagged_message_admin('${STAFF}','${FLAGGED}')`)).toBe("f");
    expect(scalar(`select public.review_flagged_message_admin('${STAFF}','${UNFLAGGED}')`)).toBe("f");
    expect(json(`select public.read_flagged_messages_admin('${STAFF}',20)`)).toEqual([]);
  });

  it("writes exactly one audit row for every suspend and reinstate, and none for a no-op", () => {
    expect(suspend("suspend")).toMatchObject({ ok: true, code: "suspended", state: "suspended" });
    expect(accountState(TARGET_ACCOUNT)).toBe("suspended");
    expect(auditRows()).toBe(1);

    expect(suspend("suspend")).toMatchObject({ ok: true, code: "unchanged" });
    expect(auditRows()).toBe(1);

    expect(suspend("reinstate", STAFF, TARGET_PROFILE, "Appeal upheld")).toMatchObject({ ok: true, code: "reinstated" });
    expect(accountState(TARGET_ACCOUNT)).toBe("active");
    expect(auditRows()).toBe(2);

    const rows = last(db().sql(`select string_agg(action || ':' || profile_handle || ':' || staff_display_name || ':' || reason, ',' order by created_at) from public.social_account_moderation_audit`));
    expect(rows).toBe("suspend:targetted:Carol:Threats in DMs,reinstate:targetted:Carol:Appeal upheld");
  });

  it("refuses a short reason, an unknown person and a deleted account, and writes nothing", () => {
    expect(suspend("suspend", STAFF, TARGET_PROFILE, "x")).toMatchObject({ ok: false, code: "invalid" });
    expect(suspend("suspend", STAFF, POST)).toMatchObject({ ok: false, code: "not_found" });
    expect(suspend("reinstate", STAFF, GONE_PROFILE)).toMatchObject({ ok: false, code: "gone" });
    expect(accountState(GONE_ACCOUNT)).toBe("suspended");
    expect(accountState(TARGET_ACCOUNT)).toBe("active");
    expect(auditRows()).toBe(0);
  });

  it("refuses a revoked or unknown staff role at every admin function", () => {
    for (const staff of [REVOKED_STAFF, POST]) {
      for (const call of [
        `select public.read_social_report_queue_admin('${staff}',20)`,
        `select public.read_flagged_messages_admin('${staff}',20)`,
        `select public.review_flagged_message_admin('${staff}','${FLAGGED}')`,
        `select public.resolve_social_report_admin('${staff}','${POST}')`,
        `select public.set_social_account_suspension_admin('${staff}','${TARGET_PROFILE}','suspend','Threats in DMs',null)`,
      ]) {
        expect(db().expectRefusal(asServiceRole(call))).toMatch(/staff required/);
      }
    }
    expect(accountState(TARGET_ACCOUNT)).toBe("active");
    expect(auditRows()).toBe(0);
  });

  it("keeps every browser role out of the functions and the two new tables", () => {
    for (const role of ["anon", "authenticated"] as const) {
      const sub = role === "anon" ? null : TARGET_USER;
      for (const statement of [
        `select public.read_social_report_queue_admin('${STAFF}',20)`,
        `select public.read_flagged_messages_admin('${STAFF}',20)`,
        `select public.set_social_account_suspension_admin('${STAFF}','${REPORTER_PROFILE}','suspend','Threats in DMs',null)`,
        `select count(*) from public.social_account_moderation_audit`,
        `select count(*) from public.message_flag_reviews`,
        `insert into public.message_flag_reviews(message_id) values ('${FLAGGED}')`,
      ]) {
        expect(db().expectRefusal(asBrowserRole(role, sub, statement))).toMatch(/permission denied/i);
      }
    }
    expect(accountState(REPORTER_ACCOUNT)).toBe("active");
  });

  it("keeps the audit ledger append-only, even for the service role", () => {
    suspend("suspend");
    expect(
      db().expectRefusal(asServiceRole(`delete from public.social_account_moderation_audit`)),
    ).toMatch(/permission denied/i);
    expect(
      db().expectRefusal(asServiceRole(`update public.social_account_moderation_audit set reason='edited'`)),
    ).toMatch(/permission denied/i);
    expect(auditRows()).toBe(1);
  });

  it("rolls back to the 0073 report kinds, and the forward file applies again", () => {
    db().sql(asServiceRole(
      `select id from public.report_social_content('${REPORTER_PROFILE}','profile','${TARGET_PROFILE}','harassment')`,
    ));
    db().applyFile(ROLLBACK);
    expect(last(db().sql(`select count(*) from public.social_content_reports where content_kind='profile'`))).toBe("0");
    expect(
      db().expectRefusal(asServiceRole(
        `select id from public.report_social_content('${REPORTER_PROFILE}','profile','${TARGET_PROFILE}','harassment')`,
      )),
    ).toMatch(/content not found/);
    expect(last(db().sql(`select count(*) from pg_proc where proname='set_social_account_suspension_admin'`))).toBe("0");
    db().applyFile(FORWARD);
    expect(suspend("suspend")).toMatchObject({ ok: true, code: "suspended" });
  });
});
