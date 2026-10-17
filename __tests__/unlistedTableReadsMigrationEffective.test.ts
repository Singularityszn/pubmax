// Effective PostgreSQL proof for 0178.
//
// Before this migration the anon key lists every unlisted crawl, slug and
// author handle included, and any signed-in account lists every unlisted
// recap and its moments. After 0178 anon and authenticated hold no SELECT on
// crawl_stories, a stranger reads only public recaps, the host still reads
// their own unlisted recap, and the rollback puts both doors back.

import { readdirSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  postgresSkipReason,
  startPostgres,
  type PostgresSession,
} from "./helpers/postgres";

const skipReason = postgresSkipReason();

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase/migrations");
const FORWARD_NAME = "20261016090000_0178_unlisted_table_reads.sql";
const FORWARD = join(MIGRATIONS, FORWARD_NAME);
const ROLLBACK = join(
  MIGRATIONS,
  "rollback/20261016090000_0178_unlisted_table_reads_rollback.sql",
);
const SESSION_FIXTURE = join(ROOT, "scripts/rls/session-fixture.sql");
const PREREQUISITES = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith(".sql") && name < FORWARD_NAME)
  .sort()
  .map((name) => join(MIGRATIONS, name));

const HOST = "11111111-0000-4000-8000-0000000001a1";
const STRANGER = "11111111-0000-4000-8000-0000000001b2";
const MEMORY = "f1000000-0000-4000-8000-000000000001";
const MOMENT_PUBLIC = "f2000000-0000-4000-8000-000000000001";
const MOMENT_UNLISTED = "f2000000-0000-4000-8000-000000000002";
const STORY_PUBLIC = "f3000000-0000-4000-8000-000000000001";
const STORY_UNLISTED = "f3000000-0000-4000-8000-000000000002";

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

function tablePriv(role: string, table: string): string {
  return requireDatabase().sql(
    `select has_table_privilege('${role}', 'public.${table}', 'select');`,
  );
}

function asAnon(query: string): string {
  return lastLine(
    requireDatabase().sql(["begin;", "set local role anon;", query, "commit;"].join("\n")),
  );
}

function asAccount(userId: string, query: string): string {
  return lastLine(
    requireDatabase().sql(
      [
        "begin;",
        `set local request.jwt.claims = '{"sub":"${userId}","role":"authenticated"}';`,
        "set local role authenticated;",
        query,
        "commit;",
      ].join("\n"),
    ),
  );
}

const STORY_IDS = `select coalesce(string_agg(title, ',' order by title), '') from public.night_stories;`;
const MOMENT_STORIES = `select coalesce(string_agg(story_id::text, ',' order by story_id), '') from public.night_story_moments;`;
const CRAWL_SLUGS = `select coalesce(string_agg(slug, ',' order by slug), '') from public.crawl_stories;`;

beforeAll(async () => {
  if (skipReason) return;
  database = await startPostgres({ label: "unlisted-reads", database: "pubmax_unlisted_reads" });
  const session = requireDatabase();
  session.applyFile(SESSION_FIXTURE);
  for (const path of PREREQUISITES) session.applyFile(path);
  session.sql(
    [
      `insert into auth.users (id) values ('${HOST}'), ('${STRANGER}');`,
      `insert into public.crawl_stories (title, slug, visibility) values`,
      `  ('Open crawl', 'open-crawl', 'public'),`,
      `  ('Secret crawl', 'secret-crawl', 'unlisted'),`,
      `  ('Draft crawl', 'draft-crawl', 'draft');`,
      `insert into public.night_memories (id, owner_id, title) values ('${MEMORY}', '${HOST}', 'Host night');`,
      `insert into public.night_moments (id, memory_id, owner_id, kind, caption) values`,
      `  ('${MOMENT_PUBLIC}', '${MEMORY}', '${HOST}', 'event', 'public moment'),`,
      `  ('${MOMENT_UNLISTED}', '${MEMORY}', '${HOST}', 'event', 'unlisted moment');`,
      `insert into public.night_stories (id, memory_id, host_editor_id, title, status, visibility, published_at) values`,
      `  ('${STORY_PUBLIC}', '${MEMORY}', '${HOST}', 'Open recap', 'published', 'public', now()),`,
      `  ('${STORY_UNLISTED}', '${MEMORY}', '${HOST}', 'Secret recap', 'published', 'unlisted', now());`,
      `insert into public.night_story_moments (story_id, moment_id, position) values`,
      `  ('${STORY_PUBLIC}', '${MOMENT_PUBLIC}', 0),`,
      `  ('${STORY_UNLISTED}', '${MOMENT_UNLISTED}', 0);`,
    ].join("\n"),
  );
}, 300_000);

afterAll(async () => {
  await database?.stop();
  database = null;
});

describe.skipIf(skipReason !== null)("0178 unlisted table reads", () => {
  it("BEFORE: anon lists unlisted crawls and a stranger lists unlisted recaps", () => {
    expect(tablePriv("anon", "crawl_stories")).toBe("t");
    expect(asAnon(CRAWL_SLUGS)).toBe("open-crawl,secret-crawl");
    expect(asAccount(STRANGER, STORY_IDS)).toBe("Open recap,Secret recap");
    expect(asAccount(STRANGER, MOMENT_STORIES)).toBe(`${STORY_PUBLIC},${STORY_UNLISTED}`);
  });

  it("closes the crawl table, keeps unlisted recaps to their host, and keeps public recaps", () => {
    const session = requireDatabase();
    session.applyFile(FORWARD);

    expect(tablePriv("anon", "crawl_stories")).toBe("f");
    expect(tablePriv("authenticated", "crawl_stories")).toBe("f");
    expect(tablePriv("service_role", "crawl_stories")).toBe("t");
    expect(session.expectRefusal(["begin;", "set local role anon;", CRAWL_SLUGS, "commit;"].join("\n"))).toMatch(
      /permission denied/i,
    );

    expect(asAccount(STRANGER, STORY_IDS)).toBe("Open recap");
    expect(asAccount(STRANGER, MOMENT_STORIES)).toBe(STORY_PUBLIC);
    expect(asAccount(HOST, STORY_IDS)).toBe("Open recap,Secret recap");
    expect(asAccount(HOST, MOMENT_STORIES)).toBe(`${STORY_PUBLIC},${STORY_UNLISTED}`);
    expect(tablePriv("anon", "night_stories")).toBe("f");
  });

  it("rolls both read doors back", () => {
    const session = requireDatabase();
    session.applyFile(ROLLBACK);

    expect(tablePriv("anon", "crawl_stories")).toBe("t");
    expect(asAnon(CRAWL_SLUGS)).toBe("open-crawl,secret-crawl");
    expect(asAccount(STRANGER, STORY_IDS)).toBe("Open recap,Secret recap");
  });
});
