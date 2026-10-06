import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LEDGER_QUERY,
  checkMigrationLedger,
  compareLedger,
  fetchRemoteLedger,
  localMigrations,
  resolveLedgerTarget,
} from "@/scripts/lib/migrationLedger.mjs";
import { releaseProduction, ReleaseRefusal } from "@/scripts/lib/releaseProduction.mjs";

const dirs: string[] = [];
function repoWith(files: string[]): string {
  const dir = mkdtempSync(path.join(tmpdir(), "ledger-"));
  dirs.push(dir);
  for (const file of files) writeFileSync(path.join(dir, file), "select 1;");
  mkdirSync(path.join(dir, "rollback"));
  writeFileSync(path.join(dir, "rollback", "20260101000000_0001_a.sql"), "select 1;");
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const FILES = [
  "20260705214432_0001_visit_reports.sql",
  "20260706102502_0007_pub_presence.sql",
  "20261006120000_0174_diary_entries.sql",
];

describe("localMigrations", () => {
  it("reads name and bare slug, and skips the rollback directory", () => {
    expect(localMigrations(repoWith(FILES)).map((m) => [m.name, m.bare])).toEqual([
      ["0001_visit_reports", "visit_reports"],
      ["0007_pub_presence", "pub_presence"],
      ["0174_diary_entries", "diary_entries"],
    ]);
  });
});

describe("compareLedger", () => {
  const local = localMigrations(repoWith(FILES));
  it("matches by name whatever the version, and accepts a bare name", () => {
    const result = compareLedger(local, ["0001_visit_reports", "pub_presence", "0174_diary_entries", "askback_init"]);
    expect(result.missing).toEqual([]);
    expect(result.remoteOnly).toEqual(["askback_init"]);
  });
  it("names every repo file production lacks", () => {
    expect(compareLedger(local, ["0001_visit_reports"]).missing).toEqual([
      "20260706102502_0007_pub_presence.sql",
      "20261006120000_0174_diary_entries.sql",
    ]);
  });
});

describe("the remote read", () => {
  it("posts one fixed select to the read-only endpoint with the token as a bearer", async () => {
    const fetchImpl = vi.fn(async () => Response.json([{ name: "a" }, { name: "b" }]));
    const names = await fetchRemoteLedger({ projectRef: "ref123", token: "sbp_secret", fetchImpl: fetchImpl as never });
    expect(names).toEqual(["a", "b"]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.supabase.com/v1/projects/ref123/database/query/read-only");
    expect(JSON.parse(String(init.body))).toEqual({ query: LEDGER_QUERY });
    expect(LEDGER_QUERY).toMatch(/^select /);
  });
  it("fails without echoing the token", async () => {
    const fetchImpl = vi.fn(async () => new Response("no", { status: 401 }));
    const error = await fetchRemoteLedger({ projectRef: "r", token: "sbp_secret", fetchImpl: fetchImpl as never }).catch((e) => e);
    expect(String(error.message)).toContain("401");
    expect(String(error.message)).not.toContain("sbp_secret");
  });
  it("refuses to run without a token", () => {
    expect(() => resolveLedgerTarget({})).toThrow(/SUPABASE_ACCESS_TOKEN/);
  });
});

describe("checkMigrationLedger", () => {
  const env = { SUPABASE_ACCESS_TOKEN: "t" };
  it("passes when production holds everything and throws naming what it lacks", async () => {
    const directory = repoWith(FILES);
    const all = vi.fn(async () => Response.json(["0001_visit_reports", "0007_pub_presence", "0174_diary_entries"].map((name) => ({ name }))));
    await expect(checkMigrationLedger({ directory, env, fetchImpl: all as never })).resolves.toMatchObject({ missing: [] });
    const some = vi.fn(async () => Response.json([{ name: "0001_visit_reports" }]));
    await expect(checkMigrationLedger({ directory, env, fetchImpl: some as never })).rejects.toThrow(/lacks 2 migration[\s\S]*0174_diary_entries/);
  });
});

describe("the release command", () => {
  it("runs the ledger check before it uploads anything and stops when it fails", async () => {
    const calls: string[] = [];
    const sha = "a".repeat(40);
    const deps = {
      run: async (command: string, args: string[]) => {
        calls.push(`${command} ${args[0]}`);
        return { status: 0, stdout: command === "git" && args[0] === "rev-parse" ? `${sha}\n` : "" };
      },
      deploymentIdAt: async () => "dpl",
      now: () => 0,
      sleep: async () => {},
      say: () => {},
      preflight: [
        {
          name: "ledger",
          run: async () => {
            throw new ReleaseRefusal("Production lacks 1 migration(s)");
          },
        },
      ],
    };
    await expect(releaseProduction(deps)).rejects.toThrow(/lacks 1 migration/);
    expect(calls.some((call) => call.startsWith("node"))).toBe(false);
  });
});
