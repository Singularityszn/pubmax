// Migration 0224, proved against a real PostgreSQL replay of every migration:
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
const FORWARD = join(MIGRATIONS, "20261107220000_0224_social_safety_moderation.sql");
const ROLLBACK = join(MIGRATIONS, "rollback/20261107220000_0224_social_safety_moderation_rollback.sql");

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
const LEGACY_USER = "d0000000-0000-4000-8000-000000000224";
const LEGACY_PROFILE = "d1000000-0000-4000-8000-000000000224";
const LEGACY_CONVERSATION = "d3000000-0000-4000-8000-000000000224";
const LEGACY_MESSAGE = "d2000000-0000-4000-8000-000000000224";
const UNFLAGGED = "f3000000-0000-4000-8000-000000000223";
const PHOTO_POST = "f4000000-0000-4000-8000-000000000224";
const MEDIA = "f5000000-0000-4000-8000-000000000224";
const COMMENT = "fc000000-0000-4000-8000-000000000224";
const OTHER_COMMENT = "fc100000-0000-4000-8000-000000000224";
const QUOTE = "fd000000-0000-4000-8000-000000000224";
const OTHER_QUOTE = "fd100000-0000-4000-8000-000000000224";
const REPORTED_TEXT = "An ordinary introduction. ".repeat(15) + "The threat after the excerpt.";
const GENERATION = "f6000000-0000-4000-8000-000000000224";
const VIDEO_UPLOAD = "f7000000-0000-4000-8000-000000000224";
const PHOTO_KEY = `social/${MEDIA}/${GENERATION}/image.jpg`;
const VIDEO_KEY = `social-video/${VIDEO_UPLOAD}/video.mp4`;

let session: PostgresSession | null = null;

function db(): PostgresSession {
  if (!session) throw new Error("PostgreSQL 0224 session did not start.");
  return session;
}

function last(said: string): string {
  return said.split("\n").pop() ?? "";
}

