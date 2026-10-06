import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_KEEP,
  DUMP_SCHEMAS,
  dumpFileName,
  dumpsToPrune,
  isInsideDirectory,
  listBucketObjects,
  pgDumpArgs,
  pgEnvFromUrl,
  safeObjectPath,
} from "@/scripts/lib/offPlatformBackup.mjs";

const ROOT = path.resolve(__dirname, "..");

describe("pgEnvFromUrl", () => {
  it("splits a connection string into PG variables so the password is never an argument", () => {
    expect(pgEnvFromUrl("postgresql://postgres.ref:p%40ss@aws-0.pooler.supabase.com:5432/postgres")).toEqual({
      PGHOST: "aws-0.pooler.supabase.com",
      PGPORT: "5432",
      PGUSER: "postgres.ref",
      PGPASSWORD: "p@ss",
      PGDATABASE: "postgres",
      PGSSLMODE: "require",
    });
    expect(pgDumpArgs("/x/out.dump").join(" ")).not.toMatch(/p@ss|postgresql:/);
  });
  it("refuses anything that is not a postgres URL", () => {
    expect(() => pgEnvFromUrl("https://example.com")).toThrow(/postgres/);
    expect(() => pgEnvFromUrl("not a url")).toThrow();
  });
});

describe("dump files", () => {
  it("names a dump by UTC stamp and dumps the four schemas in custom format", () => {
    expect(dumpFileName(new Date("2026-10-06T07:30:05.123Z"))).toBe("pubmax-20261006T073005Z.dump");
    const args = pgDumpArgs("out.dump");
    expect(args).toContain("--format=custom");
    expect(DUMP_SCHEMAS).toEqual(["public", "auth", "storage", "supabase_migrations"]);
    for (const schema of DUMP_SCHEMAS) expect(args).toContain(schema);
  });
  it("prunes only old dumps and never another file", () => {
    const files = [
      "pubmax-20260901T000000Z.dump",
      "pubmax-20260908T000000Z.dump",
      "pubmax-20260915T000000Z.dump",
      "notes.txt",
      "bucket",
      "pubmax-20260915T000000Z.dump.partial",
    ];
    expect(dumpsToPrune(files, 2)).toEqual(["pubmax-20260901T000000Z.dump"]);
    expect(dumpsToPrune(files, DEFAULT_KEEP)).toEqual([]);
  });
});

describe("keeping a backup out of the repository", () => {
  it("knows what is inside a directory", () => {
    expect(isInsideDirectory("/repo/backups", "/repo")).toBe(true);
    expect(isInsideDirectory("/repo", "/repo")).toBe(true);
    expect(isInsideDirectory("/home/me/pubmax-backups", "/repo")).toBe(false);
    expect(isInsideDirectory("/repo-other", "/repo")).toBe(false);
  });
  it("refuses a bucket path that escapes its directory", () => {
    expect(safeObjectPath("/b", "a/b.jpg")).toBe("/b/a/b.jpg");
    expect(() => safeObjectPath("/b", "../etc/passwd")).toThrow(/escaped/);
    expect(() => safeObjectPath("/b", "")).toThrow(/escaped/);
  });
});

describe("listBucketObjects", () => {
  it("walks folders and pages, and returns files only", async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const { prefix, offset } = JSON.parse(String(init.body));
      if (prefix === "" && offset === 0) {
        return Response.json([
          { name: "a.jpg", id: "1", metadata: { size: 10 } },
          { name: "folder", id: null },
        ]);
      }
      if (prefix === "folder") return Response.json([{ name: "b.jpg", id: "2", metadata: { size: 20 } }]);
      return Response.json([]);
    });
    const objects = await listBucketObjects({
      baseUrl: "https://x.supabase.co",
      key: "k",
      bucket: "pint-drops",
      fetchImpl: fetchImpl as never,
    });
    expect(objects).toEqual([
      { path: "a.jpg", size: 10 },
      { path: "folder/b.jpg", size: 20 },
    ]);
  });
  it("fails on an API error without echoing the key", async () => {
    const fetchImpl = vi.fn(async () => new Response("no", { status: 403 }));
    const error = await listBucketObjects({
      baseUrl: "https://x.supabase.co",
      key: "secret-key",
      bucket: "b",
      fetchImpl: fetchImpl as never,
    }).catch((e) => e);
    expect(error.message).toContain("403");
    expect(error.message).not.toContain("secret-key");
  });
});

describe("the runbook", () => {
  const runbook = readFileSync(path.join(ROOT, "docs/DR_RUNBOOK.md"), "utf8");
  it("covers every scenario the audit named", () => {
    for (const heading of [
      "## 2. Restore the database from a dump",
      "## 3. Rebuild from zero",
      "## 4. Account lockout",
      "## 5. A key has leaked",
      "## 6. Domain loss",
    ]) {
      expect(runbook).toContain(heading);
    }
    expect(runbook).toContain("Rotation table");
    expect(runbook).toContain("restore drill");
  });
  it("names the scripts that exist", () => {
    const scripts = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).scripts;
    expect(scripts["backup:offplatform"]).toBe("node scripts/backup-offplatform.mjs");
    expect(runbook).toContain("npm run backup:offplatform");
  });
  it("never puts a dump or a secret in the repository", () => {
    expect(readFileSync(path.join(ROOT, ".gitignore"), "utf8")).toMatch(/\*\.dump/);
  });
});
