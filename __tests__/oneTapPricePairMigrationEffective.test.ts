// Effective proof that one-tap Community Price and Pint Drop rows share one
// PostgreSQL transaction.

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const MIGRATION = join(
  process.cwd(),
  "supabase/migrations/20260827123131_one_tap_price_pair.sql",
);
const REPAIR_MIGRATION = join(
  process.cwd(),
  "supabase/migrations/20260827172414_align_one_tap_pint_drop_price.sql",
);
const REPAIR_ROLLBACK = join(
  process.cwd(),
  "supabase/migrations/rollback/20260827172414_align_one_tap_pint_drop_price_rollback.sql",
);

type Session = {
  sql: (statement: string) => string;
  refuse: (statement: string) => string;
  apply: (path: string) => void;
  stop: () => Promise<void>;
};

function binary(name: "initdb" | "postgres" | "psql"): string | null {
  const candidates = [
    `/opt/homebrew/opt/postgresql@16/bin/${name}`,
    `/opt/homebrew/opt/postgresql@17/bin/${name}`,
    `/opt/homebrew/bin/${name}`,
    `/usr/local/opt/postgresql@16/bin/${name}`,
    `/usr/lib/postgresql/16/bin/${name}`,
    name,
  ];
  for (const candidate of candidates) {
    try {
      if (candidate === name) execFileSync("which", [name], { stdio: "pipe" });
      else if (!existsSync(candidate)) continue;
      return candidate;
    } catch {
      // Try next known installation.
    }
  }
  return null;
}

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

