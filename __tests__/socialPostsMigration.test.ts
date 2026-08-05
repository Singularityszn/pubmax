import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const FORWARD = join(process.cwd(), "supabase/migrations/20260805110000_0072_social_posts.sql");
const ROLLBACK = join(process.cwd(), "supabase/migrations/rollback/20260805110000_0072_social_posts_rollback.sql");

function binary(name: "initdb" | "postgres" | "psql"): string | null {
  for (const path of [
    `/opt/homebrew/opt/postgresql@16/bin/${name}`,
    `/opt/homebrew/opt/postgresql@17/bin/${name}`,
    `/opt/homebrew/bin/${name}`,
    name,
  ]) {
    try {
      if (path === name) execFileSync("which", [name], { stdio: "pipe" });
      else if (!existsSync(path)) continue;
      return path;
    } catch {}
  }
  return null;
}

type Database = { sql(statement: string): string; apply(path: string): void; stop(): Promise<void> };
let database: Database | null = null;

async function freePort(): Promise<number> {
  const { createServer } = await import("node:net");
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(typeof address === "object" && address ? address.port : 0));
    });
    server.on("error", reject);
  });
}

async function startDatabase(): Promise<Database> {
  const initdb = binary("initdb");
  const postgres = binary("postgres");
  const psql = binary("psql");
  if (!initdb || !postgres || !psql) throw new Error("PostgreSQL is unavailable.");
  const directory = mkdtempSync(join(tmpdir(), "pubmax-social-posts-"));
  const port = await freePort();
  execFileSync(initdb, [
    "-D", directory,
    "--auth=trust",
    "--username=postgres",
    "-c", "shared_memory_type=mmap",
    "-c", "dynamic_shared_memory_type=mmap",
  ], { stdio: "pipe" });
  writeFileSync(join(directory, "postgresql.auto.conf"), `listen_addresses='127.0.0.1'\nport=${port}\nfsync=off\n`);
  const server: ChildProcess = spawn(postgres, ["-D", directory, "-h", "127.0.0.1", "-p", String(port)], { stdio: "ignore" });
  const connection = ["-h", "127.0.0.1", "-p", String(port), "-U", "postgres"];
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      execFileSync(psql, [...connection, "-c", "select 1"], { stdio: "pipe" });
      break;
    } catch {
      if (attempt === 49) throw new Error("PostgreSQL did not start.");
      await sleep(100);
    }
  }
  const run = (args: string[]) => execFileSync(psql, [...connection, "-v", "ON_ERROR_STOP=1", ...args], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
  return {
    sql: (statement) => run(["-q", "-t", "-A", "-c", statement]),
    apply: (path) => run(["-f", path]),
    async stop() {
      if (server.exitCode === null) {
        server.kill("SIGTERM");
        await Promise.race([new Promise<void>((resolve) => server.once("exit", () => resolve())), sleep(1_000)]);
      }
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

beforeAll(async () => {
  database = await startDatabase();
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
}, 60_000);

afterAll(async () => database?.stop());

describe("Social posts migration forward and rollback", () => {
  it("applies service-only schema with database content constraints and a durable pending job", () => {
    const db = database!;
    db.apply(FORWARD);
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

  it("rolls back Task 3 state without touching the profile graph", () => {
    const db = database!;
    db.apply(ROLLBACK);
    expect(db.sql("select to_regclass('public.social_posts') is null")).toBe("t");
    expect(db.sql("select to_regclass('public.social_post_moderation_jobs') is null")).toBe("t");
    expect(db.sql("select count(*) from public.profiles")).toBe("3");
    expect(db.sql("select count(*) from public.follows")).toBe("2");
  });
});