function json(statement: string): unknown {
  return JSON.parse(last(db().sql(asServiceRole(statement))) || "null");
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
    delete from public.message_flag_evidence_audit;
    delete from public.social_report_evidence_audit;
    delete from public.messages where id='${LEGACY_MESSAGE}';
    delete from public.social_account_moderation_audit;
    delete from public.private_social_accounts where profile_id='${LEGACY_PROFILE}';
    delete from public.message_flag_reviews;
    delete from public.social_content_reports;
    update public.private_social_accounts set ownership_state='active' where id='${TARGET_ACCOUNT}';
    update public.messages set flagged_at=null, flagged_by=null where id='${UNFLAGGED}';
    update public.messages set flagged_at=now()-interval '1 hour', flagged_by='reporter' where id='${FLAGGED}';
    update public.social_posts set body='' where id='${PHOTO_POST}';
  `);
}

beforeAll(async () => {
  if (skipReason) return;
  session = await startMigratedPostgres({ label: "social-safety-0224", database: "pubmax_social_safety_0224" });
  session.sql(`
    insert into auth.users(id) values ('${MOD_USER}'),('${REPORTER_USER}'),('${TARGET_USER}'),('${LEGACY_USER}');
    insert into public.profiles(id,user_id,handle) values
      ('${MOD_PROFILE}','${MOD_USER}','modcarol'),
      ('${REPORTER_PROFILE}','${REPORTER_USER}','reporter'),
      ('${TARGET_PROFILE}','${TARGET_USER}','targetted'),
      ('${GONE_PROFILE}',null,'goneaway'),
      ('${LEGACY_PROFILE}','${LEGACY_USER}','returning'),
      ('${REVOKED_PROFILE}',null,'oldmod');
    insert into public.private_social_accounts(id,clerk_user_id,supabase_user_id,profile_id,ownership_state) values
      ('${REPORTER_ACCOUNT}','clerk-0224-reporter','${REPORTER_USER}','${REPORTER_PROFILE}','active'),
      ('${TARGET_ACCOUNT}','clerk-0224-target','${TARGET_USER}','${TARGET_PROFILE}','active'),
      ('${GONE_ACCOUNT}','clerk-0224-gone',null,'${GONE_PROFILE}','suspended');
    insert into public.private_social_staff_roles(id,profile_id,display_name,role,active,revoked_at) values
      ('${STAFF}','${MOD_PROFILE}','Carol','moderator',true,null),
      ('${REVOKED_STAFF}','${REVOKED_PROFILE}','Old mod','moderator',false,now());
    insert into public.social_posts (id, author_profile_id, author_handle, kind, visibility, body, comment_policy, moderation_state, moderated_at)
      values ('${POST}','${TARGET_PROFILE}','targetted','standard','public','Meet me outside, I know where you live','open','approved',now());
    insert into public.social_post_media(id,generation,owner_profile_id,object_key,sha256,width,height,byte_size,moderation_state)
      values ('${MEDIA}','${GENERATION}','${TARGET_PROFILE}','${PHOTO_KEY}',repeat('a',64),800,1000,100,'approved');
    insert into public.social_posts(id,author_profile_id,author_handle,kind,visibility,body,comment_policy,moderation_state,photo_media_id,photo_alt_text,moderated_at)
      values ('${PHOTO_POST}','${TARGET_PROFILE}','targetted','standard','friends','','open','approved','${MEDIA}','Reported photo',now());
    insert into public.follows(follower_id,followee_id) values
      ('${REPORTER_PROFILE}','${TARGET_PROFILE}'),('${TARGET_PROFILE}','${REPORTER_PROFILE}');
    insert into public.social_video_uploads(id,owner_profile_id,object_key,content_type,declared_bytes,claimed_post_id)
      values ('${VIDEO_UPLOAD}','${TARGET_PROFILE}','${VIDEO_KEY}','video/mp4',100,'${PHOTO_POST}');
    insert into public.social_post_videos(post_id,author_profile_id,upload_id,object_key,content_type,byte_size,review_state,reviewed_at)
      values ('${PHOTO_POST}','${TARGET_PROFILE}','${VIDEO_UPLOAD}','${VIDEO_KEY}','video/mp4',100,'approved',now());
    insert into public.social_comments(id,post_id,author_profile_id,author_handle,body,moderation_state,idempotency_key_hash,payload_digest) values
      ('${COMMENT}','${PHOTO_POST}','${TARGET_PROFILE}','targetted','${REPORTED_TEXT}','approved',repeat('c',64),repeat('c',64)),
      ('${OTHER_COMMENT}','${PHOTO_POST}','${TARGET_PROFILE}','targetted','Unreported comment','approved',repeat('d',64),repeat('d',64));
    insert into public.social_quotes(id,source_post_id,author_profile_id,author_handle,body,visibility,moderation_state,idempotency_key_hash,payload_digest) values
      ('${QUOTE}','${PHOTO_POST}','${TARGET_PROFILE}','targetted','${REPORTED_TEXT}','friends','approved',repeat('e',64),repeat('e',64)),
      ('${OTHER_QUOTE}','${PHOTO_POST}','${TARGET_PROFILE}','targetted','Unreported quote','friends','approved',repeat('f',64),repeat('f',64));
    insert into public.conversations (id, handle_a, handle_b, user_id_a, user_id_b)
      values ('${CONVERSATION}','reporter','targetted','${REPORTER_USER}','${TARGET_USER}'),
      ('${LEGACY_CONVERSATION}','reporter','returning','${REPORTER_USER}','${LEGACY_USER}');
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

describe.skipIf(skipReason !== null)("0224 social safety moderation applied to PostgreSQL", () => {
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
    db().sql(asServiceRole(`select id from public.report_social_content('${REPORTER_PROFILE}','post','${POST}','threat')`));
    expect((json(`select public.read_social_report_queue_admin('${STAFF}',20)`) as unknown[]).length).toBe(1);
  });

  it("reopens a resolved person report and keeps queued repeats deduplicated", () => {
    const submit = `select id from public.report_social_content('${REPORTER_PROFILE}','profile','${TARGET_PROFILE}','harassment')`;
    const reportId = scalar(submit);
    expect(scalar(submit)).toBe(reportId);
    db().sql(`update public.social_content_reports set state='reviewing' where id='${reportId}'`);
    expect(scalar(submit)).toBe(reportId);
    expect(json(`select public.read_social_report_queue_admin('${STAFF}',20)`)).toEqual([
      expect.objectContaining({ reportId, state: "reviewing" }),
    ]);
    expect(scalar(`select public.resolve_social_report_admin('${STAFF}','${reportId}')`)).toBe("t");
    expect(json(`select public.read_social_report_queue_admin('${STAFF}',20)`)).toEqual([]);
    expect(db().sql(`select resolved_at is not null and resolved_by_staff_role_id = '${STAFF}'
      from public.social_content_reports where id='${reportId}'`)).toBe("t");
    expect(scalar(submit)).toBe(reportId);
    expect(db().sql(`select resolved_at is null and resolved_by_staff_role_id is null
      from public.social_content_reports where id='${reportId}'`)).toBe("t");
    expect(scalar(submit)).toBe(reportId);
    expect(json(`select public.read_social_report_queue_admin('${STAFF}',20)`)).toEqual([
      expect.objectContaining({ reportId, kind: "profile", state: "queued", contentId: TARGET_PROFILE, reason: "harassment" }),
    ]);
  });

  it("reads only the open report's private post, including full text and its media, and audits each view", () => {
    const reportId = scalar(`select id from public.report_social_content('${REPORTER_PROFILE}','post','${PHOTO_POST}','harassment')`);
    const call = `select public.read_reported_content_evidence_admin('${STAFF}','${reportId}')`;
    const media = [{ kind: "photo", objectKey: PHOTO_KEY }, { kind: "video", objectKey: VIDEO_KEY }];
    expect(json(call)).toEqual({ reportId, kind: "post", contentId: PHOTO_POST, body: "", media });
    db().sql(`update public.social_posts set body=repeat('Reported full text. ',40) where id='${PHOTO_POST}'`);
    expect(json(call)).toEqual({ reportId, kind: "post", contentId: PHOTO_POST, body: "Reported full text. ".repeat(40), media });
    const rows = json(`select jsonb_agg(jsonb_build_object('report',report_id,'kind',content_kind,'content',content_id,'staff',staff_role_id,'name',staff_display_name,'timed',viewed_at is not null)) from public.social_report_evidence_audit`);
    expect(rows).toEqual(Array.from({ length: 2 }, () => ({ report: reportId, kind: "post", content: PHOTO_POST, staff: STAFF, name: "Carol", timed: true })));
    expect(json(`select public.read_reported_content_evidence_admin('${STAFF}','${POST}')`)).toBeNull();
    expect(json(`select public.read_reported_content_evidence_admin('${STAFF}','${PHOTO_POST}')`)).toBeNull();
    const personReport = scalar(`select id from public.report_social_content('${REPORTER_PROFILE}','profile','${TARGET_PROFILE}','harassment')`);
    expect(json(`select public.read_reported_content_evidence_admin('${STAFF}','${personReport}')`)).toBeNull();
    db().sql(`update public.social_content_reports set state='reviewing' where id='${reportId}'`);
    expect(json(call)).toMatchObject({ reportId, kind: "post", contentId: PHOTO_POST });
    scalar(`select public.resolve_social_report_admin('${STAFF}','${reportId}')`);
    expect(json(call)).toBeNull();
    expect(scalar(`select count(*) from public.social_report_evidence_audit`)).toBe("3");
  });

  it.each([
    ["comment", COMMENT, OTHER_COMMENT],
    ["quote", QUOTE, OTHER_QUOTE],
  ] as const)("returns only the reported %s in full and audits every view", (kind, contentId, otherId) => {
    const reportId = scalar(`select id from public.report_social_content('${REPORTER_PROFILE}','${kind}','${contentId}','threat')`);
    const call = `select public.read_reported_content_evidence_admin('${STAFF}','${reportId}')`;
    const queue = json(`select public.read_social_report_queue_admin('${STAFF}',20)`) as Record<string, unknown>[];
    expect(queue[0]?.excerpt).not.toContain("The threat after the excerpt.");
    for (let view = 1; view <= 2; view += 1) {
      expect(json(call)).toEqual({ reportId, kind, contentId, body: REPORTED_TEXT, media: [] });
      expect(json(`select jsonb_agg(jsonb_build_object('reportId',report_id,'kind',content_kind,
        'contentId',content_id,'staff',staff_role_id,'name',staff_display_name,'timed',viewed_at is not null))
        from public.social_report_evidence_audit`)).toEqual(Array.from({ length: view }, () => ({
        reportId, kind, contentId, staff: STAFF, name: "Carol", timed: true,
      })));
    }
    for (const id of [contentId, otherId, PHOTO_POST]) {
      expect(json(`select public.read_reported_content_evidence_admin('${STAFF}','${id}')`)).toBeNull();
    }
    db().sql(`update public.private_social_staff_roles set role='product_staff' where id='${STAFF}'`);
    try {
      expect(db().expectRefusal(asServiceRole(call))).toMatch(/staff required/);
    } finally {
      db().sql(`update public.private_social_staff_roles set role='moderator' where id='${STAFF}'`);
    }
    for (const role of ["anon", "authenticated"] as const) {
      expect(db().expectRefusal(asBrowserRole(role, role === "anon" ? null : TARGET_USER, call))).toMatch(/permission denied/i);
    }
    db().sql(`update public.social_content_reports set state='reviewing' where id='${reportId}'`);
    expect(json(call)).toEqual({ reportId, kind, contentId, body: REPORTED_TEXT, media: [] });
    scalar(`select public.resolve_social_report_admin('${STAFF}','${reportId}')`);
    expect(json(call)).toBeNull();
    expect(scalar(`select count(*) from public.social_report_evidence_audit`)).toBe("3");
  });

  it("returns all reported carousel photos in slot order without another post's photos", () => {
    const second = "f8000000-0000-4000-8000-000000000224";
    const third = "f9000000-0000-4000-8000-000000000224";
    const fourth = "fa000000-0000-4000-8000-000000000224";
    const unrelated = "fb000000-0000-4000-8000-000000000224";
    db().sql(`insert into public.social_post_extra_photos
      (media_id,post_id,owner_profile_id,position,object_key,sha256,width,height,byte_size,alt_text,moderation_state) values
      ('${fourth}','${PHOTO_POST}','${TARGET_PROFILE}',4,'social-extra/${fourth}/image.jpg',repeat('b',64),800,1000,100,'Fourth','needs_review'),
      ('${third}','${PHOTO_POST}','${TARGET_PROFILE}',3,'social-extra/${third}/image.jpg',repeat('c',64),800,1000,100,'Third','pending'),
      ('${second}','${PHOTO_POST}','${TARGET_PROFILE}',2,'social-extra/${second}/image.jpg',repeat('d',64),800,1000,100,'Second','approved'),
      ('${unrelated}','${POST}','${TARGET_PROFILE}',2,'social-extra/${unrelated}/image.jpg',repeat('e',64),800,1000,100,'Unreported','approved')`);
    try {
      const reportId = scalar(`select id from public.report_social_content('${REPORTER_PROFILE}','post','${PHOTO_POST}','harassment')`);
      expect(json(`select public.read_reported_content_evidence_admin('${STAFF}','${reportId}')`)).toEqual({
        reportId, kind: "post", contentId: PHOTO_POST, body: "", media: [
          { kind: "photo", objectKey: PHOTO_KEY },
          { kind: "photo", objectKey: `social-extra/${second}/image.jpg` },
          { kind: "photo", objectKey: `social-extra/${third}/image.jpg` },
          { kind: "photo", objectKey: `social-extra/${fourth}/image.jpg` },
          { kind: "video", objectKey: VIDEO_KEY },
        ],
      });
      expect(json(`select public.read_reported_content_evidence_admin('${STAFF}','${POST}')`)).toBeNull();
      expect(json(`select public.read_reported_content_evidence_admin('${STAFF}','${unrelated}')`)).toBeNull();
      expect(scalar(`select count(*) from public.social_report_evidence_audit where report_id='${reportId}' and content_kind='post' and content_id='${PHOTO_POST}' and staff_role_id='${STAFF}'`)).toBe("1");
    } finally {
      db().sql(`delete from public.social_post_extra_photos where media_id in ('${second}','${third}','${fourth}','${unrelated}')`);
    }
  });

  it.each([["post", POST], ["comment", COMMENT], ["quote", QUOTE]] as const)(
    "refuses a reported %s read when its audit cannot be written", (kind, contentId) => {
      const reportId = scalar(`select id from public.report_social_content('${REPORTER_PROFILE}','${kind}','${contentId}','harassment')`);
      db().sql(`create function public.reject_report_evidence_audit() returns trigger language plpgsql as $$
        begin raise exception 'audit unavailable'; end; $$;
        create trigger reject_report_evidence_audit before insert on public.social_report_evidence_audit
        for each row execute function public.reject_report_evidence_audit();`);
      try {
        expect(db().expectRefusal(asServiceRole(`select public.read_reported_content_evidence_admin('${STAFF}','${reportId}')`))).toMatch(/audit unavailable/);
        expect(scalar(`select count(*) from public.social_report_evidence_audit`)).toBe("0");
      } finally {
        db().sql(`drop trigger reject_report_evidence_audit on public.social_report_evidence_audit; drop function public.reject_report_evidence_audit()`);
      }
    },
  );

  it("denies browser reads and mutations even if the evidence audit table is granted", () => {
    const reportId = scalar(`select id from public.report_social_content('${REPORTER_PROFILE}','post','${POST}','harassment')`);
    json(`select public.read_reported_content_evidence_admin('${STAFF}','${reportId}')`);
    for (const role of ["anon", "authenticated"] as const) {
      expect(last(db().sql(`begin; grant select on public.social_report_evidence_audit to ${role};
        set role ${role}; select count(*) from public.social_report_evidence_audit; rollback;`))).toBe("0");
      expect(db().expectRefusal(`begin; grant insert on public.social_report_evidence_audit to ${role};
        set role ${role}; insert into public.social_report_evidence_audit(report_id,content_kind,content_id,staff_role_id,staff_display_name)
        values ('${reportId}','post','${POST}','${STAFF}','forged'); rollback;`)).toMatch(/row-level security/i);
    }
    expect(scalar(`select count(*) from public.social_report_evidence_audit`)).toBe("1");
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

  it("provisions a linked sender as suspended with one audit and preserves suspension on later provisioning", () => {
    db().sql(`insert into public.messages(id,conversation_id,sender_handle,body,flagged_at)
      values ('${LEGACY_MESSAGE}','${LEGACY_CONVERSATION}','returning','Threat',now())`);
    expect(json(`select public.read_flagged_messages_admin('${STAFF}',20)`)).toEqual(expect.arrayContaining([
      expect.objectContaining({ messageId: LEGACY_MESSAGE, senderProfileId: LEGACY_PROFILE, senderAccountState: null }),
    ]));
    expect(suspend("suspend", STAFF, LEGACY_PROFILE)).toMatchObject({ code: "suspended", state: "suspended" });
    expect(json(`select to_jsonb(a) from public.private_social_accounts a where profile_id='${LEGACY_PROFILE}'`)).toMatchObject({
      profile_id: LEGACY_PROFILE, supabase_user_id: LEGACY_USER, clerk_user_id: `supabase:${LEGACY_USER}`, ownership_state: "suspended",
    });
    expect(auditRows()).toBe(1);
    expect(suspend("suspend", STAFF, LEGACY_PROFILE)).toMatchObject({ code: "unchanged" });
    scalar(`select public.provision_social_product_account('${LEGACY_USER}')`);
    expect(scalar(`select ownership_state from public.private_social_accounts where profile_id='${LEGACY_PROFILE}'`)).toBe("suspended");
    expect(auditRows()).toBe(1);
    expect(suspend("reinstate", STAFF, LEGACY_PROFILE)).toMatchObject({ code: "reinstated" });
    expect(auditRows()).toBe(2);
  });

  it("serializes new-account suspension with ordinary provisioning", async () => {
    await db().concurrent([
      asServiceRole(`select public.set_social_account_suspension_admin('${STAFF}','${LEGACY_PROFILE}','suspend','Threats in DMs',null)`),
      asServiceRole(`select public.set_social_account_suspension_admin('${STAFF}','${LEGACY_PROFILE}','suspend','Threats in DMs',null)`),
      asServiceRole(`select public.provision_social_product_account('${LEGACY_USER}')`),
    ]);
    expect(scalar(`select ownership_state from public.private_social_accounts where profile_id='${LEGACY_PROFILE}'`)).toBe("suspended");
    expect(auditRows()).toBe(1);
  });

  it("rolls back suspension provisioning if its audit cannot be written", () => {
    db().sql(`create function public.reject_0224_audit() returns trigger language plpgsql as $$
      begin raise exception 'audit unavailable'; end; $$;
      create trigger reject_0224_audit before insert on public.social_account_moderation_audit
        for each row execute function public.reject_0224_audit();`);
    try {
      expect(db().expectRefusal(asServiceRole(`select public.set_social_account_suspension_admin(
        '${STAFF}','${LEGACY_PROFILE}','suspend','Threats in DMs',null)`))).toMatch(/audit unavailable/);
      expect(scalar(`select count(*) from public.private_social_accounts where profile_id='${LEGACY_PROFILE}'`)).toBe("0");
    } finally {
      db().sql(`drop trigger reject_0224_audit on public.social_account_moderation_audit; drop function public.reject_0224_audit()`);
    }
  });

  it("returns only a flagged attachment and audits every evidence read", () => {
    db().sql(`update public.messages set body='', attachment_kind='photo',
      attachment_object_key='messages/${CONVERSATION}/${FLAGGED}.jpg', attachment_width=800, attachment_height=1000
      where id='${FLAGGED}'`);
    try {
      const call = `select public.read_flagged_message_evidence_admin('${STAFF}','${FLAGGED}')`;
      for (let view = 1; view <= 2; view += 1) {
        expect(json(call)).toEqual({ kind: "photo", conversationId: CONVERSATION, messageId: FLAGGED,
          objectKey: `messages/${CONVERSATION}/${FLAGGED}.jpg` });
        expect(scalar(`select count(*) from public.message_flag_evidence_audit where message_id='${FLAGGED}' and staff_role_id='${STAFF}'`)).toBe(String(view));
      }
      expect(json(`select public.read_flagged_message_evidence_admin('${STAFF}','${UNFLAGGED}')`)).toBeNull();
      expect(json(`select public.read_flagged_message_evidence_admin('${STAFF}','${POST}')`)).toBeNull();
      expect(scalar(`select count(*) from public.message_flag_evidence_audit`)).toBe("2");
      db().sql(`update public.messages set flagged_at=null where id='${FLAGGED}'`);
      expect(json(call)).toBeNull();
      expect(scalar(`select count(*) from public.message_flag_evidence_audit`)).toBe("2");
    } finally {
      db().sql(`update public.messages set body='You will regret coming tonight', attachment_kind=null,
        attachment_object_key=null, attachment_width=null, attachment_height=null where id='${FLAGGED}'`);
    }
  });

  it("refuses an unflagged photo without writing an evidence audit", () => {
    db().sql(`update public.messages set body='', attachment_kind='photo',
      attachment_object_key='messages/${CONVERSATION}/${UNFLAGGED}.jpg', attachment_width=800, attachment_height=1000
      where id='${UNFLAGGED}'`);
    try {
      expect(json(`select public.read_flagged_message_evidence_admin('${STAFF}','${UNFLAGGED}')`)).toBeNull();
      expect(scalar(`select count(*) from public.message_flag_evidence_audit`)).toBe("0");
    } finally {
      db().sql(`update public.messages set body='See you at eight', attachment_kind=null,
        attachment_object_key=null, attachment_width=null, attachment_height=null where id='${UNFLAGGED}'`);
    }
  });

  it("returns a flagged poll ballot without votes or other messages", () => {
    db().sql(`update public.messages set body='', attachment_kind='poll',
      attachment_poll_question='Who should we threaten?', attachment_poll_options='["Alice","Bob"]'
      where id='${FLAGGED}'`);
    try {
      expect(json(`select public.read_flagged_message_evidence_admin('${STAFF}','${FLAGGED}')`)).toEqual({
        kind: "poll", question: "Who should we threaten?", options: ["Alice", "Bob"],
      });
      expect(scalar(`select count(*) from public.message_flag_evidence_audit`)).toBe("1");
    } finally {
      db().sql(`update public.messages set body='You will regret coming tonight', attachment_kind=null,
        attachment_poll_question=null, attachment_poll_options=null where id='${FLAGGED}'`);
    }
  });

  it.each([
    ["venue", "attachment_venue_id", "pub-1", { kind: "venue", venueId: "pub-1" }],
    ["contact", "attachment_contact_handle", "alice", { kind: "contact", handle: "alice" }],
    ["event", "attachment_plan_id", CONVERSATION, { kind: "event", planId: CONVERSATION }],
  ])("returns only the reported %s reference", (kind, column, value, expected) => {
    db().sql(`update public.messages set body='', attachment_kind='${kind}', ${column}='${value}' where id='${FLAGGED}'`);
    try {
      expect(json(`select public.read_flagged_message_evidence_admin('${STAFF}','${FLAGGED}')`)).toEqual(expected);
      expect(scalar(`select count(*) from public.message_flag_evidence_audit`)).toBe("1");
    } finally {
      db().sql(`update public.messages set body='You will regret coming tonight', attachment_kind=null, ${column}=null where id='${FLAGGED}'`);
    }
  });

  it("refuses evidence access for active non-moderator staff", () => {
    db().sql(`update public.private_social_staff_roles set role='product_staff' where id='${STAFF}'`);
    try {
      expect(db().expectRefusal(asServiceRole(`select public.read_flagged_message_evidence_admin('${STAFF}','${FLAGGED}')`))).toMatch(/staff required/);
      expect(db().expectRefusal(asServiceRole(`select public.read_reported_content_evidence_admin('${STAFF}','${POST}')`))).toMatch(/staff required/);
      expect(scalar(`select count(*) from public.message_flag_evidence_audit`)).toBe("0");
      expect(scalar(`select count(*) from public.social_report_evidence_audit`)).toBe("0");
    } finally {
      db().sql(`update public.private_social_staff_roles set role='moderator' where id='${STAFF}'`);
    }
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
        `select public.read_flagged_message_evidence_admin('${staff}','${FLAGGED}')`,
        `select public.read_reported_content_evidence_admin('${staff}','${POST}')`,
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

  it("keeps every browser role out of the functions and the private moderation tables", () => {
    for (const role of ["anon", "authenticated"] as const) {
      const sub = role === "anon" ? null : TARGET_USER;
      for (const statement of [
        `select public.read_social_report_queue_admin('${STAFF}',20)`,
        `select public.read_flagged_messages_admin('${STAFF}',20)`,
        `select public.read_flagged_message_evidence_admin('${STAFF}','${FLAGGED}')`,
        `select public.read_reported_content_evidence_admin('${STAFF}','${POST}')`,
        `select count(*) from public.social_report_evidence_audit`,
        `select count(*) from public.message_flag_evidence_audit`,
        `select public.set_social_account_suspension_admin('${STAFF}','${REPORTER_PROFILE}','suspend','Threats in DMs',null)`,
        `select count(*) from public.social_account_moderation_audit`,
        `select count(*) from public.message_flag_reviews`,
        `insert into public.message_flag_reviews(message_id) values ('${FLAGGED}')`,
      ]) {
        expect(db().expectRefusal(asBrowserRole(role, sub, statement))).toMatch(/permission denied/i);
      }
    }
    expect(accountState(REPORTER_ACCOUNT)).toBe("active");
    db().sql(`insert into public.message_flag_evidence_audit(message_id,staff_role_id,staff_display_name,attachment_kind)
      values ('${FLAGGED}','${STAFF}','Carol','photo')`);
    expect(last(db().sql(`begin; grant select on public.message_flag_evidence_audit to authenticated;
      set role authenticated; select count(*) from public.message_flag_evidence_audit; rollback;`))).toBe("0");
    expect(last(db().sql(`select relrowsecurity from pg_class where oid='public.message_flag_evidence_audit'::regclass`))).toBe("t");
    expect(last(db().sql(`select count(*) from pg_policy where polrelid='public.message_flag_evidence_audit'::regclass`))).toBe("0");
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
    expect(db().expectRefusal(asServiceRole(`delete from public.message_flag_evidence_audit`))).toMatch(/permission denied/i);
    expect(db().expectRefusal(asServiceRole(`update public.message_flag_evidence_audit set staff_display_name='edited'`))).toMatch(/permission denied/i);
    expect(db().expectRefusal(asServiceRole(`delete from public.social_report_evidence_audit`))).toMatch(/permission denied/i);
    expect(db().expectRefusal(asServiceRole(`update public.social_report_evidence_audit set staff_display_name='edited'`))).toMatch(/permission denied/i);
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
    expect(last(db().sql(`select count(*) from pg_proc where proname='read_reported_content_evidence_admin'`))).toBe("0");
    expect(last(db().sql(`select to_regclass('public.social_report_evidence_audit') is null`))).toBe("t");
    db().applyFile(FORWARD);
    expect(suspend("suspend")).toMatchObject({ ok: true, code: "suspended" });
  });
});
