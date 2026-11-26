import { readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { postgresSkipReason, startPostgres, type PostgresSession } from "./helpers/postgres";

const migrations = join(process.cwd(), "supabase/migrations");
const forward = "20261125190000_0274_crawl_atomic_save.sql";
let database: PostgresSession | null = null;
function db(): PostgresSession {
  if (!database) throw new Error("PostgreSQL session unavailable");
  return database;
}
const user = "26700000-0000-4000-8000-000000000001";
const storyId = "26700000-0000-4000-8000-000000000002";
const requestKey = "26700000-0000-4000-8000-000000000003";
const stopId = "26700000-0000-4000-8000-000000000004";
const story = `jsonb_build_object('id','${storyId}','title','Test route','slug','test-route','summary','','visibility','public','created_at',now(),'updated_at',now(),'save_key','${requestKey}','save_hash','hash')`;

beforeAll(async () => {
  database = await startPostgres({ label: "crawl-atomic-save-0274" });
  database.applyFile(join(process.cwd(), "scripts/rls/session-fixture.sql"));
  for (const name of readdirSync(migrations).filter((name) => name.endsWith(".sql") && name < forward).sort()) {
    database.applyFile(join(migrations, name));
    if (name === "20260729120000_0061_contributor_identity.sql") {
      database.sql(`
        insert into auth.users(id) values ('26700000-0000-4000-8000-000000000022');
        insert into public.profiles(id, handle) values ('26700000-0000-4000-8000-000000000023', 'legacy_alias');
        insert into public.profile_handle_aliases(profile_id, handle, is_current)
          values ('26700000-0000-4000-8000-000000000023', 'legacy_alias', true);
        insert into public.crawl_stories(title, slug, visibility, author_handle)
          values ('Before account link', 'unlinked-profile-route', 'public', 'legacy_alias');
        select public.claim_pubmaxx_handle('26700000-0000-4000-8000-000000000022', 'legacy_alias');
      `);
    }
  }
  database.sql(`insert into auth.users(id) values ('${user}'); select public.claim_pubmaxx_handle('${user}', 'crawl_old');`);
  database.sql(`insert into public.crawl_stories(title, slug, visibility, author_handle) values ('Old route','old-route','public','crawl_old');`);
  database.sql("insert into public.crawl_stories(title, slug, visibility, author_handle) values ('Unknown','unknown-route','public','never_claimed')");
  database.sql("insert into public.crawl_stories(title, slug, visibility, author_handle, created_at) values ('Before claim','preclaim-route','public','future_owner','2020-01-01T00:00:00Z')");
  database.sql("insert into auth.users(id) values ('26700000-0000-4000-8000-000000000021'); select public.claim_pubmaxx_handle('26700000-0000-4000-8000-000000000021','future_owner');");
  database.sql(`
    insert into auth.users(id) values ('26700000-0000-4000-8000-000000000024');
    insert into public.profiles(user_id, handle, created_at, handle_changed_at)
      values ('26700000-0000-4000-8000-000000000024', 'current_owner', '2020-01-01', '2022-01-01');
    insert into public.crawl_stories(title, slug, visibility, author_handle, created_at)
      values ('Current handle', 'current-route', 'public', 'current_owner', '2023-01-01'),
        ('Before rename', 'before-current-route', 'public', 'current_owner', '2021-01-01');
  `);
  database.sql(`select public.rename_pubmaxx_handle('${user}', 'crawl_new');`);
  database.sql("insert into public.crawl_stories(title, slug, visibility, author_handle) values ('After rename','retired-handle-route','public','crawl_old')");
  database.applyFile(join(migrations, forward));
});

afterAll(async () => database?.stop());

describe.skipIf(postgresSkipReason() !== null)("atomic crawl save and author identity", () => {
  it("rolls back the story when a stop fails, and returns the same slug on retry", async () => {
    const failure = await db().attempt(`select public.save_crawl_story(${story}, jsonb_build_array(jsonb_build_object('id','${stopId}','venue_id',null,'position',0)))`);
    expect(failure.ok).toBe(false);
    expect(db().sql(`select count(*) from public.crawl_stories where id = '${storyId}'`)).toBe("0");
    const call = `select public.save_crawl_story(${story}, jsonb_build_array(jsonb_build_object('id','${stopId}','venue_id','venue-a','position',0)))`;
    expect(db().sql(call)).toBe("test-route");
    const retry = call.replace(storyId, "26700000-0000-4000-8000-000000000005");
    expect(db().sql(retry)).toBe("test-route");
    expect(db().sql(`select count(*) from public.crawl_story_stops where crawl_story_id = '${storyId}'`)).toBe("1");
    const mismatch = await db().attempt(`select public.save_crawl_story(${story} || '{"save_hash":"different"}'::jsonb, '[]'::jsonb)`);
    expect(mismatch.ok).toBe(false);
  });

  it("binds a retired handle to its profile and leaves unknown handles unowned", () => {
    expect(db().sql(`select p.handle from public.crawl_stories s join public.profiles p on p.id = s.author_id where s.slug = 'old-route'`)).toBe("crawl_new");
    expect(db().sql("select author_id is null from public.crawl_stories where slug = 'unknown-route'")).toBe("t");
    expect(db().sql("select author_id is null from public.crawl_stories where slug = 'preclaim-route'")).toBe("t");
    expect(db().sql("select author_id from public.crawl_stories where slug = 'unlinked-profile-route'")).toBe("26700000-0000-4000-8000-000000000023");
    expect(db().sql("select author_id is null from public.crawl_stories where slug = 'retired-handle-route'")).toBe("t");
    expect(db().sql("select p.handle from public.crawl_stories s join public.profiles p on p.id = s.author_id where s.slug = 'current-route'")).toBe("current_owner");
    expect(db().sql("select author_id is null from public.crawl_stories where slug = 'before-current-route'")).toBe("t");
    expect(db().sql("select user_id from public.profiles where handle = 'legacy_alias'")).toBe("26700000-0000-4000-8000-000000000022");
    expect(db().sql("select a.claimed_at <= s.created_at from public.profile_handle_aliases a join public.crawl_stories s on s.author_handle = a.handle where s.slug = 'unlinked-profile-route'")).toBe("t");
  });

  it("refuses the save RPC to browser roles", async () => {
    for (const role of ["anon", "authenticated"]) {
      const result = await db().attempt(`set role ${role}; select public.save_crawl_story(${story}, '[]'::jsonb)`);
      expect(result.ok).toBe(false);
      expect(result.said).toContain("permission denied");
    }
  });

  it("removes the save function on rollback", () => {
    db().applyFile(join(migrations, "rollback/20261125190000_0274_crawl_atomic_save_rollback.sql"));
    expect(db().sql("select to_regprocedure('public.save_crawl_story(jsonb,jsonb)') is null")).toBe("t");
  });
});
