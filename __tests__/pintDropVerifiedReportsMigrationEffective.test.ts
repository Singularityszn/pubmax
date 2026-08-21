import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations/20260821120000_0112_pint_drop_verified_reports.sql",
);

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
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

type Session = {
  sql: (statement: string) => string;
  expectRefusal: (statement: string) => string;
  stop: () => Promise<void>;
};

async function startSession(): Promise<Session> {
  const initdb = binary("initdb");
  const postgres = binary("postgres");
  const psql = binary("psql");
  if (!initdb || !postgres || !psql) throw new Error("PostgreSQL 16 is required.");

  const dataDir = mkdtempSync(join(tmpdir(), "pubmax-pint-drop-0112-"));
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
      "shared_buffers = 16MB",
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

  const teardown = async (): Promise<void> => {
    if (processHandle.exitCode === null) {
      processHandle.kill("SIGTERM");
      await Promise.race([
        new Promise<void>((resolve) => processHandle.once("exit", () => resolve())),
        sleep(1_000).then(() => undefined),
      ]);
      if (processHandle.exitCode === null) processHandle.kill("SIGKILL");
    }
    rmSync(dataDir, { recursive: true, force: true });
  };

  const sql = (statement: string): string =>
    execFileSync(psql, [...args, "-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", statement], {
      encoding: "utf8",
    }).trim();

  const expectRefusal = (statement: string): string => {
    try {
      execFileSync(psql, [...args, "-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", statement], {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      return String((error as { stderr?: string | Buffer }).stderr ?? "");
    }
    throw new Error(`PostgreSQL accepted a statement it had to refuse: ${statement}`);
  };

  try {
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        execFileSync(psql, [...args, "-c", "select 1"], { stdio: "pipe" });
        ready = true;
        break;
      } catch {
        await sleep(100);
      }
    }
    if (!ready) throw new Error("PostgreSQL did not start.");

    sql(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create table public.visit_reports (
        id uuid primary key,
        report_count integer not null default 0,
        reported_at timestamptz,
        report_reason text,
        status text not null default 'visible'
      );
      create table public.pint_drop_reports (
        id uuid primary key default gen_random_uuid(),
        pint_drop_id uuid not null references public.visit_reports(id),
        actor_hash text not null,
        reason text,
        unique (pint_drop_id, actor_hash)
      );
    `);
    execFileSync(psql, [...args, "-v", "ON_ERROR_STOP=1", "-f", MIGRATION_PATH], {
      stdio: "pipe",
    });
  } catch (error) {
    await teardown();
    throw error;
  }

  return {
    sql,
    expectRefusal,
    stop: teardown,
  };
}

function missingPostgresReason(): string | null {
  if (process.env.PUBMAX_RLS_NO_PG === "1") {
    return "PostgreSQL was deliberately hidden by PUBMAX_RLS_NO_PG=1.";
  }
  const missing = (["initdb", "postgres", "psql"] as const).filter((name) => !binary(name));
  return missing.length > 0 ? `Missing PostgreSQL binaries: ${missing.join(", ")}.` : null;
}

let session: Session | null = null;
let skipReason: string | null = null;

beforeAll(async () => {
  skipReason = missingPostgresReason();
  if (skipReason) {
    console.error(`PINT DROP 0112 EFFECTIVE TESTS SKIPPED - THIS IS NOT A PASS: ${skipReason}`);
    return;
  }
  session = await startSession();
}, 60_000);

beforeEach((context) => {
  if (skipReason) context.skip(true, skipReason);
});

afterAll(async () => {
  await session?.stop();
});

describe("0112 verified Pint Drop report ledger", () => {
  it("does not let a legacy anonymous count hide a visible Pint Drop", () => {
    const id = "00000000-0000-4000-8000-000000000112";
      session!.sql(`
      insert into public.visit_reports (id, report_count) values ('${id}', 1);
      insert into public.pint_drop_reports (pint_drop_id, actor_hash)
      values ('${id}', 'mixed-legacy-actor');
    `);

    expect(
      session!.sql(
        `select public.report_pint_drop_v2('${id}', 'mixed-legacy-actor', 'wrong venue', 2)`,
      ),
    ).toBe("1");
    expect(
      session!.sql(
        `select verified_report_count || ':' || report_count || ':' || status from public.visit_reports where id = '${id}'`,
      ),
    ).toBe("1:1:visible");
  });

  it("hides only after two distinct verified accounts and stays idempotent", () => {
    const id = "00000000-0000-4000-8000-000000000113";
    session!.sql(`insert into public.visit_reports (id, report_count) values ('${id}', 9)`);

    expect(
      session!.sql(`select public.report_pint_drop_v2('${id}', 'account-a', '', 2)`),
    ).toBe("1");
    expect(
      session!.sql(`select public.report_pint_drop_v2('${id}', 'account-a', '', 2)`),
    ).toBe("1");
    expect(
      session!.sql(`select public.report_pint_drop_v2('${id}', 'account-b', '', 2)`),
    ).toBe("2");
    expect(
      session!.sql(
        `select verified_report_count || ':' || report_count || ':' || status from public.visit_reports where id = '${id}'`,
      ),
    ).toBe("2:9:hidden");
  });

  it("keeps the verified ledger service-role only", () => {
    expect(
      session!.expectRefusal(
        "set role anon; select count(*) from public.pint_drop_verified_reports",
      ),
    ).toContain("permission denied");
    expect(
      session!.expectRefusal(
        "set role authenticated; select public.report_pint_drop_v2(gen_random_uuid(), 'x', '', 2)",
      ),
    ).toContain("permission denied");
    expect(
      session!.sql(
        "set role service_role; select has_table_privilege('service_role', 'public.pint_drop_verified_reports', 'select')",
      ),
    ).toMatch(/t$/);
  });
});