async function startSession(): Promise<Session> {
  const initdb = binary("initdb");
  const postgres = binary("postgres");
  const psql = binary("psql");
  if (!initdb || !postgres || !psql) throw new Error("PostgreSQL 16 is required.");
  const dataDir = mkdtempSync(join(tmpdir(), "pubmax-one-tap-pair-"));
  const port = await freePort();
  execFileSync(
    initdb,
    ["-D", dataDir, "--locale=C", "-E", "UTF8", "--username=postgres", "--auth=trust"],
    { stdio: "pipe" },
  );
  writeFileSync(
    join(dataDir, "postgresql.auto.conf"),
    [
      "listen_addresses = '127.0.0.1'",
      `port = ${port}`,
      "shared_buffers = 12MB",
      "fsync = off",
      "full_page_writes = off",
      "synchronous_commit = off",
    ].join("\n") + "\n",
  );
  const processHandle = spawn(
    postgres,
    ["-D", dataDir, "-k", dataDir, "-p", String(port), "-h", "127.0.0.1"],
    { stdio: "ignore" },
  );
  const args = ["-h", "127.0.0.1", "-p", String(port), "-U", "postgres", "-d", "postgres"];
  const stop = async (): Promise<void> => {
    if (processHandle.exitCode === null) {
      processHandle.kill("SIGTERM");
      await Promise.race([
        new Promise<void>((resolve) => processHandle.once("exit", () => resolve())),
        sleep(1_000).then(() => undefined),
      ]);
    }
    if (processHandle.exitCode === null) processHandle.kill("SIGKILL");
    rmSync(dataDir, { recursive: true, force: true });
  };
  const run = (statement: string, refuse = false): string => {
    try {
      return execFileSync(
        psql,
        [...args, "-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", statement],
        { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
      ).trim();
    } catch (error) {
      if (refuse) return String((error as { stderr?: string | Buffer }).stderr ?? "");
      throw error;
    }
  };
  try {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        run("select 1");
        break;
      } catch {
        if (attempt === 49) throw new Error("PostgreSQL did not start.");
        await sleep(100);
      }
    }
    run(`
      create extension if not exists pgcrypto;
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create table public.community_prices (
        id uuid primary key default gen_random_uuid(),
        venue_id text not null,
        drink_category text not null,
        price_pennies integer not null,
        actor text not null,
        contributor_handle text,
        submitted_at timestamptz not null,
        unique (venue_id, drink_category, actor)
      );
      create table public.pint_drops (
        id uuid primary key,
        venue_id text not null,
        handle text not null,
        drink text,
        price_gbp numeric,
        passed_down_note text,
        era text,
        vibe_tags text[] not null default '{}',
        visibility text not null default 'public',
        pint_photo_key text,
        venue_photo_key text,
        provenance text,
        status text not null default 'visible',
        created_at timestamptz not null,
        authority_key text
      );
      create function public.upsert_attributed_community_price_if_newer(
        p_venue_id text, p_drink_category text, p_price_pennies integer,
        p_actor text, p_contributor_handle text, p_submitted_at timestamptz,
        p_round_spend_id uuid, p_round_line_index integer
      ) returns table (
        id uuid, price_pennies integer, submitted_at timestamptz,
        round_spend_id uuid, round_line_index integer, source_became_owner boolean
      ) language plpgsql as $$
      declare
        v_id uuid;
        v_pennies integer;
        v_submitted_at timestamptz;
      begin
        insert into public.community_prices as price
          (venue_id, drink_category, price_pennies, actor, contributor_handle, submitted_at)
        values (p_venue_id, p_drink_category, p_price_pennies, p_actor, p_contributor_handle, p_submitted_at)
        on conflict (venue_id, drink_category, actor) do update
          set price_pennies = excluded.price_pennies,
              contributor_handle = excluded.contributor_handle,
              submitted_at = excluded.submitted_at
          where price.submitted_at <= excluded.submitted_at
        returning price.id, price.price_pennies, price.submitted_at
          into v_id, v_pennies, v_submitted_at;
        if not found then
          select price.id, price.price_pennies, price.submitted_at
            into v_id, v_pennies, v_submitted_at
            from public.community_prices price
            where price.venue_id = p_venue_id
              and price.drink_category = p_drink_category
              and price.actor = p_actor;
        end if;
        return query select v_id, v_pennies, v_submitted_at, null::uuid, null::integer, true;
      end $$;
      grant all on public.community_prices, public.pint_drops to service_role;
      grant execute on function public.upsert_attributed_community_price_if_newer(
        text, text, integer, text, text, timestamptz, uuid, integer
      ) to service_role;
    `);
    execFileSync(psql, [...args, "-v", "ON_ERROR_STOP=1", "-f", MIGRATION], { stdio: "pipe" });
    execFileSync(psql, [...args, "-v", "ON_ERROR_STOP=1", "-f", REPAIR_MIGRATION], { stdio: "pipe" });
    return {
      sql: (statement) => run(statement),
      refuse: (statement) => run(statement, true),
      apply: (path) => execFileSync(
        psql,
        [...args, "-v", "ON_ERROR_STOP=1", "-f", path],
        { stdio: "pipe" },
      ) && undefined,
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}

let session: Session | null = null;
let skipReason: string | null = null;

beforeAll(async () => {
  const missing = (["initdb", "postgres", "psql"] as const).filter((name) => !binary(name));
  skipReason = process.env.PUBMAX_RLS_NO_PG === "1"
    ? "PostgreSQL was deliberately hidden."
    : missing.length > 0 ? `Missing PostgreSQL binaries: ${missing.join(", ")}.` : null;
  if (!skipReason) session = await startSession();
}, 30_000);

beforeEach((context) => {
  if (skipReason) context.skip(true, skipReason);
});

afterAll(async () => session?.stop());

const PAIR_ARGS = `
  'venue-xjf3n0', 'beer', 420, 'profile:test', 'karan',
  '2026-08-27T19:00:00Z', '00000000-0000-4000-8000-000000000124',
  'karan', 'Pint', null, null, 'authority-a'
`;

const PAIR_NAMED_ARGS = `
  p_venue_id => 'venue-xjf3n0',
  p_drink_category => 'beer',
  p_price_pennies => 420,
  p_actor => 'profile:test',
  p_contributor_handle => 'karan',
  p_submitted_at => '2026-08-27T19:00:00Z',
  p_drop_id => '00000000-0000-4000-8000-000000000124',
  p_handle => 'karan',
  p_drink => 'Pint',
  p_pint_photo_key => null,
  p_venue_photo_key => null,
  p_authority_key => 'authority-a'
`;

describe("one-tap price pair migration", () => {
  it("commits one Community Price and one Pint Drop together", () => {
    expect(session!.sql(`
      select
        (price_id is not null)::text || '|' || price_pennies || '|' ||
        (submitted_at = '2026-08-27T19:00:00Z'::timestamptz)::text || '|' || drop_id
      from public.create_one_tap_price_pair(${PAIR_NAMED_ARGS})
    `)).toBe("true|420|true|00000000-0000-4000-8000-000000000124");
    expect(session!.sql("select (select count(*) from community_prices) || '|' || (select count(*) from pint_drops)")).toBe("1|1");
  });

  it("uses the stored Community Price when an older observation loses ownership", () => {
    const newerArgs = PAIR_ARGS
      .replace("profile:test", "profile:atomic")
      .replace("420", "510")
      .replace("2026-08-27T19:00:00Z", "2026-08-27T20:00:00Z")
      .replace("00000000-0000-4000-8000-000000000124", "00000000-0000-4000-8000-000000000130");
    const olderArgs = PAIR_ARGS
      .replace("profile:test", "profile:atomic")
      .replace("00000000-0000-4000-8000-000000000124", "00000000-0000-4000-8000-000000000131");

    expect(session!.sql(`select price_pennies from public.create_one_tap_price_pair(${newerArgs})`)).toBe("510");
    expect(session!.sql(`select price_pennies from public.create_one_tap_price_pair(${olderArgs})`)).toBe("510");
    expect(session!.sql(`
      select
        (select price_pennies from public.community_prices where actor = 'profile:atomic')
        || '|' ||
        (select round(price_gbp * 100)::integer from public.pint_drops where id = '00000000-0000-4000-8000-000000000131')
    `)).toBe("510|510");
  });

  it("rolls the price back when Pint Drop insert fails, then retries cleanly", () => {
    session!.sql(`
      create function reject_forced_pair() returns trigger language plpgsql as $$
      begin if new.handle = 'force-fail' then raise exception 'forced Pint Drop failure'; end if; return new; end $$;
      create trigger reject_forced_pair before insert on public.pint_drops
        for each row execute function reject_forced_pair();
    `);
    const failingArgs = PAIR_ARGS
      .replace("profile:test", "profile:retry")
      .replace("00000000-0000-4000-8000-000000000124", "00000000-0000-4000-8000-000000000125")
      .replace("'karan', 'Pint'", "'force-fail', 'Pint'");
    expect(session!.refuse(`select * from public.create_one_tap_price_pair(${failingArgs})`)).toContain("forced Pint Drop failure");
    expect(session!.sql("select count(*) from community_prices where actor = 'profile:retry'")).toBe("0");
    session!.sql("drop trigger reject_forced_pair on public.pint_drops");
    expect(session!.sql(`select count(*) from public.create_one_tap_price_pair(${failingArgs})`)).toBe("1");
    expect(session!.sql("select (select count(*) from community_prices where actor = 'profile:retry') || '|' || (select count(*) from pint_drops where handle = 'force-fail')")).toBe("1|1");
  });

  it("is service-only and rollback removes the RPC", () => {
    const signature = "public.create_one_tap_price_pair(text,text,integer,text,text,timestamptz,uuid,text,text,text,text,text)";
    expect(session!.sql(`select has_function_privilege('service_role', '${signature}', 'execute') || '|' || has_function_privilege('authenticated', '${signature}', 'execute') || '|' || has_function_privilege('anon', '${signature}', 'execute')`)).toBe("true|false|false");
    session!.apply(REPAIR_ROLLBACK);
    expect(session!.sql(`select to_regprocedure('${signature}') is null`)).toBe("t");
  });
});
