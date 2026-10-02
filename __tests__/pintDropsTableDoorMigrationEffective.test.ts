// Effective PostgreSQL proof for 0170 (Fable full-repo review B-2).
//
// Before this migration a signed-in role can read an anonymous Pint Drop's
// real handle, a structured visit report, and community_prices.contributor_handle,
// and pint_drops is in the realtime publication. After 0170 those reads are
// refused, the other price columns stay readable, the table leaves the
// publication, and a private join on live:pint-drops is admitted only to
// authenticated. The rollback puts the disclosure back.

import { readdirSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PINT_DROPS_LIVE_TOPIC } from "@/lib/pintDropsTopics";
import {
  postgresSkipReason,
  startPostgres,
  type PostgresSession,
} from "./helpers/postgres";

const skipReason = postgresSkipReason();

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase/migrations");
const FORWARD_NAME = "20261002193000_0170_pint_drops_table_door.sql";
const FORWARD = join(MIGRATIONS, FORWARD_NAME);
const ROLLBACK = join(
  MIGRATIONS,
  "rollback/20261002193000_0170_pint_drops_table_door_rollback.sql",
);
const SESSION_FIXTURE = join(ROOT, "scripts/rls/session-fixture.sql");
const PREREQUISITES = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith(".sql") && name < FORWARD_NAME)
  .sort()
  .map((name) => join(MIGRATIONS, name));

const READER = "11111111-0000-4000-8000-0000000000a1";
const ANON_DROP = "e2000000-0000-4000-8000-000000000009";
const VISIBLE_PRICE = "e3000000-0000-4000-8000-00000000000a";
const VISIT_REPORT = "e4000000-0000-4000-8000-00000000000b";
const AT = "2026-10-02 18:00:00+01";

let database: PostgresSession | null = null;

function requireDatabase(): PostgresSession {
  if (!database) throw new Error("PostgreSQL session unavailable.");
  return database;
}

function lastLine(said: string): string {
  const lines = said
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line !== "BEGIN" && line !== "COMMIT");
  return lines[lines.length - 1] ?? "";
}

function readAs(role: string, statement: string): string {
  const query = statement.trim().endsWith(";") ? statement.trim() : `${statement.trim()};`;
  return lastLine(
    requireDatabase().sql(
      [
        "begin;",
        `set local request.jwt.claims = '{"sub":"${READER}","role":"${role}"}';`,
        `set local role ${role};`,
        query,
        "commit;",
      ].join("\n"),
    ),
  );
}

function joinsTopic(topic: string, role = "authenticated"): number {
  const said = requireDatabase().sql(
    [
      "begin;",
      `set local realtime.topic = '${topic}';`,
      `set local request.jwt.claims = '{"sub":"${READER}","role":"${role}"}';`,
      `set local role ${role};`,
      "select count(*)::int from realtime.messages where extension = 'broadcast';",
      "commit;",
    ].join("\n"),
  );
  const digits = said
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^\d+$/.test(line));
  return Number(digits[digits.length - 1] ?? "-1");
}

function published(): string {
  return requireDatabase().sql(
    "select count(*)::int from pg_publication_tables " +
      "where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pint_drops';",
  );
}

beforeAll(async () => {
  if (skipReason) return;
  database = await startPostgres({ label: "pint-door", database: "pubmax_pint_door" });
  const session = requireDatabase();
  session.applyFile(SESSION_FIXTURE);
  for (const path of PREREQUISITES) session.applyFile(path);
  session.sql(
    [
      `insert into public.pint_drops (`,
      `  id, venue_id, handle, price_gbp, status, visibility, moderator_note, report_reason, receipt_photo_key, created_at`,
      `) values (`,
      `  '${ANON_DROP}', 'venue-door', 'secret_author', 4.20, 'visible', 'anonymous',`,
      `  'staff-only-note', 'reported-in-private', 'receipts/secret_author/bill.jpg', '${AT}'`,
      `);`,
      `insert into public.community_prices (`,
      `  id, venue_id, drink_category, price_pennies, actor, contributor_handle, submitted_at`,
      `) values (`,
      `  '${VISIBLE_PRICE}', 'venue-door', 'wine', 450, 'profile:door', 'secret_author', '${AT}'`,
      `);`,
      `insert into public.structured_visit_reports (`,
      `  id, venue_id, handle, visited_at, note, status, moderator_note, created_at`,
      `) values (`,
      `  '${VISIT_REPORT}', 'venue-door', 'secret_author', '2026-09-01', 'how the night felt', 'visible', 'staff-only-note', '${AT}'`,
      `);`,
      `insert into realtime.messages (topic, extension, event, private, inserted_at)`,
      `  values ('live', 'broadcast', 'drop', true, '${AT}');`,
    ].join("\n"),
  );
}, 300_000);

afterAll(async () => {
  await database?.stop();
  database = null;
});

