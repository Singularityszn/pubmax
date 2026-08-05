import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const FORWARD = join(
  process.cwd(),
  "supabase/migrations/20260805100000_0071_social_identity_assurance.sql",
);
const ROLLBACK = join(
  process.cwd(),
  "supabase/migrations/rollback/20260805100000_0071_social_identity_assurance_rollback.sql",
);

function postgresBinary(name: "initdb" | "postgres" | "psql"): string | null {
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

type Database = {
  sql(statement: string): string;
  apply(path: string): void;
  concurrent(statements: readonly string[]): Promise<void>;
  stop(): Promise<void>;
};

async function freePort(): Promise<number> {
  const { createServer } = await import("node:net");
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        resolve(typeof address === "object" && address ? address.port : 0),
      );
    });
    server.on("error", reject);
  });
}

async function startDatabase(): Promise<Database> {
  const initdb = postgresBinary("initdb");
  const postgres = postgresBinary("postgres");
  const psql = postgresBinary("psql");
  if (!initdb || !postgres || !psql) throw new Error("PostgreSQL is unavailable.");
  const directory = mkdtempSync(join(tmpdir(), "pubmax-social-identity-"));
  const port = await freePort();
  execFileSync(initdb, ["-D", directory, "--auth=trust", "--username=postgres"], {
    stdio: "pipe",
  });
  writeFileSync(
    join(directory, "postgresql.auto.conf"),
    `listen_addresses='127.0.0.1'\nport=${port}\nfsync=off\n`,
  );
  const server: ChildProcess = spawn(
    postgres,
    ["-D", directory, "-h", "127.0.0.1", "-p", String(port)],
    { stdio: "ignore" },
  );
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
  const run = (args: string[]): string =>
    execFileSync(psql, [...connection, "-v", "ON_ERROR_STOP=1", ...args], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  run([
    "-c",
    `create schema auth;
     create role anon noinherit;
     create role authenticated noinherit;
     create role service_role noinherit;
     create table auth.users(id uuid primary key);
     create table public.profiles(
       id uuid primary key default gen_random_uuid(),
       user_id uuid unique references auth.users(id),
       handle text not null unique,
       created_at timestamptz not null default now(),
       updated_at timestamptz not null default now()
     );
     create table public.profile_handle_aliases(
       profile_id uuid not null references public.profiles(id),
       handle text primary key,
       is_current boolean not null default true
     );
     insert into public.profiles(handle) values ('pre_migration_shape');`,
  ]);
  return {
    sql: (statement) => run(["-t", "-A", "-c", statement]),
    apply: (path) => {
      run(["-f", path]);
    },
    concurrent: async (statements) => {
      await Promise.all(
        statements.map(
          (statement) =>
            new Promise<void>((resolve, reject) => {
              const client = spawn(
                psql,
                [...connection, "-v", "ON_ERROR_STOP=1", "-c", statement],
                { stdio: ["ignore", "pipe", "pipe"] },
              );
              let stderr = "";
              client.stderr.setEncoding("utf8");
              client.stderr.on("data", (chunk: string) => {
                stderr += chunk;
              });
              client.once("error", reject);
              client.once("exit", (code) => {
                if (code === 0) resolve();
                else reject(new Error(stderr || `psql exited ${code}`));
              });
            }),
        ),
      );
    },
    async stop() {
      if (server.exitCode === null) {
        server.kill("SIGTERM");
        await Promise.race([
          new Promise<void>((resolve) => server.once("exit", () => resolve())),
          sleep(1_000).then(() => undefined),
        ]);
      }
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

describe("social identity migration shape", () => {
  it("keeps account and Yoti assurance records service-only and minimal", () => {
    const sql = readFileSync(FORWARD, "utf8").toLowerCase();
    expect(sql).toContain("create table public.private_social_accounts");
    expect(sql).toContain("create table public.private_social_age_verifications");
    expect(sql).toContain("yoti_subject_reference");
    expect(sql).toContain("verified_at");
    expect(sql).toContain("expires_at");
    expect(sql).toContain("audit_state");
    expect(sql).toContain("revoke all on public.private_social_accounts");
    expect(sql).toContain("to service_role");
  });

  it("ships the service-only transactional migration RPC and rollback", () => {
    const forward = readFileSync(FORWARD, "utf8").toLowerCase();
    const rollback = readFileSync(ROLLBACK, "utf8").toLowerCase();
    expect(forward).toContain("function public.migrate_social_product_account");
    expect(forward).toContain("p_clerk_user_id text");
    expect(forward).toContain("p_supabase_user_id uuid");
    expect(forward).toContain("grant execute on function public.migrate_social_product_account");
    expect(rollback).toContain("drop function if exists public.migrate_social_product_account");
    expect(rollback).toContain("drop table if exists public.private_social_age_verifications");
    expect(rollback).toContain("drop table if exists public.private_social_accounts");
  });
});

let database: Database | null = null;

beforeAll(async () => {
  database = await startDatabase();
  database.apply(FORWARD);
}, 60_000);

afterAll(async () => {
  await database?.stop();
});

describe("social identity migration runtime", () => {
  it("backfills legacy provenance and lets only an ephemeral row finish linking", () => {
    const db = database!;
    db.sql(`
      insert into auth.users(id) values
        ('77777777-7777-4777-8777-777777777777'),
        ('88888888-8888-4888-8888-888888888888');
      insert into public.profiles(handle, account_link_state)
      values ('ephemeral_shape', 'ephemeral');
    `);

    expect(
      db.sql("select account_link_state from public.profiles where handle='pre_migration_shape'"),
    ).toBe("legacy_unlinked");
    expect(
      JSON.parse(
        db.sql(`select public.claim_pubmaxx_handle(
          '77777777-7777-4777-8777-777777777777', 'pre_migration_shape'
        )`),
      ),
    ).toMatchObject({ ok: false, code: "taken" });
    expect(
      JSON.parse(
        db.sql(`select public.claim_pubmaxx_handle(
          '88888888-8888-4888-8888-888888888888', 'ephemeral_shape'
        )`),
      ),
    ).toMatchObject({ ok: true, handle: "ephemeral_shape" });
    expect(
      db.sql("select account_link_state from public.profiles where handle='ephemeral_shape'"),
    ).toBe("account_owned");
  });

  it("binds both server-derived identities once and rejects confused-session replay", () => {
    const db = database!;
    db.sql(`
      insert into auth.users(id) values
        ('11111111-1111-4111-8111-111111111111'),
        ('22222222-2222-4222-8222-222222222222');
      insert into public.profiles(user_id, handle) values
        ('11111111-1111-4111-8111-111111111111', 'first_owner'),
        ('22222222-2222-4222-8222-222222222222', 'second_owner');
    `);

    const first = JSON.parse(db.sql(`select public.migrate_social_product_account(
      'clerk-first', '11111111-1111-4111-8111-111111111111'
    )`));
    const replay = JSON.parse(db.sql(`select public.migrate_social_product_account(
      'clerk-first', '11111111-1111-4111-8111-111111111111'
    )`));
    const confused = JSON.parse(db.sql(`select public.migrate_social_product_account(
      'clerk-first', '22222222-2222-4222-8222-222222222222'
    )`));

    expect(first).toMatchObject({ ok: true, migrated: true });
    expect(replay).toMatchObject({
      ok: true,
      migrated: false,
      product_account_id: first.product_account_id,
    });
    expect(confused).toEqual({ ok: false, code: "ownership_conflict" });
    expect(db.sql("select count(*) from public.private_social_account_audit")).toBe("1");

    db.sql("update public.profiles set handle='first_owner_renamed' where user_id='11111111-1111-4111-8111-111111111111'");
    expect(
      db.sql(`select p.handle from public.private_social_accounts a
        join public.profiles p on p.id=a.profile_id
        where a.id='${first.product_account_id}'`),
    ).toBe("first_owner_renamed");
  });

  it("keeps Yoti evidence bound to one product account without browser grants", () => {
    const db = database!;
    const accountId = db.sql(
      "select id from public.private_social_accounts where clerk_user_id='clerk-first'",
    );
    db.sql(`insert into public.private_social_age_verifications(
      product_account_id, provider, yoti_subject_reference, decision,
      verified_at, expires_at, audit_state
    ) values (
      '${accountId}', 'yoti', 'subject-one', 'verified_adult',
      now(), now() + interval '30 days', 'current'
    )`);
    expect(
      db.sql(
        "select has_table_privilege('authenticated', 'public.private_social_age_verifications', 'select')",
      ),
    ).toBe("f");
    expect(
      db.sql(`select string_agg(column_name, ',' order by ordinal_position)
        from information_schema.columns
        where table_schema='public'
          and table_name='private_social_age_verifications'`),
    ).toBe(
      "id,product_account_id,provider,yoti_subject_reference,decision,verified_at,expires_at,audit_state,created_at,updated_at",
    );
  });

  it("resolves crossed existing-account migrations without deadlock", async () => {
    const db = database!;
    const functionDefinition = db.sql(`select pg_get_functiondef(
      'public.migrate_social_product_account(text,uuid)'::regprocedure
    )`);
    expect(functionDefinition).toMatch(/order by lock_key/i);
    expect(functionDefinition).toMatch(/order by id[\s\S]*for update/i);
    db.sql(`
      insert into auth.users(id) values
        ('99999999-9999-4999-8999-999999999991'),
        ('99999999-9999-4999-8999-999999999992');
      insert into public.profiles(user_id, handle, account_link_state) values
        ('99999999-9999-4999-8999-999999999991', 'crossed_one', 'account_owned'),
        ('99999999-9999-4999-8999-999999999992', 'crossed_two', 'account_owned');
    `);
    expect(
      JSON.parse(db.sql(`select public.migrate_social_product_account(
        'clerk-crossed-one', '99999999-9999-4999-8999-999999999991'
      )`)),
    ).toMatchObject({ ok: true, migrated: true });
    expect(
      JSON.parse(db.sql(`select public.migrate_social_product_account(
        'clerk-crossed-two', '99999999-9999-4999-8999-999999999992'
      )`)),
    ).toMatchObject({ ok: true, migrated: true });

    const startsAt = new Date(Date.now() + 3_000).toISOString();
    const transaction = (clerkUserId: string, supabaseUserId: string) => `
      begin;
      set local deadlock_timeout = '50ms';
      set local statement_timeout = '10s';
      select pg_sleep(greatest(0, extract(epoch from timestamptz '${startsAt}' - clock_timestamp())));
      do $block$
      begin
        for attempt in 1..20 loop
          perform public.migrate_social_product_account(
            '${clerkUserId}', '${supabaseUserId}'
          );
        end loop;
      end
      $block$;
      commit;
    `;

    await expect(
      db.concurrent(
        Array.from({ length: 12 }, (_, index) =>
          index % 2 === 0
            ? transaction(
                "clerk-crossed-one",
                "99999999-9999-4999-8999-999999999992",
              )
            : transaction(
                "clerk-crossed-two",
                "99999999-9999-4999-8999-999999999991",
              ),
        ),
      ),
    ).resolves.toBeUndefined();
    expect(
      db.sql(`select clerk_user_id || ':' || supabase_user_id::text
        from public.private_social_accounts
        where clerk_user_id like 'clerk-crossed-%'
        order by clerk_user_id`),
    ).toBe(
      "clerk-crossed-one:99999999-9999-4999-8999-999999999991\n" +
        "clerk-crossed-two:99999999-9999-4999-8999-999999999992",
    );
  });

  it("freezes an unlinked legacy handle but still creates a new one", () => {
    const db = database!;
    db.sql(`
      insert into auth.users(id)
      values ('33333333-3333-4333-8333-333333333333');
      insert into public.profiles(handle) values ('old_timer');
    `);
    expect(
      JSON.parse(
        db.sql(`select public.claim_pubmaxx_handle(
          '33333333-3333-4333-8333-333333333333', 'old_timer'
        )`),
      ),
    ).toMatchObject({ ok: false, code: "taken" });
    expect(
      JSON.parse(
        db.sql(`select public.claim_pubmaxx_handle(
          '33333333-3333-4333-8333-333333333333', 'new_timer'
        )`),
      ),
    ).toMatchObject({ ok: true, handle: "new_timer" });
  });

  it("rolls back new private state and restores the prior handle-claim function", () => {
    const db = database!;
    db.apply(ROLLBACK);
    expect(db.sql("select to_regclass('public.private_social_accounts') is null")).toBe("t");
    expect(
      db.sql(
        "select to_regprocedure('public.migrate_social_product_account(text,uuid)') is null",
      ),
    ).toBe("t");
    db.sql(`
      insert into auth.users(id)
      values ('55555555-5555-4555-8555-555555555555');
      insert into public.profiles(handle) values ('rollback_legacy');
    `);
    expect(
      JSON.parse(
        db.sql(`select public.claim_pubmaxx_handle(
          '55555555-5555-4555-8555-555555555555', 'rollback_legacy'
        )`),
      ),
    ).toMatchObject({ ok: true, handle: "rollback_legacy" });
  });
});
