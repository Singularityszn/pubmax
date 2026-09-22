import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  postgresSkipReason,
  startPostgres,
  type PostgresSession,
} from "./helpers/postgres";

const skipReason = postgresSkipReason();
const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations/20260922120000_0158_venue_photo_and_visit_report_actor_append.sql",
);
const ROLLBACK_PATH = join(
  process.cwd(),
  "supabase/migrations/rollback/20260922120000_0158_venue_photo_and_visit_report_actor_append_rollback.sql",
);

let session: PostgresSession | null = null;

beforeAll(async () => {
  if (skipReason) return;
  session = await startPostgres({
    label: "venue-visit-report-actors",
    database: "pubmax_report_actors",
  });
  session.sql(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create table public.venue_photos (
      id uuid primary key,
      moderation_state text not null default 'approved',
      report_actors text[] not null default '{}',
      report_count integer not null default 0,
      reported_at timestamptz,
      report_reason text,
      moderated_at timestamptz
    );
    create table public.structured_visit_reports (
      id uuid primary key,
      status text not null default 'visible',
      report_actors text[] not null default '{}',
      report_count integer not null default 0,
      reported_at timestamptz,
      report_reason text,
      moderated_at timestamptz
    );
  `);
  session.applyFile(MIGRATION_PATH);
}, 180_000);

afterAll(async () => {
  await session?.stop();
});

describe.skipIf(skipReason !== null)("0158 atomic venue-photo and visit-report actors", () => {
  it("keeps concurrent reporters, enforces grants, and rolls back without deleting rows", async () => {
    const photoId = "10000000-0000-4000-8000-000000000158";
    const reportId = "20000000-0000-4000-8000-000000000158";
    session!.sql(`
      insert into public.venue_photos (id, moderated_at)
      values ('${photoId}', '2026-09-22 08:00:00+00');
      insert into public.structured_visit_reports (id, moderated_at)
      values ('${reportId}', '2026-09-22 08:00:00+00');
    `);

    await Promise.all([
      session!.sqlAsync(
        `select public.append_venue_photo_report_actor('${photoId}', 'photo-a', 'first')`,
      ),
      session!.sqlAsync(
        `select public.append_venue_photo_report_actor('${photoId}', 'photo-b', 'second')`,
      ),
      session!.sqlAsync(
        `select public.append_visit_report_report_actor('${reportId}', 'visit-a', 'first')`,
      ),
      session!.sqlAsync(
        `select public.append_visit_report_report_actor('${reportId}', 'visit-b', 'second')`,
      ),
    ]);

    expect(
      session!.sql(
        `select report_count || ':' || cardinality(report_actors) || ':' || (moderated_at is null)::text
           from public.venue_photos where id = '${photoId}'`,
      ),
    ).toBe("2:2:true");
    expect(
      session!.sql(
        `select report_count || ':' || cardinality(report_actors) || ':' || (moderated_at is null)::text
           from public.structured_visit_reports where id = '${reportId}'`,
      ),
    ).toBe("2:2:true");
    expect(
      session!.sql(
        `select public.append_venue_photo_report_actor('${photoId}', 'photo-a', 'duplicate')`,
      ),
    ).toBe("t");
    expect(
      session!.sql(
        `select public.append_visit_report_report_actor('${reportId}', 'visit-a', 'duplicate')`,
      ),
    ).toBe("t");
    expect(
      session!.sql(
        `select report_count || ':' || cardinality(report_actors)
           from public.venue_photos where id = '${photoId}'`,
      ),
    ).toBe("2:2");
    expect(
      session!.sql(
        `select report_count || ':' || cardinality(report_actors)
           from public.structured_visit_reports where id = '${reportId}'`,
      ),
    ).toBe("2:2");

    for (const signature of [
      "public.append_venue_photo_report_actor(uuid, text, text)",
      "public.append_visit_report_report_actor(uuid, text, text)",
    ]) {
      expect(
        session!.sql(
          `select has_function_privilege('service_role', '${signature}', 'execute')`,
        ),
      ).toBe("t");
      expect(
        session!.sql(`select has_function_privilege('anon', '${signature}', 'execute')`),
      ).toBe("f");
      expect(
        session!.sql(
          `select has_function_privilege('authenticated', '${signature}', 'execute')`,
        ),
      ).toBe("f");
    }

    session!.applyFile(ROLLBACK_PATH);
    expect(
      session!.sql(
        "select to_regprocedure('public.append_venue_photo_report_actor(uuid,text,text)') is null",
      ),
    ).toBe("t");
    expect(
      session!.sql(
        "select to_regprocedure('public.append_visit_report_report_actor(uuid,text,text)') is null",
      ),
    ).toBe("t");
    expect(session!.sql("select count(*) from public.venue_photos")).toBe("1");
    expect(session!.sql("select count(*) from public.structured_visit_reports")).toBe("1");
  });
});
