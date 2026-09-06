// Effective proof for migration 0122. This test applies the SQL to a small,
// temporary PostgreSQL cluster because the bug is the RPC outcome produced by
// ON CONFLICT DO NOTHING, not the migration's source-text shape.

import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  postgresSkipReason,
  startPostgres,
  type PostgresSession,
} from "./helpers/postgres";

const skipReason = postgresSkipReason();

const MIGRATION_0121_PATH = join(
  process.cwd(),
  "supabase/migrations/20260827110000_0121_wanted_public_list_promotion.sql",
);
const MIGRATION_0122_PATH = join(
  process.cwd(),
  "supabase/migrations/20260827120000_0122_wanted_promotion_already_saved_fix.sql",
);
const ROLLBACK_0122_PATH = join(
  process.cwd(),
  "supabase/migrations/rollback/20260827120000_0122_wanted_promotion_already_saved_fix_rollback.sql",
);

let session: PostgresSession | null = null;

beforeAll(async () => {
  if (skipReason) return;
  session = await startPostgres({ label: "wanted-promotion-0122" });
  // The pre-0121 shape both migrations are applied over.
  session.sql(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create table public.wanteds (
      id uuid primary key,
      owner_actor text not null,
      venue_kind text not null,
      venue_id text,
      status text not null default 'open'
    );
    create table public.saved_pubs (
      profile_id uuid not null,
      venue_id text not null,
      list_type text not null,
      note text,
      unique (profile_id, venue_id, list_type)
    );
  `);
  session.applyFile(MIGRATION_0121_PATH);
  session.applyFile(MIGRATION_0122_PATH);
}, 180_000);

afterAll(async () => {
  await session?.stop();
});

describe.skipIf(skipReason !== null)("0122 Wanted promotion outcome", () => {
  it("reports an existing save accurately and rollback restores 0121 behavior", () => {
    const profileId = "00000000-0000-4000-8000-000000000122";
    const ownerActor = `profile:${profileId}`;
    const fixedWantedId = "00000000-0000-4000-8000-000000000001";
    const rollbackWantedId = "00000000-0000-4000-8000-000000000002";

    session!.sql(`
      insert into public.wanteds (id, owner_actor, venue_kind, venue_id)
      values ('${fixedWantedId}', '${ownerActor}', 'curated', 'venue-fixed');
      insert into public.saved_pubs (profile_id, venue_id, list_type)
      values ('${profileId}', 'venue-fixed', 'favourites');
    `);

    expect(
      session!.sql(`
        select outcome || '|' || promoted_list_type || '|' || (promoted_at is not null)
        from public.promote_wanted_to_saved_list(
          '${ownerActor}', '${profileId}', '${fixedWantedId}', 'venue-fixed', 'favourites'
        )
      `),
    ).toBe("already_saved|favourites|true");
    expect(
      session!.sql(`
        select promoted_list_type || '|' || (promoted_at is not null)
        from public.wanteds where id = '${fixedWantedId}'
      `),
    ).toBe("favourites|true");

    session!.applyFile(ROLLBACK_0122_PATH);
    session!.sql(`
      insert into public.wanteds (id, owner_actor, venue_kind, venue_id)
      values ('${rollbackWantedId}', '${ownerActor}', 'curated', 'venue-rollback');
      insert into public.saved_pubs (profile_id, venue_id, list_type)
      values ('${profileId}', 'venue-rollback', 'favourites');
    `);

    expect(
      session!.sql(`
        select outcome || '|' || promoted_list_type || '|' || (promoted_at is not null)
        from public.promote_wanted_to_saved_list(
          '${ownerActor}', '${profileId}', '${rollbackWantedId}', 'venue-rollback', 'favourites'
        )
      `),
    ).toBe("saved|favourites|true");
    expect(
      session!.sql(`
        select promoted_list_type || '|' || (promoted_at is not null)
        from public.wanteds where id = '${rollbackWantedId}'
      `),
    ).toBe("favourites|true");
  });
});