describe.skipIf(skipReason !== null)("0170 pint drop table door", () => {
  it("BEFORE: a signed-in role reads the anonymous handle, the visit, and the contributor", () => {
    expect(readAs("authenticated", `select handle from public.pint_drops where id = '${ANON_DROP}'`)).toBe(
      "secret_author",
    );
    expect(
      readAs("authenticated", `select moderator_note from public.pint_drops where id = '${ANON_DROP}'`),
    ).toBe("staff-only-note");
    expect(
      readAs("authenticated", `select handle from public.visit_reports where id = '${ANON_DROP}'`),
    ).toBe("secret_author");
    expect(
      readAs(
        "authenticated",
        `select handle from public.structured_visit_reports where id = '${VISIT_REPORT}'`,
      ),
    ).toBe("secret_author");
    expect(
      readAs(
        "authenticated",
        `select contributor_handle from public.community_prices where id = '${VISIBLE_PRICE}'`,
      ),
    ).toBe("secret_author");
    expect(published()).toBe("1");
    expect(joinsTopic(PINT_DROPS_LIVE_TOPIC)).toBe(0);
  });

  it("applies cleanly and closes the three reads", () => {
    const session = requireDatabase();
    session.applyFile(FORWARD);

    expect(
      session.sql("select has_table_privilege('authenticated', 'public.pint_drops', 'select');"),
    ).toBe("f");
    expect(
      session.sql(
        "select has_table_privilege('authenticated', 'public.structured_visit_reports', 'select');",
      ),
    ).toBe("f");
    expect(
      session.sql("select has_table_privilege('authenticated', 'public.visit_reports', 'select');"),
    ).toBe("f");
    expect(
      session.sql(
        "select has_column_privilege('authenticated', 'public.community_prices', 'contributor_handle', 'select');",
      ),
    ).toBe("f");
    expect(
      session.sql(
        "select has_column_privilege('authenticated', 'public.community_prices', 'price_pennies', 'select');",
      ),
    ).toBe("t");
    expect(
      session.sql("select has_table_privilege('service_role', 'public.pint_drops', 'select');"),
    ).toBe("t");

    const dropRefusal = session.expectRefusal(
      [
        "begin;",
        "set local role authenticated;",
        `select handle from public.pint_drops where id = '${ANON_DROP}';`,
        "commit;",
      ].join("\n"),
    );
    expect(dropRefusal).toMatch(/permission denied/i);
    expect(dropRefusal).not.toContain("secret_author");

    expect(
      session.expectRefusal(
        [
          "begin;",
          "set local role authenticated;",
          `select handle from public.structured_visit_reports where id = '${VISIT_REPORT}';`,
          "commit;",
        ].join("\n"),
      ),
    ).toMatch(/permission denied/i);
    expect(
      session.expectRefusal(
        [
          "begin;",
          "set local role authenticated;",
          `select contributor_handle from public.community_prices where id = '${VISIBLE_PRICE}';`,
          "commit;",
        ].join("\n"),
      ),
    ).toMatch(/permission denied/i);

    expect(
      readAs(
        "authenticated",
        `select price_pennies from public.community_prices where id = '${VISIBLE_PRICE}'`,
      ),
    ).toBe("450");
    expect(readAs("service_role", `select handle from public.pint_drops where id = '${ANON_DROP}'`)).toBe(
      "secret_author",
    );
    expect(published()).toBe("0");
  });

  it("is idempotent", () => {
    const session = requireDatabase();
    session.applyFile(FORWARD);
    expect(
      session.sql(
        "select count(*)::int from pg_policies where policyname = 'pubmax_pint_drops_topic_read';",
      ),
    ).toBe("1");
  });

  it("admits any signed-in account to the payload-free topic, and refuses anon and every other topic", () => {
    expect(joinsTopic(PINT_DROPS_LIVE_TOPIC)).toBe(1);
    expect(joinsTopic(PINT_DROPS_LIVE_TOPIC, "anon")).toBe(0);
    expect(joinsTopic("live:inbox:secret_author")).toBe(0);
    expect(joinsTopic("live:pint-drops-extra")).toBe(0);
  });

  it("the ROLLBACK republishes the handle, which is the cost the header names", () => {
    const session = requireDatabase();
    session.applyFile(ROLLBACK);
    expect(
      session.sql(
        "select count(*)::int from pg_policies where policyname = 'pubmax_pint_drops_topic_read';",
      ),
    ).toBe("0");
    expect(published()).toBe("1");
    expect(readAs("authenticated", `select handle from public.pint_drops where id = '${ANON_DROP}'`)).toBe(
      "secret_author",
    );
    expect(
      readAs(
        "authenticated",
        `select contributor_handle from public.community_prices where id = '${VISIBLE_PRICE}'`,
      ),
    ).toBe("secret_author");
    expect(joinsTopic(PINT_DROPS_LIVE_TOPIC)).toBe(0);
  });
});
