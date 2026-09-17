import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  postgresSkipReason,
  startPostgres,
  type PostgresSession,
} from "./helpers/postgres";

const ROOT = process.cwd();
const MIGRATION = join(
  ROOT,
  "supabase/migrations/20260828120000_0123_harvest_venue_overlays.sql",
);
const ROLLBACK = join(
  ROOT,
  "supabase/migrations/rollback/20260828120000_0123_harvest_venue_overlays_rollback.sql",
);

let database: PostgresSession | null = null;
const skipReason = postgresSkipReason();

beforeAll(async () => {
  database = await startPostgres({ label: "harvest-0123" });
  database.sql(
    "create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;",
  );
  database.applyFile(MIGRATION);
}, 180_000);

afterAll(async () => {
  await database?.stop();
});

describe.skipIf(skipReason !== null)("0123 harvest_venue_overlays", () => {
  it("enforces overlay shape and accepts case-insensitive HTTPS", () => {
    database!.sql(`
      insert into public.harvest_venue_overlays(
        osm_id, osm_ref, website, menu_url, lore_text, lore_citations,
        lore_match_name, lore_match_town, sources
      ) values (
        'node/123', 'n123', 'HTTPS://redlion.example/', 'https://redlion.example/menu',
        'The Red Lion in Clapham has stood on the common since the eighteenth century.',
        '["https://history.example/red-lion-clapham"]'::jsonb,
        'The Red Lion', 'Clapham',
        '["https://redlion.example/"]'::jsonb
      );
    `);
    expect(
      database!.sql("select osm_id || '|' || osm_ref from public.harvest_venue_overlays"),
    ).toBe("node/123|n123");
    expect(() =>
      database!.sql(
        "insert into public.harvest_venue_overlays(osm_id, osm_ref, website) values ('node/456', 'n456', 'http://unsafe.example/')",
      ),
    ).toThrow();
    expect(
      database!.sql(
        "select relrowsecurity from pg_class where oid = 'public.harvest_venue_overlays'::regclass",
      ),
    ).toBe("t");
    database!.applyFile(ROLLBACK);
    expect(database!.sql("select to_regclass('public.harvest_venue_overlays')")).toBe("");
  });
});
