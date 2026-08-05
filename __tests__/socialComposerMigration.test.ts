import { execFile, execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const POSTS = join(process.cwd(), "supabase/migrations/20260805110000_0072_social_posts.sql");
const INTERACTIONS = join(process.cwd(), "supabase/migrations/20260805120000_0073_social_interactions.sql");
const FORWARD = join(process.cwd(), "supabase/migrations/20260805130000_0074_social_composer.sql");
const ROLLBACK = join(process.cwd(), "supabase/migrations/rollback/20260805130000_0074_social_composer_rollback.sql");

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

const execFileAsync = promisify(execFile);
type Database = {
  sql(statement: string): string;
  sqlAsync(statement: string): Promise<string>;
  apply(path: string): void;
  stop(): Promise<void>;
};
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
  const directory = mkdtempSync(join(tmpdir(), "pubmax-social-composer-"));
  const port = await freePort();
  execFileSync(initdb, [
    "-D", directory, "--auth=trust", "--username=postgres",
    "-c", "shared_memory_type=mmap", "-c", "dynamic_shared_memory_type=mmap",
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
    async sqlAsync(statement) {
      const { stdout } = await execFileAsync(psql, [
        ...connection, "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A", "-c", statement,
      ], { encoding: "utf8" });
      return stdout.trim();
    },
    apply: (path) => run(["-f", path]),
    async stop() {
      if (server.exitCode === null) {
        server.kill("SIGTERM");
        await Promise.race([new Promise<void>((resolve) => server.once("exit", resolve)), sleep(1_000)]);
      }
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const CAROL = "33333333-3333-4333-8333-333333333333";
const MEDIA = "44444444-4444-4444-8444-444444444444";
let postId = "";

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
      unique(follower_id,followee_id)
    );
    insert into public.profiles(id,handle) values
      ('${ALICE}','alice'), ('${BOB}','bob'), ('${CAROL}','carol');
    insert into public.follows(follower_id,followee_id) values
      ('${ALICE}','${BOB}'), ('${BOB}','${ALICE}');
  `);
  database.apply(POSTS);
  database.apply(INTERACTIONS);
}, 60_000);

afterAll(async () => database?.stop());

describe("Social composer migration forward, concurrency, and rollback", () => {
  it("applies atomic private media, audit, tags, moderation, and service-only authority", () => {
    const db = database!;
    db.apply(FORWARD);
    postId = db.sql(`select id from public.create_social_post(
      '${ALICE}','alice','standard','public','Photo night','camden','venue-canonical',
      array['night'],'friends','${MEDIA}','social/${ALICE}/${MEDIA}/image.jpg',
      '${"a".repeat(64)}',1200,800,12345,'Alice and Bob outside the Venue',array['bob']
    )`);
    expect(db.sql(`select photo_media_id from public.social_posts where id='${postId}'`)).toBe(MEDIA);
    expect(db.sql(`select owner_profile_id || ':' || moderation_state from public.social_post_media where id='${MEDIA}'`))
      .toBe(`${ALICE}:pending`);
    expect(db.sql(`select media_id || ':' || moderation_claim from public.social_post_moderation_jobs where post_id='${postId}'`))
      .toBe(`${MEDIA}:Photo night\n\n#night\n\nPhoto: Alice and Bob outside the Venue`);
    expect(db.sql(`select state from public.social_post_tag_proposals where post_id='${postId}' and target_profile_id='${BOB}'`))
      .toBe("proposed");
    expect(db.sql("select has_table_privilege('authenticated','public.social_post_media','select')")).toBe("f");
    expect(db.sql("select has_function_privilege('authenticated','public.create_social_post(uuid,text,text,text,text,text,text,text[],text,uuid,text,text,integer,integer,integer,text,text[])','execute')")).toBe("f");
  });

  it("projects exact public Venue only to author or current mutual friends and inherits blocks", () => {
    const db = database!;
    db.sql(`update public.social_posts set moderation_state='approved' where id='${postId}'`);
    expect(db.sql(`select venue_id from public.read_social_post('${postId}','${ALICE}')`)).toBe("venue-canonical");
    expect(db.sql(`select venue_id from public.read_social_post('${postId}','${BOB}')`)).toBe("venue-canonical");
    expect(db.sql(`select coalesce(venue_id,'hidden') from public.read_social_post('${postId}','${CAROL}')`)).toBe("hidden");
    db.sql(`select public.set_social_block('${ALICE}','${BOB}',true)`);
    expect(db.sql(`select count(*) from public.read_social_post('${postId}','${BOB}')`)).toBe("0");
    expect(db.sql(`select count(*) from public.read_social_post_feed('${BOB}','discover',null,null,null,20)`)).toBe("0");
    db.sql(`select public.set_social_block('${ALICE}','${BOB}',false)`);
  });

  it("increments every actual edit with CAS and immutable digest audit without re-moderating metadata", async () => {
    const db = database!;
    const edit = (visibility: string) => `select count(*) from public.edit_social_post(
      '${postId}','${ALICE}',0,'standard','${visibility}','Photo night','camden','venue-canonical',
      array['night'],'friends','${MEDIA}','Alice and Bob outside the Venue',false
    )`;
    const first = db.sqlAsync(`begin; ${edit("friends")}; select pg_sleep(1); commit`);
    const second = db.sqlAsync(edit("private"));
    const outcomes = (await Promise.all([first, second]))
      .flatMap((output) => output.split("\n").filter((line) => line === "0" || line === "1"))
      .sort();
    expect(outcomes).toEqual(["0", "1"]);
    expect(db.sql(`select revision || ':' || moderation_state from public.social_posts where id='${postId}'`))
      .toBe("1:approved");
    expect(db.sql(`select from_revision || ':' || to_revision || ':' || array_to_string(changed_fields,',') || ':' || length(previous_digest) || ':' || length(next_digest)
      from public.social_post_edit_audit where post_id='${postId}'`))
      .toMatch(/^0:1:visibility:64:64$/);
    expect(() => db.sql(`delete from public.social_post_edit_audit where post_id='${postId}'`)).toThrow();
    expect(() => db.sql(`update public.social_post_edit_audit set changed_fields=array['body'] where post_id='${postId}'`)).toThrow();
  });

  it("binds multimodal completion to revision and media, then keeps tag identity consent reversible", () => {
    const db = database!;
    db.sql(`update public.social_posts set moderation_state='pending' where id='${postId}'`);
    db.sql(`update public.social_post_moderation_jobs set state='processing',revision=1 where post_id='${postId}'`);
    expect(db.sql(`select public.complete_social_post_moderation_job('${postId}',1,null,'approved',null,null)`)).toBe("f");
    expect(db.sql(`select public.complete_social_post_moderation_job('${postId}',1,'${MEDIA}','approved',null,null)`)).toBe("t");
    db.sql(`update public.social_posts set visibility='public' where id='${postId}'`);
    const proposal = db.sql(`select id from public.social_post_tag_proposals where post_id='${postId}' and target_profile_id='${BOB}'`);
    expect(db.sql(`select public.act_social_post_tag('${BOB}','${proposal}','approve')`)).toBe("t");
    expect(db.sql(`select handle from public.read_social_post_tags('${CAROL}','${postId}')`)).toBe("bob");
    expect(db.sql(`select public.act_social_post_tag('${BOB}','${proposal}','withdraw')`)).toBe("t");
    expect(db.sql(`select count(*) from public.read_social_post_tags('${CAROL}','${postId}')`)).toBe("0");
    expect(db.sql(`select string_agg(action,',' order by created_at,id) from public.social_post_tag_events where proposal_id='${proposal}'`))
      .toBe("propose,approve,withdraw");
  });

  it("gives named staff a held post and media workflow", () => {
    const db = database!;
    db.sql(`insert into public.private_social_staff_roles(id,profile_id,display_name,role,active)
      values ('55555555-5555-4555-8555-555555555555','${CAROL}','Carol Smith','moderator',true)`);
    db.sql(`update public.social_posts set moderation_state='needs_review' where id='${postId}'`);
    db.sql(`update public.social_post_media set moderation_state='needs_review' where id='${MEDIA}'`);
    expect(db.sql(`select staff_display_name || ':' || post_id || ':' || media_id from public.read_social_post_moderation_queue('${CAROL}',20)`))
      .toBe(`Carol Smith:${postId}:${MEDIA}`);
    expect(db.sql(`select public.moderate_social_post('${CAROL}','${postId}','${MEDIA}','approve')`)).toBe("t");
    expect(db.sql(`select moderation_state from public.social_posts where id='${postId}'`)).toBe("approved");
    expect(db.sql(`select staff_role_id from public.social_post_moderation_actions where post_id='${postId}'`))
      .toBe("55555555-5555-4555-8555-555555555555");
  });

  it("rolls back Task 6 state and restores Task 3 public-Venue and edit rules", () => {
    const db = database!;
    db.apply(ROLLBACK);
    expect(db.sql("select to_regclass('public.social_post_media') is null")).toBe("t");
    expect(db.sql("select to_regclass('public.social_post_edit_audit') is null")).toBe("t");
    expect(db.sql("select to_regclass('public.social_post_tag_proposals') is null")).toBe("t");
    expect(() => db.sql(`insert into public.social_posts(
      author_profile_id,author_handle,kind,visibility,body,venue_id,comment_policy
    ) values ('${ALICE}','alice','standard','public','Public Venue','venue-canonical','open')`)).toThrow();
    expect(db.sql("select to_regclass('public.social_blocks') is not null")).toBe("t");
    expect(db.sql("select count(*) from public.profiles")).toBe("3");
  });
});
