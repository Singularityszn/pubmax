import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  postgresSkipReason,
  startPostgres,
  type PostgresSession,
} from "./helpers/postgres";

const FORWARD = join(process.cwd(), "supabase/migrations/20260806145914_0072_social_posts.sql");
const ROLLBACK = join(process.cwd(), "supabase/migrations/rollback/20260806145914_0072_social_posts_rollback.sql");

let database: PostgresSession | null = null;
const skipReason = postgresSkipReason();

beforeAll(async () => {
  database = await startPostgres({ label: "social-posts-0072" });
  database.sql(`
    create role anon noinherit;
    create role authenticated noinherit;
    create role service_role noinherit bypassrls;
    create table public.profiles(id uuid primary key, handle text not null unique);
    create table public.follows(
      id uuid primary key default gen_random_uuid(),
      follower_id uuid not null references public.profiles(id),
      followee_id uuid not null references public.profiles(id),
      unique(follower_id, followee_id)
    );
  `);
}, 180_000);

afterAll(async () => database?.stop());

describe.skipIf(skipReason !== null)("Social posts migration forward and rollback", () => {
  it("applies service-only schema with database content constraints and a durable pending job", () => {
    const db = database!;
    db.applyFile(FORWARD);
    db.sql(`insert into public.profiles(id,handle) values
      ('11111111-1111-4111-8111-111111111111','alice'),
      ('22222222-2222-4222-8222-222222222222','bob'),
      ('33333333-3333-4333-8333-333333333333','carol')`);
    expect(() => db.sql(`insert into public.social_posts(
      author_profile_id,author_handle,kind,visibility,body,venue_id,comment_policy
    ) values ('11111111-1111-4111-8111-111111111111','alice','standard','public','Here','venue-1','open')`)).toThrow();
    expect(() => db.sql(`insert into public.social_posts(
      author_profile_id,author_handle,kind,visibility,body,photo_media_id,photo_alt_text,comment_policy
    ) values ('11111111-1111-4111-8111-111111111111','alice','feature_request','friends','',gen_random_uuid(),'Sketch','open')`)).toThrow();
    const postId = db.sql(`insert into public.social_posts(
      author_profile_id,author_handle,kind,visibility,body,area_slug,hashtags,comment_policy
    ) values (
      '11111111-1111-4111-8111-111111111111','alice','standard','public','Camden night','camden',array['camden'],'open'
    ) returning id`);
    expect(db.sql(`select moderation_state from public.social_posts where id='${postId}'`)).toBe("pending");
    expect(db.sql(`select state from public.social_post_moderation_jobs where post_id='${postId}'`)).toBe("pending");
    expect(db.sql(`select moderation_claim from public.social_post_moderation_jobs where post_id='${postId}'`))
      .toBe("Camden night\n\n#camden");
    expect(db.sql("select revision from public.claim_social_post_moderation_jobs(1)")).toBe("0");
    db.sql(`update public.social_posts set
      body='Camden night edited', revision=1, moderation_state='pending'
      where id='${postId}'`);
    expect(db.sql(`select public.complete_social_post_moderation_job(
      '${postId}', 0, 'approved', null, null
    )`)).toBe("f");
    expect(db.sql(`select moderation_state || ':' || revision from public.social_posts where id='${postId}'`))
      .toBe("pending:1");
    expect(db.sql("select revision from public.claim_social_post_moderation_jobs(1)")).toBe("1");
    expect(db.sql(`select public.complete_social_post_moderation_job(
      '${postId}', 1, 'approved', null, null
    )`)).toBe("t");
    expect(db.sql(`select moderation_state from public.social_posts where id='${postId}'`)).toBe("approved");
    const heldId = db.sql(`insert into public.social_posts(
      author_profile_id,author_handle,kind,visibility,body,hashtags,comment_policy
    ) values (
      '11111111-1111-4111-8111-111111111111','alice','standard','private',
      'Held terminal',array['held'],'open'
    ) returning id`);
    db.sql("select count(*) from public.claim_social_post_moderation_jobs(1)");
    expect(db.sql(`select public.complete_social_post_moderation_job(
      '${heldId}', 0, null, 'bad_configuration', null
    )`)).toBe("t");
    expect(db.sql(`select state from public.social_post_moderation_jobs where post_id='${heldId}'`))
      .toBe("error");
    expect(db.sql(`select count(*) from public.edit_social_post(
      '${heldId}',
      '11111111-1111-4111-8111-111111111111',
      0,
      'standard',
      'private',
      'Held terminal',
      null,
      null,
      array['held'],
      'locked',
      null,
      null,
      false
    )`)).toBe("1");
    expect(db.sql(`select state || ':' || last_error_code
      from public.social_post_moderation_jobs where post_id='${heldId}'`))
      .toBe("error:bad_configuration");
    expect(db.sql("select public.requeue_social_post_moderation_errors(20)")).toBe("1");
    expect(db.sql(`select state from public.social_post_moderation_jobs where post_id='${heldId}'`))
      .toBe("pending");
    expect(db.sql(`select moderation_state from public.social_posts where id='${heldId}'`))
      .toBe("pending");
    expect(db.sql("select has_table_privilege('anon','public.social_posts','select')")).toBe("f");
    expect(db.sql("select has_table_privilege('service_role','public.social_posts','select')")).toBe("t");
  });

  it("enforces discover, nearby, following, mutual-friend, and direct visibility in SQL", () => {
    const db = database!;
    db.sql(`
      insert into public.follows(follower_id,followee_id) values
        ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111'),
        ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222');
      insert into public.social_posts(
        author_profile_id,author_handle,kind,visibility,body,area_slug,comment_policy,moderation_state
      ) values
        ('11111111-1111-4111-8111-111111111111','alice','standard','friends','friends','camden','open','approved'),
        ('11111111-1111-4111-8111-111111111111','alice','standard','private','private','camden','open','approved'),
        ('22222222-2222-4222-8222-222222222222','bob','standard','private','self-private','camden','open','approved'),
        ('33333333-3333-4333-8333-333333333333','carol','standard','public','public','shoreditch','open','approved');
    `);
    expect(db.sql(`select string_agg(body,',' order by body) from public.read_social_post_feed(
      '22222222-2222-4222-8222-222222222222','discover',null,null,null,20
    )`)).toBe("Camden night edited,public");
    expect(db.sql(`select string_agg(body,',' order by body) from public.read_social_post_feed(
      '22222222-2222-4222-8222-222222222222','following',null,null,null,20
    )`)).toBe("Camden night edited,friends");
    expect(db.sql(`select count(*) from public.read_social_post_feed(
      '22222222-2222-4222-8222-222222222222','nearby','camden',null,null,20
    )`)).toBe("1");
    expect(db.sql(`select count(*) from public.read_social_post(
      (select id from public.social_posts where body='private'),
      '22222222-2222-4222-8222-222222222222'
    )`)).toBe("0");
  });

  it("lets only one concurrent durable edit own a revision and moderation claim", async () => {
    const db = database!;
    const postId = db.sql(`insert into public.social_posts(
      author_profile_id,author_handle,kind,visibility,body,area_slug,hashtags,comment_policy,moderation_state
    ) values (
      '11111111-1111-4111-8111-111111111111','alice','standard','friends',
      'Original','camden',array['original'],'open','approved'
    ) returning id`);
    const editCall = (body: string, hashtag: string) => `
      select count(*) from public.edit_social_post(
        '${postId}', '11111111-1111-4111-8111-111111111111', 0,
        'standard', 'friends', '${body}', 'camden', null,
        array['${hashtag}'], 'open', null, null, true
      )`;

    const first = db.sqlAsync(`begin; ${editCall("First edit", "first")}; select pg_sleep(1); commit`);
    const second = db.sqlAsync(editCall("Second edit", "second"));
    const outcomes = (await Promise.all([first, second]))
      .flatMap((output) => output.split("\n").filter((line) => line === "0" || line === "1"))
      .sort();

    expect(outcomes).toEqual(["0", "1"]);
    expect(db.sql(`select revision || ':' || moderation_state from public.social_posts where id='${postId}'`))
      .toBe("1:pending");
    expect(db.sql(`select count(*) from public.social_post_moderation_jobs where post_id='${postId}' and revision=1`))
      .toBe("1");
  });

  it("rejects a stale non-content edit without changing the moderation revision", () => {
    const db = database!;
    const postId = db.sql(`insert into public.social_posts(
      author_profile_id,author_handle,kind,visibility,body,area_slug,hashtags,comment_policy,moderation_state
    ) values (
      '11111111-1111-4111-8111-111111111111','alice','standard','public',
      'Privacy first','camden',array['privacy'],'open','approved'
    ) returning id`);
    expect(db.sql(`select count(*) from public.edit_social_post(
      '${postId}', '11111111-1111-4111-8111-111111111111', 0,
      'standard', 'private', 'Privacy first', 'camden', null,
      array['privacy'], 'open', null, null, false
    )`)).toBe("1");
    expect(db.sql(`select count(*) from public.edit_social_post(
      '${postId}', '11111111-1111-4111-8111-111111111111', 0,
      'standard', 'public', 'Privacy first', 'camden', null,
      array['privacy'], 'locked', null, null, false
    )`)).toBe("0");
    expect(db.sql(`select visibility || ':' || comment_policy || ':' || revision || ':' || mutation_version
      from public.social_posts where id='${postId}'`)).toBe("private:open:0:1");
  });

  it("rolls back Task 3 state without touching the profile graph", () => {
    const db = database!;
    db.applyFile(ROLLBACK);
    expect(db.sql("select to_regclass('public.social_posts') is null")).toBe("t");
    expect(db.sql("select to_regclass('public.social_post_moderation_jobs') is null")).toBe("t");
    expect(db.sql("select count(*) from public.profiles")).toBe("3");
    expect(db.sql("select count(*) from public.follows")).toBe("2");
  });
});
