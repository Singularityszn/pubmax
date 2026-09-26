import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { postgresSkipReason, startPostgres, type PostgresSession } from "./helpers/postgres";

const skipReason = postgresSkipReason();

const M0098 = join(process.cwd(), "supabase/migrations/20260809160000_0098_venue_photos.sql");
const M0158 = join(process.cwd(), "supabase/migrations/20260926120000_0158_drink_wall.sql");

const PHOTO = "10000000-0000-4000-8000-000000000099";
const PROFILE = "22222222-2222-4222-8222-222222222222";

let session: PostgresSession | null = null;

beforeAll(async () => {
  if (skipReason) return;
  session = await startPostgres({ label: "drink-wall-0158", database: "pubmax_drink_wall_0158" });
  session.sql(`
    create role anon nologin noinherit;
    create role authenticated nologin noinherit;
    create role service_role nologin noinherit bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create table public.profiles (
      id uuid primary key,
      user_id uuid,
      handle text,
      tombstoned_at timestamptz
    );
  `);
  session.applyFile(M0098);
  session.applyFile(M0158);
}, 180_000);

afterAll(async () => {
  await session?.stop();
});

function requireSession(): PostgresSession {
  if (!session) throw new Error("PostgreSQL drink wall session did not start.");
  return session;
}

describe.skipIf(skipReason !== null)("0158 RLS effective", () => {
  it("lets anon read approved city rows only", () => {
    const db = requireSession();
    db.sql(`
      set role service_role;
      insert into public.profiles (id, handle) values ('${PROFILE}', 'alice');
      insert into public.venue_photos (
        id, venue_id, wall_category, place_label, author_actor, author_profile_id,
        object_key, width, height, moderation_state
      ) values (
        '${PHOTO}', null, 'london', 'City', 'profile:${PROFILE}', '${PROFILE}',
        'drink-wall/${PHOTO}.jpg', 1080, 1350, 'approved'
      );
    `);
    expect(
      db.sql(`set role anon; select count(*)::text from public.venue_photos where id = '${PHOTO}'`),
    ).toBe("1");
    db.sql(`set role service_role; update public.venue_photos set moderation_state = 'hidden' where id = '${PHOTO}'`);
    expect(
      db.sql(`set role anon; select count(*)::text from public.venue_photos where id = '${PHOTO}'`),
    ).toBe("0");
  });
});
