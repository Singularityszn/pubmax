// Migration 0158, proved against a real PostgreSQL: the CHECKs that keep a
// wall row's category, pub link and object key in step; the deny-by-default
// posture 0098 set (the browser reads walls only through the API); and a
// rollback that applies cleanly and lets the forward file apply again.

import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { postgresSkipReason, startPostgres, type PostgresSession } from "./helpers/postgres";

const skipReason = postgresSkipReason();

const M0098 = join(process.cwd(), "supabase/migrations/20260809160000_0098_venue_photos.sql");
const M0158 = join(process.cwd(), "supabase/migrations/20260926120000_0158_drink_wall.sql");
const R0158 = join(
  process.cwd(),
  "supabase/migrations/rollback/20260926120000_0158_drink_wall_rollback.sql",
);

const CITY_PHOTO = "10000000-0000-4000-8000-000000000099";
const PUB_PHOTO = "10000000-0000-4000-8000-00000000009a";
const PROBE = "10000000-0000-4000-8000-00000000009b";
const PROFILE = "22222222-2222-4222-8222-222222222222";
const VENUE = "venue-1f5ygjb";

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
    insert into public.profiles (id, handle) values ('${PROFILE}', 'alice');
  `);
  session.applyFile(M0098);
  session.applyFile(M0158);
}, 180_000);

afterAll(async () => {
  await session?.stop();
});

function db(): PostgresSession {
  if (!session) throw new Error("PostgreSQL drink wall session did not start.");
  return session;
}

function insertRow(
  id: string,
  venueId: string | null,
  wallCategory: string,
  objectKey: string,
  placeLabel = "",
): string {
  return `
    insert into public.venue_photos (
      id, venue_id, wall_category, place_label, author_actor, author_profile_id,
      object_key, width, height, moderation_state
    ) values (
      '${id}', ${venueId === null ? "null" : `'${venueId}'`}, '${wallCategory}', '${placeLabel}',
      'profile:${PROFILE}', '${PROFILE}', '${objectKey}', 1080, 1350, 'approved'
    )`;
}

describe.skipIf(skipReason !== null)("0158 drink wall schema", () => {
  it("takes a city row with no pub and a drink-wall key, and a pub row with its venue key", async () => {
    const city = await db().attempt(insertRow(CITY_PHOTO, null, "london", `drink-wall/${CITY_PHOTO}.jpg`, "South Bank"));
    expect(city.ok, city.said).toBe(true);
    const pub = await db().attempt(insertRow(PUB_PHOTO, VENUE, "pub", `venue-photos/${VENUE}/${PUB_PHOTO}.jpg`));
    expect(pub.ok, pub.said).toBe(true);
  });

  it("refuses a category outside the closed list", async () => {
    const answer = await db().attempt(insertRow(PROBE, VENUE, "selfie", `venue-photos/${VENUE}/${PROBE}.jpg`));
    expect(answer.ok).toBe(false);
    expect(answer.said).toMatch(/23514/);
  });

  it("refuses a pint or pub row with no pub", async () => {
    for (const category of ["pint", "pub"]) {
      const answer = await db().attempt(insertRow(PROBE, null, category, `drink-wall/${PROBE}.jpg`));
      expect(answer.ok).toBe(false);
      expect(answer.said).toMatch(/venue_photos_category_venue_check/);
    }
  });

  it("refuses an object key that does not match the row's pub link", async () => {
    const cityWithVenueKey = await db().attempt(
      insertRow(PROBE, null, "london", `venue-photos/${VENUE}/${PROBE}.jpg`),
    );
    expect(cityWithVenueKey.ok).toBe(false);
    expect(cityWithVenueKey.said).toMatch(/venue_photos_object_key_check/);

    const pubWithCityKey = await db().attempt(insertRow(PROBE, VENUE, "pint", `drink-wall/${PROBE}.jpg`));
    expect(pubWithCityKey.ok).toBe(false);
    expect(pubWithCityKey.said).toMatch(/venue_photos_object_key_check/);

    const otherId = await db().attempt(insertRow(PROBE, null, "london", `drink-wall/${CITY_PHOTO}.jpg`));
    expect(otherId.ok).toBe(false);
    expect(otherId.said).toMatch(/venue_photos_object_key_check/);
  });

  it("refuses a place label longer than 80 characters", async () => {
    const answer = await db().attempt(
      insertRow(PROBE, null, "london", `drink-wall/${PROBE}.jpg`, "x".repeat(81)),
    );
    expect(answer.ok).toBe(false);
    expect(answer.said).toMatch(/venue_photos_place_label_check/);
  });

  it("keeps anon and authenticated out: no read, no insert, no delete", async () => {
    for (const role of ["anon", "authenticated"]) {
      const read = await db().attempt(`set role ${role}; select count(*) from public.venue_photos`);
      expect(read.ok).toBe(false);
      expect(read.said).toMatch(/42501/);

      const insert = await db().attempt(`set role ${role}; ${insertRow(PROBE, null, "london", `drink-wall/${PROBE}.jpg`)}`);
      expect(insert.ok).toBe(false);
      expect(insert.said).toMatch(/42501/);

      const remove = await db().attempt(`set role ${role}; delete from public.venue_photos where id = '${CITY_PHOTO}'`);
      expect(remove.ok).toBe(false);
      expect(remove.said).toMatch(/42501/);
    }
    expect(db().sql("select count(*) from public.venue_photos")).toBe("2");
  });

  it("ROLLBACK removes city rows and the wall columns, and the forward file applies again", () => {
    db().applyFile(R0158);
    expect(db().sql("select count(*) from public.venue_photos")).toBe("1");
    expect(db().sql(`select count(*) from public.venue_photos where id = '${PUB_PHOTO}'`)).toBe("1");
    expect(
      db().sql(`
        select count(*) from information_schema.columns
         where table_schema = 'public' and table_name = 'venue_photos'
           and column_name in ('wall_category', 'place_label')
      `),
    ).toBe("0");
    expect(
      db().sql(`
        select is_nullable from information_schema.columns
         where table_schema = 'public' and table_name = 'venue_photos' and column_name = 'venue_id'
      `),
    ).toBe("NO");

    db().applyFile(M0158);
    expect(db().sql(`select wall_category from public.venue_photos where id = '${PUB_PHOTO}'`)).toBe("pint");
  });
});
